import { supabase } from '../../lib/supabaseClient'

// Gerador do .RET de baixas, no MESMO layout confirmado do arquivo
// CB170707_RETORNO_SIMULADO.RET (validado byte a byte contra o retorno real
// da Bancorp em 341RETCLI...RET - as posições de nosso_numero, ocorrencia,
// valor, datas e sacado são as MESMAS em ambos, o que confirma que esse é o
// layout padrão de RETORNO usado pelo sistema/G3, independente da factoring
// de origem).
//
// Posições confirmadas (linha de 400 posições fixas):
//   62-70   nosso_numero (8 dígitos)
//   108-110 código de ocorrência ("06" = liquidação)
//   116-124 referência do título (ex "000728/G") - ECO informativo, não é
//           chave de casamento, mas precisa ser atualizado por título
//   146-152 data de ocorrência (DDMMAA)
//   152-165 valor pago (13 dígitos, sem separador decimal)
//   295-301 data de crédito (DDMMAA)
//   324-394 nome do sacado (70 posições)
//   394-400 número sequencial do registro (6 dígitos)
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

// Referência do título na posição 42-52 (10 posições) - CONFIRMADO que é
// essa a posição que o G3 lê como "Título" (mesma posição usada na própria
// remessa, ex "202600116A"). O campo na posição 116 é só um eco interno que
// o G3 NÃO usa - descoberto comparando o .RET gerado com a saída real do
// G3 ("Lista do Processamento"), que mostrava o MESMO título repetido pra
// todos os registros porque só a posição 116 estava sendo atualizada.
function tituloParaPosicao42(seuNumero) {
  const s = String(seuNumero || '').trim().toUpperCase()
  if (s.length >= 10) return s.slice(0, 10)
  return '0'.repeat(10 - s.length) + s
}

// Referência "eco" na posição 116 (8 posições, ex "000728/G") - mantida por
// consistência/histórico, mas o G3 não usa esse campo para identificar o título.
function referenciaTitulo(seuNumero) {
  const s = String(seuNumero || '').trim()
  if (s.length <= 8) return padDireita(s, 8)
  return s.slice(0, 8)
}

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
      linha = setAt(linha, 42, tituloParaPosicao42(t.seu_numero)) // <-- campo real lido pelo G3
      linha = setAt(linha, 62, pad(t.nosso_numero, 8))
      linha = setAt(linha, 108, '06')
      linha = setAt(linha, 116, referenciaTitulo(t.seu_numero))
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
    let trailer = setAt(TRAILER_TEMPLATE, 394, pad(seq, 6))
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
