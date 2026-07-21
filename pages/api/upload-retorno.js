import { supabase } from '../../lib/supabaseClient'
import { parseRetorno } from '../../lib/cnabRetorno'

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

// mapa de status por código de ocorrência (espelha ocorrencias_ref)
const STATUS_POR_OCORRENCIA = {
  '02': 'confirmado',
  '03': 'rejeitado',
  '06': 'liquidado',
  '09': 'baixado',
  '15': 'baixa_rejeitada',
}

// Normaliza o Nosso Número pra comparação: mantém só dígitos e remove
// zeros à esquerda. Isso resolve o caso em que o retorno traz "00000305"
// mas a tabela titulos guarda "305" (ou vice-versa) - sem isso, uma
// comparação exata (eq) nunca bate mesmo sendo o mesmo título.
function normalizarNossoNumero(valor) {
  const digitos = String(valor || '').replace(/\D/g, '')
  const semZerosEsquerda = digitos.replace(/^0+/, '')
  return semZerosEsquerda || '0'
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

    const { cabecalho, movimentos, linhasIgnoradas } = parseRetorno(conteudo)

    if (movimentos.length === 0) {
      return res.status(400).json({ error: 'Nenhum movimento encontrado no arquivo' })
    }

    // --- Busca TODOS os títulos de uma vez (1 consulta em vez de N) ---
    // e monta um índice por Nosso Número normalizado, pra achar o título
    // certo mesmo que o formato salvo (zero à esquerda, espaços) seja
    // diferente do que vem no arquivo de retorno.
    const { data: todosTitulos, error: erroTitulos } = await supabase
      .from('titulos')
      .select('id, nosso_numero, status, criado_em')

    if (erroTitulos) throw erroTitulos

    const indiceTitulos = new Map()
    for (const t of todosTitulos || []) {
      const chave = normalizarNossoNumero(t.nosso_numero)
      const atual = indiceTitulos.get(chave)
      // se houver mais de um título com o mesmo Nosso Número (não deveria,
      // mas por segurança), fica o mais recente
      if (!atual || new Date(t.criado_em) > new Date(atual.criado_em)) {
        indiceTitulos.set(chave, t)
      }
    }

    // --- Duplicidade: mesmo Nosso Número + mesma ocorrência + mesma data já existe? ---
    const nossosNumerosNormalizados = [
      ...new Set(movimentos.map((m) => normalizarNossoNumero(m.nossoNumeroFactoring))),
    ]

    const { data: movimentosExistentes, error: erroChecagem } = await supabase
      .from('movimentos_retorno')
      .select('nosso_numero, ocorrencia_codigo, data_ocorrencia')

    if (erroChecagem) throw erroChecagem

    const chaveExistente = new Set(
      (movimentosExistentes || []).map(
        (m) => `${normalizarNossoNumero(m.nosso_numero)}|${m.ocorrencia_codigo}|${m.data_ocorrencia}`
      )
    )

    const duplicados = movimentos.filter((m) =>
      chaveExistente.has(
        `${normalizarNossoNumero(m.nossoNumeroFactoring)}|${m.ocorrenciaCodigo}|${m.dataOcorrencia}`
      )
    )

    if (duplicados.length > 0) {
      const lista = duplicados
        .slice(0, 10)
        .map((m) => `${m.nossoNumeroFactoring} (ocorrência ${m.ocorrenciaCodigo} em ${m.dataOcorrencia})`)
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

    // --- Grava todos os movimentos de uma vez (1 insert em lote em vez de N) ---
    const linhasParaGravar = movimentos.map((mov) => {
      const chave = normalizarNossoNumero(mov.nossoNumeroFactoring)
      const titulo = indiceTitulos.get(chave) || null
      const ref = refMap[mov.ocorrenciaCodigo]
      const geraBaixa = ref ? ref.gera_baixa : false

      return {
        linha: {
          retorno_id: retorno.id,
          titulo_id: titulo ? titulo.id : null,
          nosso_numero: mov.nossoNumeroFactoring,
          ocorrencia_codigo: mov.ocorrenciaCodigo,
          ocorrencia_descricao: ref ? ref.descricao : 'Código não mapeado',
          data_ocorrencia: mov.dataOcorrencia,
          valor_pago: mov.valorPago,
          data_credito: mov.dataCredito,
          sacado_nome: mov.sacadoNome,
          seu_numero_raw: mov.seuNumeroRaw,
          gera_baixa: geraBaixa,
        },
        titulo,
        mov,
        ref,
        geraBaixa,
      }
    })

    const { error: erroInsertLote } = await supabase
      .from('movimentos_retorno')
      .insert(linhasParaGravar.map((l) => l.linha))

    if (erroInsertLote) throw erroInsertLote

    // Atualiza o status de cada título que teve match, também em lote
    // (agrupado por status novo, pra fazer 1 update por status em vez de 1 por título)
    const porStatus = new Map()
    for (const { titulo, mov } of linhasParaGravar) {
      if (!titulo) continue
      const novoStatus = STATUS_POR_OCORRENCIA[mov.ocorrenciaCodigo] || 'ver_manual'
      if (!porStatus.has(novoStatus)) porStatus.set(novoStatus, [])
      porStatus.get(novoStatus).push(titulo.id)
    }
    for (const [novoStatus, ids] of porStatus.entries()) {
      await supabase.from('titulos').update({ status: novoStatus }).in('id', ids)
    }

    const resultado = linhasParaGravar.map(({ mov, titulo, ref, geraBaixa }) => ({
      nossoNumero: mov.nossoNumeroFactoring,
      seuNumero: mov.seuNumeroRaw,
      encontrado: !!titulo,
      ocorrencia: mov.ocorrenciaCodigo,
      descricao: ref ? ref.descricao : 'Código não mapeado',
      valorPago: mov.valorPago,
      geraBaixa,
    }))

    const semTitulo = resultado.filter((r) => !r.encontrado).length

    return res.status(200).json({
      ok: true,
      retornoId: retorno.id,
      resultado,
      resumo: `Retorno processado: ${resultado.length} movimento(s), ${semTitulo} sem título correspondente.`,
      linhasIgnoradas: linhasIgnoradas.length > 0 ? linhasIgnoradas : undefined,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao processar retorno' })
  }
}
