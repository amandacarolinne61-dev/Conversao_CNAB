import { supabase } from '../../lib/supabaseClient'

// Gerador do .RET de baixas, no MESMO layout confirmado do arquivo
// CB170707_RETORNO_SIMULADO.RET (validado byte a byte contra o retorno real
// da Bancorp em 341RETCLI...RET - as posições de nosso_numero, ocorrencia,
// valor, datas e sacado são as MESMAS em ambos, o que confirma que esse é o
// layout padrão de RETORNO usado pelo sistema/G3, independente da factoring
// de origem).
//
// Posições confirmadas (linha de 400 posições fixas):
//   42-52   título (10 dígitos) - CONFIRMADO campo real lido pelo G3
//   62-70   nosso_numero (8 dígitos)
//   108-110 código de ocorrência ("06" = liquidação)
//   111-117 data de ocorrência (DDMMAA)
//   117-127 nº do documento de cobrança (10 posições) - mesmo valor do
//           título (posição 42), repetido aqui por layout
//   127-135 confirmação do nosso número (8 dígitos) - mesmo valor da
//           posição 62
//   146-152 data de ocorrência (DDMMAA) [duplicado no layout de retorno]
//   152-165 valor pago (13 dígitos, sem separador decimal)
//   295-301 data de crédito (DDMMAA)
//   324-394 nome do sacado (70 posições)
//   394-400 número sequencial do registro (6 dígitos)
//
// ACHADO (22/07/2026): as posições 111-117 (data de ocorrência) e 117-135
// (nº do documento completo + confirmação do nosso número) nunca eram
// sobrescritas pelo código - ficavam congeladas com o valor do título de
// EXEMPLO usado pra montar o DETAIL_TEMPLATE ("150626" / "06564707"),
// idêntico em toda linha de toda exportação já gerada. Corrigido abaixo.
//
// CONFIRMADO independentemente contra CN20076A.RET - um arquivo de OUTRO
// cliente do G3 (não FENTE FILM), recebido como padrão de referência de
// como o arquivo precisa sair pro G3 ler. Nele, 117-127 varia por título
// completo ("004883/A", "004883/B", "004883/C"...) e 127-135 repete
// exatamente o nosso_numero de cada linha - bate 100% com a correção acima.
//
// ACHADO (22/07/2026): o "título" que o G3 realmente reconhece NÃO é o
// campo seu_numero da remessa (posição 43-52, sem barra, ex "202600626A") -
// é um campo DIFERENTE, na posição 109-118 da própria remessa, que já vem
// COM a barra antes da letra da parcela (ex "01600626/A"). Confirmado pelo
// usuário comparando com o G3. Esse campo é extraído em cnabRemessa.js
// como `tituloG3` e gravado em `titulos.titulo_g3`. As posições 42 e 116
// do .RET de saída agora usam titulo_g3 (com barra), não mais seu_numero.
// O casamento título×retorno em upload-retorno.js CONTINUA usando
// seu_numero (sem barra) - é um campo diferente, com propósito diferente.
//
// Header:
//   76-79   código do banco/portador
//   94-100  data de geração (DDMMAA)
//   108-113 sequencial do arquivo (5 dígitos)
//   113-119 data de geração repetida (DDMMAA)

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

// Templates baseados em LINHAS REAIS do retorno da Bancorp (341RETCLI...RET,
// já processado com sucesso antes) - não mais no exemplo antigo da ZPEL, que
// deixava caracteres residuais de outro layout (ex: um "E" sobrando na
// posição 107, onde o arquivo real tem espaço em branco).
const HEADER_TEMPLATE =
  '02RETORNO01COBRANCA       000000000000        ENERGY POWER LTDA             341BANCO ITAU SA  21072600000BPI00000210726                                                                                                                                                                                                                                                                                   000001'

const DETAIL_TEMPLATE =
  '10260225985000185000000000000        6564707                  06564707            000065647070              0615062620260359/C06564707            150626000000178096000000000000000000000000                          000000000000000000000000000000000000000000000178096000000000000000000000000000   1606260000      0000000000000MB COMERCIO DE PELICULAS EIREL                                        000009'

const TRAILER_TEMPLATE =
  '9                                                                                                                                                                                                                                                                                                                                                                                                         000007'

function setAt(str, start, valor) {
  return str.slice(0, start) + valor + str.slice(start + valor.length)
}

function pad(valor, tamanho, char = '0') {
  const s = String(valor ?? '')
  return s.length >= tamanho ? s.slice(-tamanho) : char.repeat(tamanho - s.length) + s
}

function padDireita(valor, tamanho) {
  const s = String(valor ?? '')
  return s.length >= tamanho ? s.slice(0, tamanho) : s + ' '.repeat(tamanho - s.length)
}

function hojeDDMMAA() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aa = String(d.getFullYear()).slice(2)
  return `${dd}${mm}${aa}`
}

function isoParaDDMMAA(iso) {
  if (!iso) return '000000'
  const [ano, mes, dia] = iso.split('-')
  return `${dia}${mes}${ano.slice(2)}`
}

function valorParaCNAB(valor, tamanho = 13) {
  const centavos = Math.round(Number(valor || 0) * 100)
  return pad(centavos, tamanho)
}

// Título na posição 42-52 (10 posições) - CONFIRMADO que é essa a posição
// que o G3 lê. Usa `titulo_g3` (com barra, ex "01600626/A" - o formato que
// o G3 realmente reconhece), com fallback pro `seu_numero` antigo (sem
// barra) só pra títulos gravados antes dessa coluna existir.
function tituloParaPosicao42(t) {
  const s = String(t.titulo_g3 || t.seu_numero || '').trim().toUpperCase()
  if (s.length >= 10) return s.slice(0, 10)
  return '0'.repeat(10 - s.length) + s
}

