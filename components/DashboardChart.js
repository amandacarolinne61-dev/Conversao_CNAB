import { useEffect, useRef, useState } from 'react'
import { supabaseBrowser } from '../lib/supabaseBrowserClient'

function formatarMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarMoedaCompacta(v) {
  const n = Number(v || 0)
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace('.', ',')}mil`
  return formatarMoeda(n)
}

const FACTORING_LABEL = {
  bancorp: 'Bancorp',
  titan: 'Titan',
}

// Mesmas cores dos tiles de status acima ("estilo da primeira linha"), pra
// as colunas Em aberto/Liquidado/Baixado/Falta baixar do painel por
// factoring carregarem o mesmo significado de cor em vez de ficarem em
// preto/cinza neutro.
const COR_ABERTO = '#4b5563'
const COR_LIQUIDADO = '#15803d'
const COR_BAIXADO = '#d97706'
const COR_FALTA_BAIXAR = '#9d174d'

function somarFactoring(lista) {
  return lista.reduce(
    (soma, d) => ({
      total: soma.total + d.total,
      aberto: {
        quantidade: soma.aberto.quantidade + d.aberto.quantidade,
        valor: soma.aberto.valor + d.aberto.valor,
      },
      liquidado: {
        quantidade: soma.liquidado.quantidade + d.liquidado.quantidade,
        valor: soma.liquidado.valor + d.liquidado.valor,
      },
      baixado: {
        quantidade: soma.baixado.quantidade + d.baixado.quantidade,
        valor: soma.baixado.valor + d.baixado.valor,
      },
      faltaBaixar: {
        quantidade: soma.faltaBaixar.quantidade + d.faltaBaixar.quantidade,
        valor: soma.faltaBaixar.valor + d.faltaBaixar.valor,
      },
    }),
    {
      total: 0,
      aberto: { quantidade: 0, valor: 0 },
      liquidado: { quantidade: 0, valor: 0 },
      baixado: { quantidade: 0, valor: 0 },
      faltaBaixar: { quantidade: 0, valor: 0 },
    }
  )
}

// Renderiza tanto a linha "Todas" quanto cada linha de factoring com a
// mesma estrutura/estilo, só variando o destaque (fundo + rótulo em
// negrito na de "Todas").
function renderLinhaFactoring(nome, dados, destaque, key) {
  return (
    <div
      key={key || nome}
      className={`dashboard-factoring-linha${destaque ? ' dashboard-factoring-todas' : ''}`}
    >
      <span className="dashboard-factoring-nome">{nome}</span>
      <span>{dados.total}</span>
      <span style={{ color: COR_ABERTO }}>
        {dados.aberto.quantidade}
        <small>{formatarMoedaCompacta(dados.aberto.valor)}</small>
      </span>
      <span style={{ color: COR_LIQUIDADO }}>
        {dados.liquidado.quantidade}
        <small>{formatarMoedaCompacta(dados.liquidado.valor)}</small>
      </span>
      <span style={{ color: COR_BAIXADO }}>
        {dados.baixado.quantidade}
        <small>{formatarMoedaCompacta(dados.baixado.valor)}</small>
      </span>
      <span style={{ color: COR_FALTA_BAIXAR }}>
        {dados.faltaBaixar.quantidade}
        <small>{formatarMoedaCompacta(dados.faltaBaixar.valor)}</small>
      </span>
    </div>
  )
}

export default function DashboardChart() {
  const [porStatus, setPorStatus] = useState({})
  const [valorPorStatus, setValorPorStatus] = useState({})
  const [porFactoring, setPorFactoring] = useState({})
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
        setPorFactoring(data.porFactoring || {})
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

      {Object.keys(porFactoring).length > 0 && (
        <div className="dashboard-factoring">
          <h3>Por factoring</h3>
          <div className="dashboard-factoring-tabela">
            <div className="dashboard-factoring-linha dashboard-factoring-cabecalho">
              <span style={{ color: 'var(--brand-dark)' }}>Factoring</span>
              <span style={{ color: 'var(--ink)' }}>Total</span>
              <span style={{ color: COR_ABERTO }}>Em aberto</span>
              <span style={{ color: COR_LIQUIDADO }}>Liquidado</span>
              <span style={{ color: COR_BAIXADO }}>Baixado</span>
              <span style={{ color: COR_FALTA_BAIXAR }}>Falta baixar</span>
            </div>
            {renderLinhaFactoring('Todas', somarFactoring(Object.values(porFactoring)), true)}
            {Object.entries(porFactoring).map(([chave, dados]) =>
              renderLinhaFactoring(FACTORING_LABEL[chave] || chave, dados, false, chave)
            )}
          </div>
        </div>
      )}
    </section>
  )
}
