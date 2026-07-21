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

// Normaliza o Nosso Número pra comparação: só dígitos, sem zero à esquerda.
function normalizarNossoNumero(valor) {
  const digitos = String(valor || '').replace(/\D/g, '')
  const semZerosEsquerda = digitos.replace(/^0+/, '')
  return semZerosEsquerda || '0'
}

// Normaliza CNPJ pra comparação: só dígitos (tira ponto, barra, traço).
function normalizarCnpj(valor) {
  return String(valor || '').replace(/\D/g, '')
}

// CHAVE DE CASAMENTO REAL: CNPJ do cedente + Nosso Número.
//
// O schema de `titulos` tem `unique (remessa_id, nosso_numero)` - ou seja,
// o Nosso Número só é garantido único DENTRO da mesma remessa/cliente.
// Clientes diferentes (ex: GLEISIANE, FENTE FILM, ZPEL) podem ter títulos
// com o MESMO Nosso Número em remessas separadas. Buscar só por Nosso
// Número (sem saber de qual cliente) arrisca casar com o título errado.
//
// O CNPJ do cedente mora na tabela `remessas` (não em `titulos`), então
// pra montar essa chave é preciso buscar `titulos` já unido com sua
// respectiva `remessas.cnpj_cedente`.
function chaveComposta(cnpjCedente, nossoNumero) {
  return `${normalizarCnpj(cnpjCedente)}|${normalizarNossoNumero(nossoNumero)}`
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

    // --- Busca títulos e remessas SEPARADAMENTE e junta em JS ---
    // (evita depender do Supabase resolver automaticamente o relacionamento
    // titulos.remessa_id -> remessas.id, que pode falhar silenciosamente
    // dependendo de como a FK foi declarada, devolvendo cnpj_cedente vazio
    // pra todo mundo e quebrando a chave composta sem erro nenhum na tela)
    const { data: todosTitulos, error: erroTitulos } = await supabase
      .from('titulos')
      .select('id, remessa_id, nosso_numero, status, criado_em')

    if (erroTitulos) throw erroTitulos

    const { data: todasRemessas, error: erroRemessas } = await supabase
      .from('remessas')
      .select('id, cnpj_cedente')

    if (erroRemessas) throw erroRemessas

    const cnpjPorRemessaId = new Map((todasRemessas || []).map((r) => [r.id, r.cnpj_cedente]))

    const indiceTitulos = new Map()
    for (const t of todosTitulos || []) {
      const cnpjCedente = cnpjPorRemessaId.get(t.remessa_id)
      const chave = chaveComposta(cnpjCedente, t.nosso_numero)
      const atual = indiceTitulos.get(chave)
      if (!atual || new Date(t.criado_em) > new Date(atual.criado_em)) {
        indiceTitulos.set(chave, t)
      }
    }

    // --- Duplicidade: mesmo cedente + Nosso Número + mesma ocorrência + mesma data já existe? ---
    // (mesma lógica: busca movimentos_retorno e retornos separadamente e
    // junta em JS, em vez de depender do join automático do Supabase)
    const { data: movimentosExistentes, error: erroChecagem } = await supabase
      .from('movimentos_retorno')
      .select('retorno_id, nosso_numero, ocorrencia_codigo, data_ocorrencia')

    if (erroChecagem) throw erroChecagem

    const { data: todosRetornos, error: erroRetornos } = await supabase
      .from('retornos')
      .select('id, cnpj_cedente')

    if (erroRetornos) throw erroRetornos

    const cnpjPorRetornoId = new Map((todosRetornos || []).map((r) => [r.id, r.cnpj_cedente]))

    const chaveExistente = new Set(
      (movimentosExistentes || []).map((m) => {
        const cnpjCedente = cnpjPorRetornoId.get(m.retorno_id)
        return `${chaveComposta(cnpjCedente, m.nosso_numero)}|${m.ocorrencia_codigo}|${m.data_ocorrencia}`
      })
    )

    const cnpjCedenteDesteArquivo = movimentos[0]?.cnpjCedente

    const duplicados = movimentos.filter((m) =>
      chaveExistente.has(
        `${chaveComposta(cnpjCedenteDesteArquivo, m.nossoNumeroFactoring)}|${m.ocorrenciaCodigo}|${m.dataOcorrencia}`
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
        cnpj_cedente: cnpjCedenteDesteArquivo || null,
        data_geracao: cabecalho.dataGeracao,
        nome_arquivo: nomeArquivo || null,
      })
      .select()
      .single()

    if (erroRetorno) throw erroRetorno

    // --- Grava todos os movimentos de uma vez (1 insert em lote em vez de N) ---
    const linhasParaGravar = movimentos.map((mov) => {
      const chave = chaveComposta(mov.cnpjCedente, mov.nossoNumeroFactoring)
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
