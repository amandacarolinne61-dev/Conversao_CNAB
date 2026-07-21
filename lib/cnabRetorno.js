// Parser da RETORNO CNAB 400
//
// AJUSTE (21/07/2026): o Nosso Número agora é lido SEMPRE da posição 63-70
// (front-anchored, 0-indexed 62-70). Essa é a única posição confirmada como
// confiável em todos os portadores testados:
//
//   - GLEISIANE (Itaú, carteira 109 "I"): posições 63-70, 86-93 e 127-134
//     batem entre si (redundantes, mas OK usar qualquer uma).
//   - FENTE FILM (Itaú, carteira 109 "E" - Escritural): SÓ a posição 63-70
//     varia por título. As posições 86-93 e 127-134 vêm FIXAS (ex:
//     "06564707" repetido em todas as linhas do arquivo) — não são o Nosso
//     Número do título, parecem ser código de convênio/lote. Usar essas
//     posições pra matching colapsa todos os títulos numa chave só.
//
// Confirmado cruzando com a remessa real da FENTE FILM: título 600619/B
// tem Nosso Número 00000328 tanto na remessa (pos 63-70) quanto no retorno
// (pos 63-70). As posições 86-93/127-134 do retorno desse título mostravam
// "06564707", que não aparece em lugar nenhum da remessa - confirma que não
// devem ser usadas como chave de casamento.
//
// Por isso: NUNCA usar posições 86-93 ou 127-134 pra identificar o título.
// Usar só 63-70 (e, se precisar exibir o DAC do Nosso Número, ele está em
// 94-94, mas isso é só formatação/exibição, não faz parte da chave).

function campo(linha, inicio1based, fim1based) {
  // inicio/fim em base 1 (igual ao manual do Itaú), slice em base 0
  return linha.slice(inicio1based - 1, fim1based).trim()
}

function campoFimLinha(linha, distanciaDoFim, tamanho) {
  // Para campos que ficam DEPOIS da zona variável (ex: Bancorp, onde um
  // campo no meio da linha varia entre 4 e 5 caracteres, empurrando o resto
  // por 1 posição). Esses campos são lidos a partir do fim da linha, que
  // não é afetado pela variação do meio.
  const fim = linha.length - distanciaDoFim
  const inicio = fim - tamanho
  return linha.slice(inicio, fim).trim()
}

function toDate(ddmmaa) {
  if (!ddmmaa || ddmmaa.trim() === '' || ddmmaa === '000000') return null
  const dd = ddmmaa.slice(0, 2)
  const mm = ddmmaa.slice(2, 4)
  const aa = ddmmaa.slice(4, 6)
  if (dd === '00' || mm === '00') return null
  const ano = parseInt(aa, 10) < 50 ? `20${aa}` : `19${aa}`
  return `${ano}-${mm}-${dd}`
}

function toValor(digitos) {
  const limpo = (digitos || '').replace(/\D/g, '')
  if (!limpo) return 0
  return parseInt(limpo, 10) / 100
}

// Descrições dos códigos de ocorrência mais comuns (arquivo retorno).
// Para adicionar novos, também dá pra manter isso só na tabela
// `ocorrencias_ref` do Supabase e usar esta função só como fallback.
const OCORRENCIAS = {
  '02': 'Entrada Confirmada',
  '03': 'Entrada Rejeitada',
  '04': 'Alteração de Dados',
  '05': 'Alteração de Dados - Baixa',
  '06': 'Liquidação Normal',
  '07': 'Liquidação Parcial',
  '08': 'Liquidação em Cartório',
  '09': 'Baixa Simples',
  '10': 'Baixa por ter sido Liquidado',
  '11': 'Em Ser',
  '12': 'Abatimento Concedido',
  '13': 'Abatimento Cancelado',
  '14': 'Vencimento Alterado',
  '15': 'Baixa Rejeitada',
  '16': 'Instruções Rejeitadas',
  '17': 'Alteração/Exclusão Rejeitada',
  '25': 'Alegação do Pagador',
}

// Ocorrências que geram baixa/liquidação de verdade (crédito ao beneficiário)
const OCORRENCIAS_LIQUIDACAO = new Set(['06', '07', '08', '09', '10'])

function parseHeaderRetorno(linha) {
  return {
    tipoRegistro: campo(linha, 1, 1),
    codigoRetorno: campo(linha, 2, 2),
    agencia: campo(linha, 27, 30),
    conta: campo(linha, 33, 37),
    dacContaEmpresa: campo(linha, 38, 38),
    nomeEmpresa: campo(linha, 47, 76),
    codigoBanco: campo(linha, 77, 79),
    nomeBanco: campo(linha, 80, 94),
    dataGeracao: toDate(campo(linha, 95, 100)),
  }
}