// Nº do documento de cobrança, posição 117-126 (10 posições) - mesmo valor
// e mesma regra da posição 42 (tituloParaPosicao42). Antes só escrevíamos
// 8 dos 10 caracteres desse campo, deixando os 2 últimos com lixo
// congelado do template original (ex: "/C" de um título de exemplo) -
// agora usa a mesma função pra escrever o campo completo.

export default async function handler(req, res) {
  try {
    const { data: titulos, error } = await supabase
      .from('titulos')
      .select('*, movimentos_retorno(*), remessas(portador_codigo, portador_nome, nome_empresa)')
      .eq('status', 'liquidado')
      .is('exportado_em', null)

    if (error) throw error

    if (!titulos || titulos.length === 0) {
      res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
      return res.status(200).send('Nenhum titulo liquidado pendente de exportacao.\r\n')
    }

    const linhas = []
    const dataHoje = hojeDDMMAA()

    // Código/nome do banco e nome da empresa vêm da PRÓPRIA remessa (o
    // código do SEU sistema, ex "777"/"BANCO TESTE") - nunca do retorno da
    // factoring. Assume-se que todos os títulos exportados juntos são do
    // mesmo portador; se um dia isso não for verdade, essa exportação
    // precisará ser feita em lotes separados por portador.
    const remessaRef = titulos[0].remessas || {}

    // --- Header ---
    let header = HEADER_TEMPLATE
    header = setAt(header, 46, padDireita((remessaRef.nome_empresa || '').toUpperCase(), 30))
    header = setAt(header, 76, pad(remessaRef.portador_codigo || '000', 3, '0'))
    header = setAt(header, 79, padDireita((remessaRef.portador_nome || '').toUpperCase(), 15))
    header = setAt(header, 94, dataHoje) // data de geração
    header = setAt(header, 108, pad(1, 5)) // sequencial do arquivo
    header = setAt(header, 113, dataHoje) // data repetida
    header = setAt(header, 394, pad(1, 6)) // sequencial do registro
    linhas.push(header)

    // --- Detalhes: 1 linha por título liquidado ---
    let seq = 2
    const idsExportados = []

    for (const t of titulos) {
      const movimentosBaixa = (t.movimentos_retorno || [])
        .filter((m) => m.gera_baixa)
        .sort((a, b) => (b.data_ocorrencia || '').localeCompare(a.data_ocorrencia || ''))
      const mov = movimentosBaixa[0]

      let linha = DETAIL_TEMPLATE
      linha = setAt(linha, 42, tituloParaPosicao42(t)) // <-- campo real lido pelo G3 (com barra)
      linha = setAt(linha, 62, pad(t.nosso_numero, 8))
      linha = setAt(linha, 108, '06')
      linha = setAt(linha, 110, isoParaDDMMAA(mov?.data_ocorrencia)) // antes ficava congelado
      linha = setAt(linha, 116, tituloParaPosicao42(t)) // nº do documento completo (10 posições)
      linha = setAt(linha, 126, pad(t.nosso_numero, 8)) // confirmação do nosso número - antes ficava congelada
      linha = setAt(linha, 146, isoParaDDMMAA(mov?.data_ocorrencia))
      // Usa sempre o VALOR DO TÍTULO (contratado), não o valor pago no
      // retorno - eventuais diferenças (juros, liquidação combinada, etc.)
      // ficam só como alerta visual na tela, não vão pro arquivo do G3.
      linha = setAt(linha, 152, valorParaCNAB(t.valor_titulo))
      linha = setAt(linha, 253, valorParaCNAB(t.valor_titulo))
      linha = setAt(linha, 295, isoParaDDMMAA(mov?.data_credito || mov?.data_ocorrencia))
      linha = setAt(linha, 324, padDireita((t.nome_sacado || '').toUpperCase(), 70))
      linha = setAt(linha, 394, pad(seq, 6))

      linhas.push(linha)
      idsExportados.push(t.id)
      seq++
    }

    // --- Trailer ---
    // Preenche quantidade de títulos e valor total, em vez de deixar
    // zerado - descoberto comparando com um arquivo que funcionou de
    // verdade no G3: a posição 177-184 (quantidade) batia exatamente com
    // o número de títulos do arquivo. Deixar isso zerado pode ser o motivo
    // do G3 não "confiar" no arquivo pra lançar os valores.
    const quantidadeTitulos = titulos.length
    const valorTotalCentavos = titulos.reduce(
      (soma, t) => soma + Math.round(Number(t.valor_titulo || 0) * 100),
      0
    )
    let trailer = TRAILER_TEMPLATE
    trailer = setAt(trailer, 177, pad(quantidadeTitulos, 7))
    trailer = setAt(trailer, 184, pad(valorTotalCentavos, 16))
    trailer = setAt(trailer, 394, pad(seq, 6))
    linhas.push(trailer)

    const conteudo = linhas.join('\r\n') + '\r\n'

    // Marca os títulos como exportados, pra não exportar de novo na próxima vez
    await supabase
      .from('titulos')
      .update({ exportado_em: new Date().toISOString() })
      .in('id', idsExportados)

    const nomeArquivo = `BAIXAS_${dataHoje}.RET`

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.status(200).send(conteudo)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao exportar baixas' })
  }
}
