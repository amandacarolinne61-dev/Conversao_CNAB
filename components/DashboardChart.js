import { useEffect, useRef, useState } from 'react'
import { supabaseBrowser } from '../lib/supabaseBrowserClient'

// Paleta de status (fundo suave + texto/ícone saturado), validada com
// scripts/validate_palette.js da skill de dataviz: as 4 cores cromáticas
// (azul/verde/âmbar/rosa) passam separação de daltonismo e contraste em
// pares. O cinza neutro (aguardando) fica de fora dessa checagem de
// propósito - é acromático por design (ausência de status, não uma cor
// competindo por identidade com as outras) e sempre vem com ícone + rótulo,
// nunca só a cor, então a distinção nunca depende só do tom.
const STATUS_ORDEM = [
  {
    chave: 'aguardando_retorno',
    texto: 'Aguardando retorno',
    bg: '#eef0f3',
    tx: '#4b5563',
    icone: 'M12 6v6l4 2',
  },
  {
    chave: 'confirmado',
    texto: 'Confirmado',
    bg: '#e6ecff',
    tx: '#2f4bd0',
    icone: 'M9 12l2 2 4-4',
  },
  {
    chave: 'liquidado',
    texto: 'Liquidado',
    bg: '#e2f6ea',
    tx: '#15803d',
    icone: 'M5 13l4 4L19 7',
  },
  {
    chave: 'baixado',
    texto: 'Baixado',
    bg: '#fef3e2',
    tx: '#d97706',
    icone: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  },
  {
    chave: 'ver_manual',
    texto: 'Ver manual',
    bg: '#fef3e2',
    tx: '#d97706',
    icone: 'M12 9v4m0 4h.01M10.3 3.9L2.7 17a1.8 1.8 0 001.5 2.7h15.6a1.8 1.8 0 001.5-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z',
  },
  {
    chave: 'rejeitado',
    texto: 'Rejeitado',
    bg: '#fce7ef',
    tx: '#9d174d',
    icone: 'M6 6l12 12M18 6L6 18',
  },
  {
    chave: 'baixa_rejeitada',
    texto: 'Baixa rejeitada',
    bg: '#fce7ef',
    tx: '#9d174d',
    icone: 'M6 6l12 12M18 6L6 18',
  },
]

function formatarMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarMoedaCompacta(v) {
  const n = Number(v || 0)
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace('.', ',')}mil`
  return formatarMoeda(n)
}

export default function DashboardChart() {
  const [porStatus, setPorStatus] = useState({})
  const [valorPorStatus, setValorPorStatus] = useState({})
  const [total, setTotal] = useState(0)
  const [modoTempoReal, setModoTempoReal] = useState(null) // 'realtime' | 'polling'
  const pollingRef = useRef(null)

  async function buscarStatus() {
    try {
      const resp = await fetch('/api/dashboard-status')
      const data = await resp.json()
      if (resp.ok) {
        setPorStatus(data.porStatus || {})
        setValorPorStatus(data.valorPorStatus || {})
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

  const valorTotal = Object.values(valorPorStatus).reduce((soma, v) => soma + v, 0)
  const emAberto = (porStatus.aguardando_retorno || 0) + (porStatus.confirmado || 0)
  const valorEmAberto = (valorPorStatus.aguardando_retorno || 0) + (valorPorStatus.confirmado || 0)

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <h2>Status das conciliações</h2>
        <span
          className="dashboard-selo"
          title={
            modoTempoReal === 'realtime'
              ? 'Atualiza via Supabase Realtime'
              : 'Atualiza a cada 8s (Realtime não configurado)'
          }
        >
          <span className={`dashboard-ponto ${modoTempoReal === 'realtime' ? 'ao-vivo' : ''}`} />
          {modoTempoReal === 'realtime' ? 'Ao vivo' : modoTempoReal === 'polling' ? 'Atualizando' : ''}
        </span>
      </div>

      <div className="dashboard-hero">
        <div className="dashboard-hero-item">
          <span className="dashboard-hero-valor">{total}</span>
          <span className="dashboard-hero-rotulo">título(s) monitorado(s)</span>
        </div>
        <div className="dashboard-hero-divisor" />
        <div className="dashboard-hero-item">
          <span className="dashboard-hero-valor">{formatarMoeda(valorTotal)}</span>
          <span className="dashboard-hero-rotulo">valor total em carteira</span>
        </div>
        <div className="dashboard-hero-divisor" />
        <div className="dashboard-hero-item">
          <span className="dashboard-hero-valor">{formatarMoeda(valorEmAberto)}</span>
          <span className="dashboard-hero-rotulo">{emAberto} em aberto (aguardando/confirmado)</span>
        </div>
      </div>

      <div className="dashboard-tiles">
        {STATUS_ORDEM.map((s) => {
          const quantidade = porStatus[s.chave] || 0
          const valor = valorPorStatus[s.chave] || 0
          return (
            <div
              key={s.chave}
              className="dashboard-tile"
              style={{ background: s.bg }}
              title={`${quantidade} título(s) · ${formatarMoeda(valor)}`}
            >
              <div className="dashboard-tile-topo">
                <svg
                  className="dashboard-tile-icone"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: s.tx }}
                >
                  <path
                    d={s.icone}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="dashboard-tile-rotulo" style={{ color: s.tx }}>
                  {s.texto}
                </span>
              </div>
              <div className="dashboard-tile-numeros">
                <span className="dashboard-tile-quantidade" style={{ color: s.tx }}>
                  {quantidade}
                </span>
                <span className="dashboard-tile-valor">{formatarMoedaCompacta(valor)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
