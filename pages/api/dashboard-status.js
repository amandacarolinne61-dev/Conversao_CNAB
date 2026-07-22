import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const { data, error } = await supabase
      .from('dashboard_stats')
      .select('status, quantidade, atualizado_em')

    if (error) throw error

    const porStatus = Object.fromEntries((data || []).map((d) => [d.status, d.quantidade]))
    const total = (data || []).reduce((soma, d) => soma + d.quantidade, 0)

    return res.status(200).json({ porStatus, total, atualizadoEm: new Date().toISOString() })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao buscar status do dashboard' })
  }
}
