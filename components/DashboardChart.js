import { useEffect, useRef, useState } from 'react'
import { supabaseBrowser } from '../lib/supabaseBrowserClient'

// Ordem fixa (nunca por contagem) - mesma lógica de status usada na tabela
// de títulos, do estado neutro até os estados finais bons/ruins.
const STATUS_ORDEM = [
  { chave: 'aguardando_retorno', texto: 'Aguardando retorno', cor: '#8a8f98' },
  { chave: 'confirmado', texto: 'Confirmado', cor: '#0969da' },
  { chave: 'liquidado', texto: 'Liquidado', cor: '#1a7f37' },
  { chave: 'baixado', texto: 'Baixado', cor: '#9a6700' },
  { chave: 'ver_manual', texto: 'Ver manual', cor: '#9a6700' },
  { chave: 'rejeitado', texto: 'Rejeitado', cor: '#cf222e' },
  { chave: 'baixa_rejeitada', texto: 'Baixa rejeitada', cor: '#cf222e' },
]

export default function DashboardChart() {
  const [porStatus, setPorStatus] = useState({})
  const [total, setTotal] = useState(0)
  const [modoTempoReal, setModoTempoReal] = useState(null) // 'realtime' | 'polling'
  const [hover, setHover] = useState(null)
  const pollingRef = useRef(null)

  async function buscarStatus() {
    try {
      const resp = await fetch('/api/dashboard-status')
      const data = await resp.json()
      if (resp.ok) {
        setPorStatus(data.porStatus || {})
        setTotal(data.total || 0)
      }
    } catch {
      // silencioso - próxima tentativa (poll ou evento realtime) corrige
    }
  }

  useEffect(() => {
    buscarStatus()

    if (supabaseBrowser) {
      setModoTempoReal('realtime')
      const canal = supabaseBrowser
        .channel('dashboard_stats_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'dashboard_stats' },
          () => buscarStatus()
        )
        .subscribe()

      return () => {
        supabaseBrowser.removeChannel(canal)
      }
    }

    // Sem chave anon configurada ainda - cai pra polling em vez de travar a
    // feature (ver lib/supabaseBrowserClient.js).
    setModoTempoReal('polling')
    pollingRef.current = setInterval(buscarStatus, 8000)
    return () => clearInterval(pollingRef.current)
  }, [])

  const maior = Math.max(1, ...STATUS_ORDEM.map((s) => porStatus[s.chave] || 0))

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <h2>Status das conciliações</h2>
        <span className="dashboard-selo" title={modoTempoReal === 'realtime' ? 'Atualiza via Supabase Realtime' : 'Atualiza a cada 8s (Realtime não configurado)'}>
          <span className={`dashboard-ponto ${modoTempoReal === 'realtime' ? 'ao-vivo' : ''}`} />
          {modoTempoReal === 'realtime' ? 'Ao vivo' : modoTempoReal === 'polling' ? 'Atualizando' : ''}
        </span>
      </div>

      <div className="dashboard-total">{total} título(s) monitorado(s)</div>

      <div className="dashboard-barras">
        {STATUS_ORDEM.map((s) => {
          const quantidade = porStatus[s.chave] || 0
          const largura = quantidade === 0 ? 0 : Math.max(4, (quantidade / maior) * 100)
          return (
            <div
              key={s.chave}
              className="dashboard-linha"
              onMouseEnter={() => setHover(s.chave)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="dashboard-rotulo">{s.texto}</span>
              <div className="dashboard-trilha">
                <div
                  className="dashboard-barra"
                  style={{ width: `${largura}%`, background: s.cor }}
                />
                {hover === s.chave && quantidade > 0 && (
                  <div className="dashboard-tooltip">
                    {quantidade} · {total > 0 ? Math.round((quantidade / total) * 100) : 0}%
                  </div>
                )}
              </div>
              <span className="dashboard-valor">{quantidade}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
