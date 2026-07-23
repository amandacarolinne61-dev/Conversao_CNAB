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

    // Soma de valor_titulo por status - calculada aqui (servidor, service
    // role) e não em `dashboard_stats`, que é a única tabela com policy de
    // leitura pública (anon) pra permitir Realtime no navegador. Somar valor
    // ali exporia o total em R$ da carteira por status pra quem tiver a
    // chave anon; aqui fica só na resposta JSON desta rota, que já é
    // server-side o tempo todo (ver lib/supabaseClient.js).
    const { data: titulosValores, error: erroValores } = await supabase
      .from('titulos')
      .select('status, valor_titulo')

    if (erroValores) throw erroValores

    const valorPorStatus = {}
    for (const t of titulosValores || []) {
      valorPorStatus[t.status] = (valorPorStatus[t.status] || 0) + Number(t.valor_titulo || 0)
    }

    return res.status(200).json({
      porStatus,
      valorPorStatus,
      total,
      atualizadoEm: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao buscar status do dashboard' })
  }
}
