// Parser do RETORNO da Titan - formato CSV, bem diferente do CNAB 400 de
// largura fixa que lib/cnabRetorno.js lê (essa é a "Bancorp"). Não existe
// hoje uma arquitetura de parsers plugáveis nesse projeto - lib/cnabRetorno.js
// e a lógica de casamento em pages/api/upload-retorno.js formam um pipeline
// único, específico do layout CNAB. Este arquivo só cobre o PARSING do CSV
// da Titan (texto bruto -> movimentos normalizados); o casamento desses
// movimentos contra `titulos` e a gravação no banco ficam de fora de
// propósito - a estratégia de casamento da Titan (numero_titulo + nome do
// sacado, com comparação tolerante) é diferente da usada hoje pro Bancorp
// (seu_numero exato), então não dá pra reaproveitar o upload-retorno.js
// existente sem reescrever essa parte - isso é trabalho de outra tarefa.
//
// Encoding: o arquivo chega aqui como uma string JS já decodificada como
// ISO-8859-1 (mesmo padrão usado pra remessa/retorno CNAB - ver
// lerArquivoComoLatin1 em pages/index.js). Este módulo não faz nenhuma
// decodificação de encoding, só recebe texto.
//
// Regras de negócio (conferidas com o usuário antes de implementar):
// - "Baixa" é ignorada nesta versão: mesmo preenchida, o título NÃO é
//   marcado como baixado - fica de fora do resultado (nenhum movimento é
//   gerado só por causa da Baixa).
// - "N. Bancário" nunca é lido - não é confiável como chave de casamento.
// - Só linhas com "Liquidação" preenchida viram movimento (status
//   'liquidado'). Sem "Liquidação", a linha não gera nenhum registro -
//   fica pra `linhasIgnoradas`, e o título correspondente continua
//   'aguardando_retorno' no sistema (não é alterado por quem consumir
//   esse parser, já que nenhum movimento é produzido pra ele).
//
// ACHADO (confirmado com o usuário, contra um arquivo real da Titan): a
// coluna "Título" vem no formato "<base>-<parcela>" (ex: "673-0001"), onde
// <base> é a MESMA sequência numérica do final do `seu_numero` gravado na
// remessa (ex: seu_numero "202600673A" → base "673" - o "2026" na frente é
// só o prefixo/ano do seu_numero do cliente, comparado aqui por SUFIXO de
// string em vez de um corte de posição fixa, porque o `seu_numero` real já
// mostrou largura inconsistente entre remessas: às vezes 9 dígitos antes da
// letra, às vezes 10). <parcela> é a posição numérica da parcela (0001,
// 0002, 0003...), onde a Titan usa número e a remessa usa letra (A, B, C...)
// - NÃO é o `numero_titulo` (posição 37-44 da remessa), que é o mesmo valor
// pra todas as parcelas e por isso nunca identificaria uma parcela
// específica. `tituloBase`/`tituloParcela` abaixo saem já parseados como
// número (o `parseInt` também absorve a inconsistência de zero-padding do
// lado da Titan: "006" e "0006" viram o mesmo 6).
function parseNumeroTituloTitan(bruto) {
  const partes = String(bruto || '').trim().split('-')
  if (partes.length !== 2) return { base: null, parcela: null }
  const base = parseInt(partes[0], 10)
  const parcela = parseInt(partes[1], 10)
  return {
    base: isNaN(base) ? null : base,
    parcela: isNaN(parcela) ? null : parcela,
  }
}

const COLUNAS_ESPERADAS = {
  numeroTitulo: 'Título',
  nomeSacado: 'Razão Social Sacado',
  valorTitulo: 'Vlr Original',
  valorPago: 'Total Recdo',
  dataVencimento: 'Vcto',
  dataLiquidacao: 'Liquidação',
  cnpjSacado: 'CNPJ/CPF/Código',
}

