import { Fragment, useEffect, useRef, useState } from 'react'
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

function hexParaRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const FACTORING_LABEL = {
  bancorp: 'BANCORP',
  titan: 'TITAN',
  baltic: 'BALTIC',
  apollo: 'APOLLO',
}

const COR_NEUTRO = '#6b7280'
const COR_ABERTO = '#2563eb'
const COR_VENCIDO = '#dc2626'
const COR_LIQUIDADO = '#15803d'

// Colunas de status do painel "Por factoring" - cor de cada uma é usada
// tanto na faixa de fundo quanto no badge dentro da célula, pra manter o
// mesmo significado de cor em toda a coluna. "Vencido" é vermelho puro por
// pedido explícito do usuário - ver nota longa em globals.css sobre por que
// isso não passa na validação de daltonismo (não sobra espaço no círculo de
// cores pra uma 6ª cor distinguível junto do âmbar e do vermelho já usado
// em Rejeitado/Baixa rejeitada).
const COLUNAS_STATUS = [
  { chave: 'aberto', rotulo: 'Aguardando retorno', cor: COR_ABERTO, col: 3 },
  { chave: 'vencido', rotulo: 'Vencidos', cor: COR_VENCIDO, col: 4 },
  { chave: 'liquidado', rotulo: 'Liquidado', cor: COR_LIQUIDADO, col: 5 },
]

function somarFactoring(lista) {
  return lista.reduce(
    (soma, d) => ({
      total: soma.total + d.total,
      totalValor: soma.totalValor + d.totalValor,
      aberto: {
        quantidade: soma.aberto.quantidade + d.aberto.quantidade,
        valor: soma.aberto.valor + d.aberto.valor,
      },
      vencido: {
        quantidade: soma.vencido.quantidade + d.vencido.quantidade,
        valor: soma.vencido.valor + d.vencido.valor,
      },
      liquidado: {
        quantidade: soma.liquidado.quantidade + d.liquidado.quantidade,
        valor: soma.liquidado.valor + d.liquidado.valor,
      },
    }),
    {
      total: 0,
      totalValor: 0,
      aberto: { quantidade: 0, valor: 0 },
      vencido: { quantidade: 0, valor: 0 },
      liquidado: { quantidade: 0, valor: 0 },
    }
  )
}

// Cada linha vira 6 células soltas (não uma div-linha), todas posicionadas
// por gridRow/gridColumn explícitos - assim elas ficam no mesmo grid que as
// faixas de fundo por coluna (que precisam de linhas/colunas explícitas pra
// conseguir se sobrepor de propósito, cobrindo cabeçalho + todas as linhas).
function renderLinhaFactoring(rowIndex, nome, dados, destaque, key) {
  return (
    <Fragment key={key || nome}>
      <div
        className={`factoring-celula factoring-celula-nome${destaque ? ' factoring-celula-todas' : ''}`}
        style={{ gridRow: rowIndex, gridColumn: 1 }}
      >
        {nome}
      </div>
      <div
        className={`factoring-celula factoring-celula-total${destaque ? ' factoring-celula-todas' : ''}`}
        style={{ gridRow: rowIndex, gridColumn: 2 }}
      >
        <span className="status-badge" style={{ background: COR_NEUTRO }}>
          <b>{dados.total}</b>
          {formatarMoedaCompacta(dados.totalValor)}
        </span>
      </div>
      {COLUNAS_STATUS.map(({ chave, cor, col }) => (
        <div
          key={chave}
          className="factoring-celula factoring-celula-status"
          style={{ gridRow: rowIndex, gridColumn: col }}
        >
          <span className="status-badge" style={{ background: cor }}>
            <b>{dados[chave].quantidade}</b>
            {formatarMoedaCompacta(dados[chave].valor)}
          </span>
        </div>
      ))}
    </Fragment>
  )
}

