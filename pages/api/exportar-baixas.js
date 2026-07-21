import { supabase } from '../../lib/supabaseClient'

// Templates copiados literalmente do arquivo simulado que você mandou
// (CB170707_RETORNO_SIMULADO.RET) - mesma estrutura de 400 posições.
// Só substituímos os campos variáveis (datas, valores, nome do sacado,
// nosso número e número sequencial) nas posições já validadas no parser
// lib/cnabRetorno.js.

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
  return s.length >= tamanho ? s.slice(0, tamanho) : char.repeat(tamanho - s.length) + s
}

function padDireita(valor, tamanho) {
  const s = String(valor ?? '')
  return s.length >= tamanho ? s.slice(0, tamanho) : s + ' '.repeat(tamanho - s.length)
}

function hojeDDMMAA() {
  const d = new Date()
  return `${pad(d.getDate(), 2)}${pad(d.getMonth() + 1, 2)}${String(d.getFullYear()).slice(2)}`
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
      return res.status(200).send('Nenhum titulo liquidado pendente de exportacao.')
    }

    const linhas = []

    // --- Header ---
    let header = setAt(HEADER_TEMPLATE, 94, hojeDDMMAA())
    header = setAt(header, 394, pad(1, 6))
    linhas.push(header)

    // --- Detalhes: 1 linha por título liquidado ---
    let seq = 2
    const idsExportados = []

    for (const t of titulos) {
      const mov = (t.movimentos_retorno || [])
        .filter((m) => m.gera_baixa)
        .sort((a, b) => (b.data_ocorrencia || '').localeCompare(a.data_ocorrencia || ''))[0]

      let linha = DETAIL_TEMPLATE
      linha = setAt(linha, 62, pad(t.nosso_numero, 8))
      linha = setAt(linha, 108, '06')
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

    // Marca os títulos como exportados, pra não exportar de novo
    await supabase
      .from('titulos')
      .update({ exportado_em: new Date().toISOString() })
      .in('id', idsExportados)

    const nomeArquivo = `BAIXAS_${hojeDDMMAA()}.RET`

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.status(200).send(conteudo)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao exportar baixas' })
  }
}