// Split de uma linha CSV respeitando aspas duplas (campos entre "..." podem
// conter o próprio delimitador, e "" dentro de um campo quotado é uma aspa
// literal escapada - regra padrão de CSV, não específica da Titan).
function parseLinhaCsv(linha, delimitador = ';') {
  const campos = []
  let atual = ''
  let dentroAspas = false

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (dentroAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"'
          i++
        } else {
          dentroAspas = false
        }
      } else {
        atual += c
      }
    } else if (c === '"') {
      dentroAspas = true
    } else if (c === delimitador) {
      campos.push(atual)
      atual = ''
    } else {
      atual += c
    }
  }
  campos.push(atual)
  return campos.map((c) => c.trim())
}

// "5.400,00" -> 5400 ; "" -> 0 (mesma convenção de ausência = 0 usada em
// lib/cnabRetorno.js's toValor, pra não confundir "não pago" com null).
function toValorBR(valor) {
  const limpo = String(valor || '').trim()
  if (!limpo) return 0
  const semMilhar = limpo.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(semMilhar)
  return isNaN(n) ? 0 : n
}

// "DD/MM/AAAA" -> "AAAA-MM-DD" ; vazio/formato inválido -> null.
function toDateBR(valor) {
  const limpo = String(valor || '').trim()
  if (!limpo) return null
  const m = limpo.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, aaaa] = m
  return `${aaaa}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// Normaliza nome de sacado pra comparação tolerante (maiúsc./acentos/
// espaços) - usado pelo casamento contra titulos.nome_sacado numa etapa
// futura, não por este parser. Exportado aqui porque é específico de como
// a Titan escreve nomes (Latin-1, variação de acentuação), não do resto do
// sistema.
function normalizarNomeSacado(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function parseRetornoTitan(conteudoArquivo) {
  const linhas = conteudoArquivo
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0)

  if (linhas.length === 0) {
    return { cabecalho: null, movimentos: [], linhasIgnoradas: [] }
  }

  const cabecalhoCsv = parseLinhaCsv(linhas[0])
  const indice = {}
  for (const [chave, nomeColuna] of Object.entries(COLUNAS_ESPERADAS)) {
    const idx = cabecalhoCsv.indexOf(nomeColuna)
    if (idx === -1) {
      throw new Error(`Coluna obrigatória "${nomeColuna}" não encontrada no cabeçalho do CSV da Titan`)
    }
    indice[chave] = idx
  }

  const movimentos = []
  const linhasIgnoradas = []

  for (let i = 1; i < linhas.length; i++) {
    const campos = parseLinhaCsv(linhas[i])
    const valorBruto = (chave) => campos[indice[chave]]

    const numeroTitulo = String(valorBruto('numeroTitulo') || '').trim()
    const nomeSacado = String(valorBruto('nomeSacado') || '').trim()
    const dataLiquidacao = toDateBR(valorBruto('dataLiquidacao'))

    if (!dataLiquidacao) {
      linhasIgnoradas.push({
        numeroLinha: i + 1,
        motivo: 'sem "Liquidação" preenchida - título permanece aguardando retorno',
        conteudo: linhas[i],
      })
      continue
    }

    const { base: tituloBase, parcela: tituloParcela } = parseNumeroTituloTitan(numeroTitulo)
    if (tituloBase === null || tituloParcela === null) {
      linhasIgnoradas.push({
        numeroLinha: i + 1,
        motivo: `"Título" fora do formato esperado "<base>-<parcela>": "${numeroTitulo}"`,
        conteudo: linhas[i],
      })
      continue
    }

    movimentos.push({
      numeroTitulo,
      tituloBase,
      tituloParcela,
      nomeSacado,
      cnpjSacado: String(valorBruto('cnpjSacado') || '').trim(),
      valorTitulo: toValorBR(valorBruto('valorTitulo')),
      valorPago: toValorBR(valorBruto('valorPago')),
      dataVencimento: toDateBR(valorBruto('dataVencimento')),
      dataLiquidacao,
      // Único status possível vindo da Titan nesta versão: "Baixa" é
      // ignorada (ver comentário no topo do arquivo), então toda linha que
      // chega até aqui (tem Liquidação preenchida) é liquidação.
      status: 'liquidado',
    })
  }

  return { cabecalho: null, movimentos, linhasIgnoradas }
}

module.exports = { parseRetornoTitan, normalizarNomeSacado }
