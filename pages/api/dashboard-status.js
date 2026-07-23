import { supabase } from '../../lib/supabaseClient'

// Data de hoje (YYYY-MM-DD) no fuso de Brasília, derivada do instante atual
// (não de uma string de data já salva - por isso não cai no mesmo problema
// de "new Date(iso)" documentado no README/CLAUDE.md pra datas de CNAB).
function hojeISOBrasil() {
  const agora = new Date()
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
  return brasilia.toISOString().slice(0, 10)
}

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
      .select('status, valor_titulo, remessa_id, exportado_em, data_vencimento')

    if (erroValores) throw erroValores

    const valorPorStatus = {}
    for (const t of titulosValores || []) {
      valorPorStatus[t.status] = (valorPorStatus[t.status] || 0) + Number(t.valor_titulo || 0)
    }

    // --- Painel por factoring: cada remessa só concilia com o retorno da
    // mesma factoring (ver comentário em schema.sql sobre
    // `remessas.factoring`), então faz sentido acompanhar separadamente o
    // que cada uma tem aberto/liquidado/baixado. Fetch separado de
    // `remessas` + join em JS, mesmo cuidado já usado no casamento de
    // retorno (não nested select). ---
    const { data: remessas, error: erroRemessasFactoring } = await supabase
      .from('remessas')
      .select('id, factoring, portador_nome')

    if (erroRemessasFactoring) throw erroRemessasFactoring

    const factoringPorRemessa = new Map(
      (remessas || []).map((r) => [r.id, r.factoring || 'bancorp'])
    )

    const ABERTO = new Set(['aguardando_retorno', 'confirmado', 'ver_manual'])
    const hojeISO = hojeISOBrasil()
    const vazioFactoring = () => ({
      total: 0,
      aberto: { quantidade: 0, valor: 0 },
      vencido: { quantidade: 0, valor: 0 },
      liquidado: { quantidade: 0, valor: 0 },
      faltaBaixar: { quantidade: 0, valor: 0 },
    })

    const porFactoring = {}
    for (const t of titulosValores || []) {
      const factoring = factoringPorRemessa.get(t.remessa_id) || 'bancorp'
      if (!porFactoring[factoring]) porFactoring[factoring] = vazioFactoring()
      const grupo = porFactoring[factoring]
      const valor = Number(t.valor_titulo || 0)

      grupo.total++
      if (ABERTO.has(t.status)) {
        // Vencido = ainda aberto (sem confirmação de liquidação) e com
        // vencimento já passado - sai da contagem de "aberto" (mutuamente
        // exclusivo), não some da conta: aberto + vencido = total em aberto.
        if (t.data_vencimento && t.data_vencimento < hojeISO) {
          grupo.vencido.quantidade++
          grupo.vencido.valor += valor
        } else {
          grupo.aberto.quantidade++
          grupo.aberto.valor += valor
        }
      }
      if (t.status === 'liquidado') {
        grupo.liquidado.quantidade++
        grupo.liquidado.valor += valor
        if (!t.exportado_em) {
          grupo.faltaBaixar.quantidade++
          grupo.faltaBaixar.valor += valor
        }
      }
    }

    return res.status(200).json({
      porStatus,
      valorPorStatus,
      porFactoring,
      total,
      atualizadoEm: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao buscar status do dashboard' })
  }
}
