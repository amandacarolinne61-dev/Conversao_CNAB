import { useEffect, useState, useCallback } from 'react'
import DashboardChart from '../components/DashboardChart'

async function lerArquivoComoLatin1(file) {
  const buffer = await file.arrayBuffer()
  return new TextDecoder('iso-8859-1').decode(buffer)
}

// Formata a data sem passar pelo objeto Date (evita bug de "1 dia a menos"
// causado pelo fuso horário: new Date("2026-02-22") vira meia-noite UTC,
// que no fuso do Brasil "volta" um dia).
function formatarData(iso) {
  if (!iso) return '—'
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

const STATUS_LABEL = {
  aguardando_retorno: { texto: 'Aguardando retorno', bg: 'var(--cor-neutro-bg)', tx: 'var(--cor-neutro-tx)' },
  liquidado: { texto: 'Liquidado', bg: 'var(--cor-verde-bg)', tx: 'var(--cor-verde-tx)' },
  confirmado: { texto: 'Confirmado', bg: 'var(--cor-azul-bg)', tx: 'var(--cor-azul-tx)' },
  rejeitado: { texto: 'Rejeitado', bg: 'var(--cor-vermelho-bg)', tx: 'var(--cor-vermelho-tx)' },
  baixado: { texto: 'Baixado', bg: 'var(--cor-ambar-bg)', tx: 'var(--cor-ambar-tx)' },
  baixa_rejeitada: { texto: 'Baixa rejeitada', bg: 'var(--cor-vermelho-bg)', tx: 'var(--cor-vermelho-tx)' },
  ver_manual: { texto: 'Ver manual', bg: 'var(--cor-ambar-bg)', tx: 'var(--cor-ambar-tx)' },
}

export default function Home() {
  const [titulos, setTitulos] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [mensagem, setMensagem] = useState(null)
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [factoringRemessa, setFactoringRemessa] = useState('bancorp')
  const [factoringRetorno, setFactoringRetorno] = useState('bancorp')

  const carregarTitulos = useCallback(async () => {
    const resp = await fetch('/api/titulos')
    const data = await resp.json()
    setTitulos(data.titulos || [])
  }, [])

  useEffect(() => {
    carregarTitulos()
  }, [carregarTitulos])

  async function handleUploadRemessa(e) {
    const file = e.target.files[0]
    if (!file) return
    setCarregando(true)
    setMensagem(null)
    try {
      const conteudo = await lerArquivoComoLatin1(file)
      const resp = await fetch('/api/upload-remessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo, nomeArquivo: file.name, factoring: factoringRemessa }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      setMensagem({
        tipo: data.aviso ? 'aviso' : 'ok',
        texto: `${data.quantidadeTitulos} título(s) gravado(s).${data.aviso ? ' ' + data.aviso : ''}`,
      })
      carregarTitulos()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setCarregando(false)
      e.target.value = ''
    }
  }

  async function handleUploadRetorno(e) {
    const file = e.target.files[0]
    if (!file) return
    setCarregando(true)
    setMensagem(null)
    try {
      const conteudo = await lerArquivoComoLatin1(file)
      const endpoint = factoringRetorno === 'titan' ? '/api/upload-retorno-titan' : '/api/upload-retorno'
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo, nomeArquivo: file.name }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      const temAviso = (data.titulosAmbiguos || []).length > 0 || (data.naoConciliados || []).length > 0
      setMensagem({ tipo: temAviso ? 'aviso' : 'ok', texto: data.resumo })
      carregarTitulos()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setCarregando(false)
      e.target.value = ''
    }
  }

  function toggleSelecionado(id) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  function toggleSelecionarTodos() {
    // "Gerar remessa" só vale pra títulos liquidados - só esses entram no
    // "selecionar todos" (os demais nem têm checkbox marcável na linha).
    const liquidados = titulos.filter((t) => t.status === 'liquidado')
    setSelecionados((atual) =>
      liquidados.length > 0 && atual.size === liquidados.length
        ? new Set()
        : new Set(liquidados.map((t) => t.id))
    )
  }

  function gerarRemessaSelecionados() {
    const ids = [...selecionados].join(',')
    window.location.href = `/api/gerar-remessa?ids=${encodeURIComponent(ids)}`
  }

  // Exportação em CSV (abre direto no Excel) com todos os campos relevantes
  // pra conferência manual - não só o que já aparece nas colunas da tela.
  // Feita no navegador a partir do que já está carregado, sem chamada nova
  // ao servidor. Usa ";" como separador (padrão do Excel em pt-BR, que usa
  // vírgula como separador decimal) e um BOM UTF-8 no início, senão o Excel
  // exibe acentuação errada ao abrir o arquivo direto (sem passar por um
  // assistente de importação).
  function exportarExcel() {
    const colunas = [
      'Nosso Número',
      'Seu Número',
      'Banco/Portador',
      'Sacado',
      'CNPJ/CPF Sacado',
      'Valor Título',
      'Valor Pago',
      'Diferença',
      'Vencimento',
      'Status',
      'Última Ocorrência',
      'Data Ocorrência',
    ]

    const escapar = (valor) => {
      const s = String(valor ?? '')
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const linhas = titulos.map((t) => {
      const status = STATUS_LABEL[t.status] || { texto: t.status }
      const ultimoMov = (t.movimentos_retorno || []).sort((a, b) =>
        (b.data_ocorrencia || '').localeCompare(a.data_ocorrencia || '')
      )[0]
      const valorTitulo = Number(t.valor_titulo || 0)
      const valorPago = ultimoMov && ultimoMov.valor_pago != null ? Number(ultimoMov.valor_pago) : null
      const diferenca = valorPago != null ? valorPago - valorTitulo : null

      return [
        t.nosso_numero,
        t.seu_numero,
        t.remessas?.portador_nome || '',
        t.nome_sacado,
        t.cnpj_sacado,
        valorTitulo.toFixed(2).replace('.', ','),
        valorPago != null ? valorPago.toFixed(2).replace('.', ',') : '',
        diferenca != null ? diferenca.toFixed(2).replace('.', ',') : '',
        formatarData(t.data_vencimento),
        status.texto,
        ultimoMov ? ultimoMov.ocorrencia_descricao : '',
        ultimoMov ? formatarData(ultimoMov.data_ocorrencia) : '',
      ]
        .map(escapar)
        .join(';')
    })

    const conteudo = '﻿' + [colunas.join(';'), ...linhas].join('\r\n')
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `titulos_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container">
      <header>
        <div className="logo-marca">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M4 12L9 17L20 6"
              stroke="white"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <h1>Conciliação CNAB · Remessa &times; Retorno</h1>
          <p className="subtitulo">Energy Power / Money Solution — Factoring</p>
        </div>
      </header>

      <section className="cards">
        <div className="card upload-card">
          <span className="card-icone">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 16V4M12 4L7 9M12 4L17 9M5 20H19"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="card-titulo">Enviar remessa</span>
          <span className="card-desc">Arquivo gerado antes do envio ao banco/portador</span>
          <select
            className="select-factoring"
            value={factoringRemessa}
            onChange={(e) => setFactoringRemessa(e.target.value)}
            disabled={carregando}
          >
            <option value="bancorp">Bancorp (CNAB 400)</option>
            <option value="titan">Titan (CSV)</option>
          </select>
          <input type="file" onChange={handleUploadRemessa} disabled={carregando} />
        </div>

        <div className="card upload-card">
          <span className="card-icone">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 4V16M12 16L7 11M12 16L17 11M5 20H19"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="card-titulo">Enviar retorno</span>
          <span className="card-desc">Arquivo recebido da factoring</span>
          <select
            className="select-factoring"
            value={factoringRetorno}
            onChange={(e) => setFactoringRetorno(e.target.value)}
            disabled={carregando}
          >
            <option value="bancorp">Bancorp (CNAB 400)</option>
            <option value="titan">Titan (CSV)</option>
          </select>
          <input type="file" onChange={handleUploadRetorno} disabled={carregando} />
        </div>

        <a className="card upload-card" href="/api/exportar-baixas" style={{ textDecoration: 'none' }}>
          <span className="card-icone">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4 4H14L20 10V20H4V4Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M14 4V10H20" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="card-titulo">Exportar baixas</span>
          <span className="card-desc">Arquivo .RET com os títulos liquidados, pronto pra importar no G3</span>
        </a>
      </section>

      {mensagem && <div className={`mensagem ${mensagem.tipo}`}>{mensagem.texto}</div>}
      {carregando && <div className="mensagem">Processando...</div>}

      <DashboardChart />

      <section>
        <div className="titulos-header">
          <h2>Títulos</h2>
          <div className="titulos-header-acoes">
            {selecionados.size > 0 && (
              <button className="btn-gerar-remessa" onClick={gerarRemessaSelecionados}>
                Gerar remessa ({selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''})
              </button>
            )}
            <button
              className="btn-exportar-excel"
              onClick={exportarExcel}
              disabled={titulos.length === 0}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Exportar Excel (.csv)
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    titulos.some((t) => t.status === 'liquidado') &&
                    titulos.filter((t) => t.status === 'liquidado').every((t) => selecionados.has(t.id))
                  }
                  onChange={toggleSelecionarTodos}
                  disabled={!titulos.some((t) => t.status === 'liquidado')}
                  title="Selecionar todos os títulos liquidados"
                />
              </th>
              <th>Nosso Número</th>
              <th>Seu Número</th>
              <th>Banco/Portador</th>
              <th>Sacado</th>
              <th>Valor</th>
              <th>Valor Pago</th>
              <th>Diferença</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th>Última ocorrência</th>
            </tr>
          </thead>
          <tbody>
            {titulos.map((t) => {
              const status = STATUS_LABEL[t.status] || {
                texto: t.status,
                bg: 'var(--cor-neutro-bg)',
                tx: 'var(--cor-neutro-tx)',
              }
              const ultimoMov = (t.movimentos_retorno || []).sort((a, b) =>
                (b.data_ocorrencia || '').localeCompare(a.data_ocorrencia || '')
              )[0]
              const valorTitulo = Number(t.valor_titulo || 0)
              const valorPago = ultimoMov && ultimoMov.valor_pago != null ? Number(ultimoMov.valor_pago) : null
              const diferenca = valorPago != null ? valorPago - valorTitulo : null
              const temDiferenca = diferenca != null && Math.abs(diferenca) > 0.005
              const formatarMoeda = (v) =>
                v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
              return (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selecionados.has(t.id)}
                      onChange={() => toggleSelecionado(t.id)}
                      disabled={t.status !== 'liquidado'}
                      title={t.status !== 'liquidado' ? 'Só títulos liquidados podem ser incluídos numa remessa' : undefined}
                    />
                  </td>
                  <td>{t.nosso_numero}</td>
                  <td>{t.seu_numero}</td>
                  <td>{t.remessas?.portador_nome || '—'}</td>
                  <td>{t.nome_sacado}</td>
                  <td>{formatarMoeda(valorTitulo)}</td>
                  <td>{valorPago != null ? formatarMoeda(valorPago) : '—'}</td>
                  <td style={temDiferenca ? { color: '#cf222e', fontWeight: 'bold' } : undefined}>
                    {diferenca != null ? formatarMoeda(diferenca) : '—'}
                  </td>
                  <td>{formatarData(t.data_vencimento)}</td>
                  <td>
                    <span className="status-pill" style={{ background: status.bg, color: status.tx }}>
                      {status.texto}
                    </span>
                  </td>
                  <td>{ultimoMov ? ultimoMov.ocorrencia_descricao : '—'}</td>
                </tr>
              )
            })}
            {titulos.length === 0 && (
              <tr>
                <td colSpan={11} className="vazio">
                  Nenhum título ainda. Envie uma remessa pra começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