export default function DashboardChart() {
  const [valorPorStatus, setValorPorStatus] = useState({})
  const [porFactoring, setPorFactoring] = useState({})
  const [aberto, setAberto] = useState({ quantidade: 0, valor: 0 })
  const [vencido, setVencido] = useState({ quantidade: 0, valor: 0 })
  const [total, setTotal] = useState(0)
  const [modoTempoReal, setModoTempoReal] = useState(null) // 'realtime' | 'polling'
  const pollingRef = useRef(null)

  async function buscarStatus() {
    try {
      const resp = await fetch('/api/dashboard-status')
      const data = await resp.json()
      if (resp.ok) {
        setValorPorStatus(data.valorPorStatus || {})
        setPorFactoring(data.porFactoring || {})
        setAberto(data.aberto || { quantidade: 0, valor: 0 })
        setVencido(data.vencido || { quantidade: 0, valor: 0 })
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

  const factoringsOrdenados = Object.entries(porFactoring)

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
          <span
            className="dashboard-pill"
            style={{ background: hexParaRgba(COR_NEUTRO, 0.1), color: COR_NEUTRO }}
          >
            {total}
          </span>
          <span className="dashboard-hero-rotulo">título(s) monitorado(s)</span>
        </div>
        <div className="dashboard-hero-divisor" />
        <div className="dashboard-hero-item">
          <span
            className="dashboard-pill"
            style={{ background: hexParaRgba(COR_ABERTO, 0.1), color: COR_ABERTO }}
          >
            {formatarMoeda(valorTotal)}
          </span>
          <span className="dashboard-hero-rotulo">valor total em carteira</span>
        </div>
        <div className="dashboard-hero-divisor" />
        <div className="dashboard-hero-item">
          <span
            className="dashboard-pill"
            style={{ background: hexParaRgba(COR_ABERTO, 0.1), color: COR_ABERTO }}
          >
            {formatarMoeda(aberto.valor)}
          </span>
          <span className="dashboard-hero-rotulo">{aberto.quantidade} aguardando retorno</span>
        </div>
        <div className="dashboard-hero-divisor" />
        <div className="dashboard-hero-item">
          <span
            className="dashboard-pill"
            style={{ background: hexParaRgba(COR_VENCIDO, 0.1), color: COR_VENCIDO }}
          >
            {formatarMoeda(vencido.valor)}
          </span>
          <span className="dashboard-hero-rotulo">{vencido.quantidade} vencido(s)</span>
        </div>
      </div>

      {factoringsOrdenados.length > 0 && (
        <div className="dashboard-factoring">
          <h3>Por factoring</h3>
          <div className="dashboard-factoring-tabela">
            {COLUNAS_STATUS.map(({ chave, cor, col }) => (
              <div
                key={`banda-${chave}`}
                className="factoring-banda"
                style={{
                  gridRow: '1 / -1',
                  gridColumn: col,
                  background: hexParaRgba(cor, 0.06),
                  boxShadow: `inset 0 0 0 1px ${hexParaRgba(cor, 0.25)}`,
                }}
              />
            ))}

            <div
              className="factoring-celula factoring-th factoring-celula-nome"
              style={{ gridRow: 1, gridColumn: 1 }}
            >
              Factoring
            </div>
            <div
              className="factoring-celula factoring-th factoring-celula-total"
              style={{ gridRow: 1, gridColumn: 2 }}
            >
              Total
            </div>
            {COLUNAS_STATUS.map(({ chave, rotulo, cor, col }) => (
              <div
                key={chave}
                className="factoring-celula factoring-th factoring-celula-status"
                style={{ gridRow: 1, gridColumn: col, color: cor }}
              >
                {rotulo}
              </div>
            ))}

            {renderLinhaFactoring(2, 'Todas', somarFactoring(Object.values(porFactoring)), true)}
            {factoringsOrdenados.map(([chave, dados], i) =>
              renderLinhaFactoring(i + 3, FACTORING_LABEL[chave] || chave, dados, false, chave)
            )}
          </div>
        </div>
      )}
    </section>
  )
}
