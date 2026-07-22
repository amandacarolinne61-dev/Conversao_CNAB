import { useEffect, useState, useCallback } from 'react'

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
  aguardando_retorno: { texto: 'Aguardando retorno', cor: '#8a8f98' },
  liquidado: { texto: 'Liquidado', cor: '#1a7f37' },
  confirmado: { texto: 'Confirmado', cor: '#0969da' },
  rejeitado: { texto: 'Rejeitado', cor: '#cf222e' },
  baixado: { texto: 'Baixado', cor: '#9a6700' },
  baixa_rejeitada: { texto: 'Baixa rejeitada', cor: '#cf222e' },
  ver_manual: { texto: 'Ver manual', cor: '#9a6700' },
}

export default function Home() {
  const [titulos, setTitulos] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

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
        body: JSON.stringify({ conteudo, nomeArquivo: file.name }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      setMensagem({ tipo: 'ok', texto: `Remessa gravada: ${data.quantidadeTitulos} título(s).` })
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
      const resp = await fetch('/api/upload-retorno', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo, nomeArquivo: file.name }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      const naoEncontrados = data.resultado.filter((r) => !r.encontrado && !r.ambiguo).length
      const ambiguos = data.titulosAmbiguos || []
      setMensagem({
        tipo: ambiguos.length > 0 ? 'aviso' : 'ok',
        texto: `Retorno processado: ${data.resultado.length} movimento(s)${
          naoEncontrados ? `, ${naoEncontrados} sem título correspondente` : ''
        }${
          ambiguos.length > 0
            ? `. ⚠️ ${ambiguos.length} com número de título duplicado, não vinculados automaticamente: ${ambiguos
                .map((a) => a.numeroTitulo)
                .join(', ')} — resolva manualmente.`
            : '.'
        }`,
      })
      carregarTitulos()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setCarregando(false)
      e.target.value = ''
    }
  }

  return (
    <div className="container">
      <header>
        <h1>Conciliação CNAB · Remessa &times; Retorno</h1>
        <p className="subtitulo">Energy Power / Money Solution — Factoring</p>
      </header>

      <section className="cards">
        <label className="card upload-card">
          <span className="card-titulo">Enviar remessa</span>
          <span className="card-desc">Arquivo gerado antes do envio ao banco/portador</span>
          <input type="file" onChange={handleUploadRemessa} disabled={carregando} />
        </label>

        <label className="card upload-card">
          <span className="card-titulo">Enviar retorno</span>
          <span className="card-desc">Arquivo recebido da factoring (ex: Bancorp)</span>
          <input type="file" onChange={handleUploadRetorno} disabled={carregando} />
        </label>

        <a className="card upload-card" href="/api/exportar-baixas" style={{ textDecoration: 'none' }}>
          <span className="card-titulo">Exportar baixas</span>
          <span className="card-desc">Arquivo .RET com os títulos liquidados, pronto pra importar no G3</span>
        </a>
      </section>

      {mensagem && <div className={`mensagem ${mensagem.tipo}`}>{mensagem.texto}</div>}
      {carregando && <div className="mensagem">Processando...</div>}

      <section>
        <h2>Títulos</h2>
        <table>
          <thead>
            <tr>
              <th>Nosso Número</th>
              <th>Seu Número</th>
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
              const status = STATUS_LABEL[t.status] || { texto: t.status, cor: '#8a8f98' }
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
                  <td>{t.nosso_numero}</td>
                  <td>{t.seu_numero}</td>
                  <td>{t.nome_sacado}</td>
                  <td>{formatarMoeda(valorTitulo)}</td>
                  <td>{valorPago != null ? formatarMoeda(valorPago) : '—'}</td>
                  <td style={temDiferenca ? { color: '#cf222e', fontWeight: 'bold' } : undefined}>
                    {diferenca != null ? formatarMoeda(diferenca) : '—'}
                  </td>
                  <td>{formatarData(t.data_vencimento)}</td>
                  <td>
                    <span className="status-pill" style={{ background: status.cor }}>
                      {status.texto}
                    </span>
                  </td>
                  <td>{ultimoMov ? ultimoMov.ocorrencia_descricao : '—'}</td>
                </tr>
              )
            })}
            {titulos.length === 0 && (
              <tr>
                <td colSpan={9} className="vazio">
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