function parseDetalheRetorno(linha) {
  // --- Campos front-anchored (posição absoluta a partir do início) ---
  // Seguros mesmo em arquivos com variação de largura no meio da linha,
  // porque ficam TODOS antes da zona instável.
  const codigoInscricaoEmpresa = campo(linha, 2, 3)
  const cnpjEmpresa = campo(linha, 4, 17)
  const usoDaEmpresa = campo(linha, 38, 62)

  // >>> NOSSO NÚMERO: sempre da posição 63-70. Não usar 86-93/127-134. <<<
  const nossoNumero = campo(linha, 63, 70)

  const carteiraNumero = campo(linha, 83, 85)
  const dacNossoNumero = campo(linha, 94, 94) // só exibição, não é chave
  const codigoOcorrencia = campo(linha, 109, 110)
  const dataOcorrencia = toDate(campo(linha, 111, 116))
  const numeroDocumento = campo(linha, 117, 126)
  const vencimento = toDate(campo(linha, 147, 152))
  const valorTitulo = toValor(campo(linha, 153, 165))
  const codigoBanco = campo(linha, 166, 168)
  const agenciaCobradora = campo(linha, 169, 172)
  const especie = campo(linha, 174, 175)
  const tarifaCobranca = toValor(campo(linha, 176, 188))
  const valorIOF = toValor(campo(linha, 215, 227))
  const valorAbatimento = toValor(campo(linha, 228, 240))
  const valorDesconto = toValor(campo(linha, 241, 253))
  const valorPrincipal = toValor(campo(linha, 254, 266))
  const jurosMoraMulta = toValor(campo(linha, 267, 279))
  const outrosCreditos = toValor(campo(linha, 280, 292))
  const dataCredito = toDate(campo(linha, 296, 301))
  const nomePagador = campo(linha, 325, 354)
  const codigoLiquidacao = campo(linha, 393, 394)

  // Valor líquido efetivamente creditado ao beneficiário nessa ocorrência.
  // Só faz sentido calcular pra ocorrências de liquidação de fato (06, 07,
  // 08, 09, 10) — pra entrada confirmada (02) e outras, os campos de valor
  // não representam dinheiro creditado, então fica 0 pra não confundir.
  const geraLiquidacaoDetalhe = OCORRENCIAS_LIQUIDACAO.has(codigoOcorrencia)
  const valorLiquido = geraLiquidacaoDetalhe
    ? valorPrincipal || valorTitulo - valorDesconto - valorAbatimento + jurosMoraMulta
    : 0

  return {
    tipoRegistro: campo(linha, 1, 1),
    codigoInscricaoEmpresa,
    cnpjEmpresa,
    usoDaEmpresa,
    nossoNumero,           // <- chave única de casamento com a remessa
    dacNossoNumero,        // <- só formatação/exibição (ex: "00000328-0")
    carteiraNumero,
    codigoOcorrencia,
    descricaoOcorrencia: OCORRENCIAS[codigoOcorrencia] || `Ocorrência ${codigoOcorrencia}`,
    geraLiquidacao: geraLiquidacaoDetalhe,
    dataOcorrencia,
    numeroDocumento,
    vencimento,
    valorTitulo,
    codigoBanco,
    agenciaCobradora,
    especie,
    tarifaCobranca,
    valorIOF,
    valorAbatimento,
    valorDesconto,
    valorPrincipal,
    jurosMoraMulta,
    outrosCreditos,
    valorLiquido,
    dataCredito,
    nomePagador,
    codigoLiquidacao,
  }
}

function parseTrailerRetorno(linha) {
  return {
    tipoRegistro: campo(linha, 1, 1),
    qtdeDetalhesEscritural: campo(linha, 178, 185),
    valorTotalEscritural: toValor(campo(linha, 186, 199)),
    controleArquivo: campo(linha, 208, 212),
    qtdeDetalhes: campo(linha, 213, 220),
    valorTotalInformado: toValor(campo(linha, 221, 234)),
  }
}

// Ponto de entrada: recebe o conteúdo bruto do arquivo (string) e devolve
// header, lista de detalhes e trailer já parseados.
function parseRetorno(conteudoArquivo) {
  const linhas = conteudoArquivo
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+$/, '')) // remove espaços à direita, preserva o resto
    .filter((l) => l.length > 0)

  let header = null
  let trailer = null
  const detalhes = []

  for (const linha of linhas) {
    const tipo = linha[0]
    if (tipo === '0') {
      header = parseHeaderRetorno(linha)
    } else if (tipo === '1') {
      detalhes.push(parseDetalheRetorno(linha))
    } else if (tipo === '9') {
      trailer = parseTrailerRetorno(linha)
    }
    // tipos '4' (rateio) e outros não usados aqui ainda
  }

  return { header, detalhes, trailer }
}

module.exports = {
  parseRetorno,
  parseHeaderRetorno,
  parseDetalheRetorno,
  parseTrailerRetorno,
  OCORRENCIAS,
  OCORRENCIAS_LIQUIDACAO,
}
