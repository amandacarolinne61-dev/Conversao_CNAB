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

const HEADER_TEMPLATE =
  '02RETORNO01COBRANCA       910100759455        ZPEL COMERCIAL LTDA           398BANCO ITAU SA  17072600000BPI00001170726                                                                                                                                                                                                                                                                                   000001'

const DETAIL_TEMPLATE =
  '10250484361000129910100759455        00154000000728GV         00000248            109000002481             E06170726000728/G  00000248            170726000000027600034100000010000000000250                          0000000000000000000000000000000000000000000000275750000000000000000000000000000  1707260000      0000000000000MONEY SOLUTION EMPRESARIAL LTD                                      AA000002'

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

// Referência do título (campo "eco", 8 posições, ex "000728/G").
// Usa o seu_numero salvo; se não couber no padrão num+"/"+letra, faz um
// best-effort truncando/preenchendo - não afeta o casamento por nosso_numero.
function referenciaTitulo(seuNumero) {
  const s = String(seuNumero || '').trim()
  if (s.length <= 8) return padDireita(s, 8)
  return s.slice(0, 8)
}

export default async function handler(req, res) {
  try {
    const { data: titulos, error } = await supabase
      .from('titulos')
      .select('*, movimentos_retorno(*)')
      .eq('status', 'liquidado')
      .is('exportado_em', null)

    if (error) throw error

    if (!titulos || titulos.length === 0) {
      res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
      return res.status(200).send('Nenhum titulo liquidado pendente de exportacao.\r\n')
    }

    const linhas = []
    const dataHoje = hojeDDMMAA()

    // --- Header ---
    let header = HEADER_TEMPLATE
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
      linha = setAt(linha, 62, pad(t.nosso_numero, 8))
      linha = setAt(linha, 108, '06')
      linha = setAt(linha, 116, referenciaTitulo(t.seu_numero))
      linha = setAt(linha, 146, isoParaDDMMAA(mov?.data_ocorrencia))
      linha = setAt(linha, 152, valorParaCNAB(mov?.valor_pago ?? t.valor_titulo))
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
