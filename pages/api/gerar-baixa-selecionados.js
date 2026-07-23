import { supabase } from '../../lib/supabaseClient'
import { gerarArquivoBaixas, hojeDDMMAA } from '../../lib/gerarArquivoBaixas'

// Regera o .RET de baixas (mesmo layout/lógica de exportar-baixas.js, via
// lib/gerarArquivoBaixas.js) só pros títulos selecionados manualmente na
// tela, em vez do lote automático (status='liquidado' AND exportado_em IS
// NULL). Cobre o caso de precisar reexportar um título que já teve a baixa
// processada antes (ex: arquivo original se perdeu, ou precisa reenviar por
// algum motivo) - por isso aceita tanto 'liquidado' quanto 'baixado' (mesma
// regra já aplicada no checkbox da tela, reforçada aqui), sem exigir
// exportado_em IS NULL. Marca exportado_em de novo em cada regeneração,
// igual ao endpoint automático.

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const idsParam = req.query.ids
    const ids = String(idsParam || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Nenhum título selecionado' })
    }

    const { data: titulos, error } = await supabase
      .from('titulos')
      .select('*, movimentos_retorno(*), remessas(portador_codigo, portador_nome, nome_empresa, factoring)')
      .in('id', ids)

    if (error) throw error

    if (!titulos || titulos.length === 0) {
      return res.status(404).json({ error: 'Nenhum dos títulos selecionados foi encontrado' })
    }

    // Reforço server-side da mesma regra já aplicada na tela (checkbox
    // desabilitado fora disso): só título liquidado ou baixado gera baixa.
    const naoElegiveis = titulos.filter((t) => t.status !== 'liquidado' && t.status !== 'baixado')
    if (naoElegiveis.length > 0) {
      return res.status(400).json({
        error: `⚠️ ${naoElegiveis.length} título(s) selecionado(s) não estão liquidados nem baixados e não podem gerar um arquivo de baixa: ${naoElegiveis
          .slice(0, 10)
          .map((t) => t.nosso_numero)
          .join(', ')}${naoElegiveis.length > 10 ? '...' : ''}`,
      })
    }

    const conteudo = gerarArquivoBaixas(titulos)

    await supabase
      .from('titulos')
      .update({ exportado_em: new Date().toISOString() })
      .in('id', titulos.map((t) => t.id))

    const nomeArquivo = `BAIXAS_REGERADAS_${hojeDDMMAA()}.RET`

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.status(200).send(conteudo)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao gerar baixa' })
  }
}
