import { supabase } from '../../lib/supabaseClient'

// Gera um arquivo de remessa CNAB 400 contendo só os títulos selecionados
// manualmente na tela, pra reenvio ao banco/portador. Só aceita títulos com
// status 'liquidado' (mesma regra aplicada na tela, reforçada aqui). Não
// cria nem altera nenhum registro no banco - é só leitura + montagem de
// arquivo (mesmo espírito do exportar-baixas.js), então o mesmo título pode
// ser incluído em quantos reenvios forem precisos, sem travar por já ter
// sido enviado antes.
//
// Diferente do exportar-baixas.js (que monta a linha campo a campo a partir
// de um template), aqui as linhas de detalhe (tipo 1) e mensagem (tipo 5) de
// cada título, e o header/trailer da remessa original, são reaproveitados
// BRUTOS/verbatim (`linha_bruta_detalhe`, `linha_bruta_mensagem`,
// `header_bruto`, `trailer_bruto` - ver schema.sql) - só a data de geração
// do header e o sequencial de registro (posição 394-400) de cada linha são
// reescritos. Isso evita reconstruir uma linha de remessa do zero a partir
// do layout oficial, que esse projeto nunca validou byte a byte (diferente
// do que já foi confirmado contra arquivos reais como CB210704.TXT).
//
// Só funciona pra títulos enviados depois que essas colunas passaram a
// existir - títulos mais antigos não têm a linha bruta guardada e não podem
// ser incluídos num reenvio por aqui.

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

function pad(valor, tamanho, char = '0') {
  const s = String(valor ?? '')
  return s.length >= tamanho ? s.slice(-tamanho) : char.repeat(tamanho - s.length) + s
}

function setAt(str, start, valor) {
  return str.slice(0, start) + valor + str.slice(start + valor.length)
}

function hojeDDMMAA() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aa = String(d.getFullYear()).slice(2)
  return `${dd}${mm}${aa}`
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
      .select('*, remessas(header_bruto, trailer_bruto, portador_codigo, portador_nome)')
      .in('id', ids)

    if (error) throw error

    if (!titulos || titulos.length === 0) {
      return res.status(404).json({ error: 'Nenhum dos títulos selecionados foi encontrado' })
    }

    // Reforço server-side da mesma regra já aplicada na tela (checkbox
    // desabilitado pra não-liquidados): só título liquidado entra numa
    // remessa gerada por aqui.
    const naoLiquidados = titulos.filter((t) => t.status !== 'liquidado')
    if (naoLiquidados.length > 0) {
      return res.status(400).json({
        error: `⚠️ ${naoLiquidados.length} título(s) selecionado(s) não estão liquidados e não podem entrar numa remessa gerada: ${naoLiquidados
          .slice(0, 10)
          .map((t) => t.nosso_numero)
          .join(', ')}${naoLiquidados.length > 10 ? '...' : ''}`,
      })
    }

    const semLinhaBruta = titulos.filter((t) => !t.linha_bruta_detalhe || !t.remessas?.header_bruto)
    if (semLinhaBruta.length > 0) {
      return res.status(400).json({
        error: `⚠️ ${semLinhaBruta.length} título(s) foram enviados antes desse recurso existir e não têm a linha original da remessa guardada - não podem ser incluídos num reenvio: ${semLinhaBruta
          .slice(0, 10)
          .map((t) => t.nosso_numero)
          .join(', ')}${semLinhaBruta.length > 10 ? '...' : ''}`,
      })
    }

    // Assume que todos os títulos selecionados são do mesmo portador -
    // reaproveita o header/trailer do primeiro (mesma limitação documentada
    // em exportar-baixas.js: se um dia isso não for verdade, o reenvio
    // precisa ser feito em lotes separados por portador).
    const remessaRef = titulos[0].remessas || {}
    const dataHoje = hojeDDMMAA()

    const linhas = []
    let seq = 1

    let header = remessaRef.header_bruto
    header = setAt(header, 94, dataHoje) // data de geração
    header = setAt(header, 394, pad(seq, 6))
    linhas.push(header)
    seq++

    const ordenados = [...titulos].sort((a, b) => (a.nosso_numero || '').localeCompare(b.nosso_numero || ''))

    for (const t of ordenados) {
      const detalhe = setAt(t.linha_bruta_detalhe, 394, pad(seq, 6))
      linhas.push(detalhe)
      seq++

      if (t.linha_bruta_mensagem) {
        const mensagem = setAt(t.linha_bruta_mensagem, 394, pad(seq, 6))
        linhas.push(mensagem)
        seq++
      }
    }

    const trailer = setAt(remessaRef.trailer_bruto, 394, pad(seq, 6))
    linhas.push(trailer)

    const conteudo = linhas.join('\r\n') + '\r\n'
    const nomeArquivo = `REMESSA_REENVIO_${dataHoje}.TXT`

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.status(200).send(conteudo)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao gerar remessa' })
  }
}
