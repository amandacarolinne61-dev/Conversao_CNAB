import { supabase } from '../../lib/supabaseClient'
import { gerarArquivoBaixas, hojeDDMMAA } from '../../lib/gerarArquivoBaixas'

// Exporta o .RET de baixas em lote: todo título liquidado ainda não
// exportado (exportado_em IS NULL). Pra regenerar o arquivo de títulos
// específicos escolhidos manualmente na tela (incluindo já exportados
// antes), ver pages/api/gerar-baixa-selecionados.js - os dois usam a mesma
// lógica de montagem de campos, só muda a query de quais títulos entram
// (ver lib/gerarArquivoBaixas.js pro detalhamento de posições do layout).

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

export default async function handler(req, res) {
  try {
    const { data: titulos, error } = await supabase
      .from('titulos')
      .select('*, movimentos_retorno(*), remessas(portador_codigo, portador_nome, nome_empresa, factoring)')
      .eq('status', 'liquidado')
      .is('exportado_em', null)

    if (error) throw error

    if (!titulos || titulos.length === 0) {
      res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
      return res.status(200).send('Nenhum titulo liquidado pendente de exportacao.\r\n')
    }

    const conteudo = gerarArquivoBaixas(titulos)

    // Marca os títulos como exportados, pra não exportar de novo na próxima vez
    await supabase
      .from('titulos')
      .update({ exportado_em: new Date().toISOString() })
      .in('id', titulos.map((t) => t.id))

    const nomeArquivo = `BAIXAS_${hojeDDMMAA()}.RET`

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.status(200).send(conteudo)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao exportar baixas' })
  }
}
