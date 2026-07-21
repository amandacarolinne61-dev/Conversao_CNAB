import { supabase } from '../../lib/supabaseClient'
import { parseRetorno } from '../../lib/cnabRetorno'

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

const STATUS_POR_OCORRENCIA = {
  '02': 'confirmado',
  '03': 'rejeitado',
  '06': 'liquidado',
  '09': 'baixado',
  '15': 'baixa_rejeitada',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const { conteudo, nomeArquivo } = req.body
    if (!conteudo) {
      return res.status(400).json({ error: 'Conteúdo do arquivo não informado' })
    }

    const { cabecalho, movimentos } = parseRetorno(conteudo)

    if (movimentos.length === 0) {
      return res.status(400).json({ error: 'Nenhum movimento encontrado no arquivo' })
    }

    // --- Duplicidade: mesmo Nosso Número + mesma ocorrência + mesma data já existe? ---
    const nossosNumeros = [...new Set(movimentos.map((m) => m.nossoNumero).filter(Boolean))]

    const { data: movimentosExistentes, error: erroChecagem } = await supabase
      .from('movimentos_retorno')
      .select('nosso_numero, ocorrencia_codigo, data_ocorrencia, ocorrencia_descricao')
      .in('nosso_numero', nossosNumeros)

    if (erroChecagem) throw erroChecagem

    const chaveExistente = new Set(
      (movimentosExistentes || []).map(
        (m) => `${m.nosso_numero}|${m.ocorrencia_codigo}|${m.data_ocorrencia}`
      )
    )

    const duplicados = movimentos.filter((m) =>
      chaveExistente.has(`${m.nossoNumero}|${m.ocorrenciaCodigo}|${m.dataOcorrencia}`)
    )

    if (duplicados.length > 0) {
      const lista = duplicados
        .slice(0, 10)
        .map((m) => `${m.nossoNumero} (ocorrência ${m.ocorrenciaCodigo} em ${m.dataOcorrencia})`)
        .join('; ')

      return res.status(409).json({
        error: `⚠️ ${duplicados.length} movimento(s) já foram processados antes e não foram gravados de novo: ${lista}${
          duplicados.length > 10 ? '...' : ''
        }`,
        tipo: 'movimentos_duplicados',
      })
    }

    const { data: ocorrenciasRef } = await supabase.from('ocorrencias_ref').select('*')
    const refMap = Object.fromEntries((ocorrenciasRef || []).map((o) => [o.codigo, o]))

    const { data: retorno, error: erroRetorno } = await supabase
      .from('retornos')
      .insert({
        portador_codigo: cabecalho.portadorCodigo,
        portador_nome: cabecalho.portadorNome,
        cnpj_cedente: movimentos[0]?.cnpjCedente || null,
        data_geracao: cabecalho.dataGeracao,
        nome_arquivo: nomeArquivo || null,
      })
      .select()
      .single()

    if (erroRetorno) throw erroRetorno

    const resultado = []

    for (const mov of movimentos) {
      const { data: titulo } = await supabase
        .from('titulos')
        .select('*')
        .eq('nosso_numero', mov.nossoNumero)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle()

      const ref = refMap[mov.ocorrenciaCodigo]
      const geraBaixa = ref ? ref.gera_baixa : false

      const { error: erroMov } = await supabase.from('movimentos_retorno').insert({
        retorno_id: retorno.id,
        titulo_id: titulo ? titulo.id : null,
        nosso_numero: mov.nossoNumero,
        ocorrencia_codigo: mov.ocorrenciaCodigo,
        ocorrencia_descricao: ref ? ref.descricao : 'Código não mapeado',
        data_ocorrencia: mov.dataOcorrencia,
        valor_pago: mov.valorPago,
        data_credito: mov.dataCredito,
        sacado_nome: mov.sacadoNome,
        seu_numero_raw: mov.seuNumeroRaw,
        gera_baixa: geraBaixa,
      })
      if (erroMov) throw erroMov

      if (titulo) {
        const novoStatus = STATUS_POR_OCORRENCIA[mov.ocorrenciaCodigo] || 'ver_manual'
        await supabase.from('titulos').update({ status: novoStatus }).eq('id', titulo.id)
      }

      resultado.push({
        nossoNumero: mov.nossoNumero,
        encontrado: !!titulo,
        ocorrencia: mov.ocorrenciaCodigo,
        descricao: ref ? ref.descricao : 'Código não mapeado',
        valorPago: mov.valorPago,
        geraBaixa,
      })
    }

    return res.status(200).json({ ok: true, retornoId: retorno.id, resultado })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao processar retorno' })
  }
}
