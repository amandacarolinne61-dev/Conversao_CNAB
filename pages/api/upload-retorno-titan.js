import { supabase } from '../../lib/supabaseClient'
import { parseRetornoTitan, normalizarNomeSacado } from '../../lib/parsers-retorno/titan'

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

// CHAVE DE CASAMENTO da Titan: numero_titulo + nome_sacado (normalizado),
// diferente do Bancorp (que usa seu_numero sozinho - ver upload-retorno.js).
//
// ACHADO IMPORTANTE: `titulos.numero_titulo` é o MESMO valor pra todas as
// parcelas (A/B/C/D...) de um mesmo título (ver comentário em
// cnabRemessa.js) - e `nome_sacado` também é igual entre parcelas do mesmo
// cliente. Ou seja, numero_titulo + nome_sacado NÃO diferencia qual parcela
// específica a Titan liquidou quando o título tem mais de uma parcela - a
// Titan não manda essa informação. Por isso, igual ao caso já resolvido pro
// Bancorp (Seu Número repetido em 9 títulos da FENTE FILM), quando essa
// chave bate em mais de um `titulo`, NUNCA escolhemos um automaticamente -
// vira ambíguo pra resolução manual. O CNPJ do sacado serve pra descartar
// falsos positivos de nome parecido entre CLIENTES diferentes, mas não
// resolve a ambiguidade entre parcelas do mesmo cliente/título (o CNPJ é
// igual em todas elas).
function normalizarNumeroTituloTitan(valor) {
  return String(valor || '').trim()
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

    const { movimentos, linhasIgnoradas } = parseRetornoTitan(conteudo)

    if (movimentos.length === 0) {
      return res.status(400).json({
        error: 'Nenhum movimento com "Liquidação" preenchida encontrado no arquivo',
      })
    }

    // --- Busca todos os títulos e agrupa por numero_titulo + nome_sacado ---
    const { data: todosTitulos, error: erroTitulos } = await supabase
      .from('titulos')
      .select('id, remessa_id, nosso_numero, numero_titulo, nome_sacado, cnpj_sacado, status, criado_em')

    if (erroTitulos) throw erroTitulos

    const indiceTitulos = new Map()
    for (const t of todosTitulos || []) {
      const numero = normalizarNumeroTituloTitan(t.numero_titulo)
      if (!numero) continue // nunca indexa título sem numero_titulo - evita casar "vazio com vazio"
      const chave = `${numero}|${normalizarNomeSacado(t.nome_sacado)}`
      if (!indiceTitulos.has(chave)) indiceTitulos.set(chave, [])
      indiceTitulos.get(chave).push(t)
    }

    // --- Duplicidade: mesmo título + mesma data de liquidação já processado? ---
    const { data: movimentosExistentes, error: erroChecagem } = await supabase
      .from('movimentos_retorno')
      .select('seu_numero_raw, ocorrencia_codigo, data_ocorrencia')

    if (erroChecagem) throw erroChecagem

    const chaveExistente = new Set(
      (movimentosExistentes || []).map(
        (m) => `${normalizarNumeroTituloTitan(m.seu_numero_raw)}|${m.ocorrencia_codigo}|${m.data_ocorrencia}`
      )
    )

    const duplicados = movimentos.filter((m) =>
      chaveExistente.has(`${normalizarNumeroTituloTitan(m.numeroTitulo)}|06|${m.dataLiquidacao}`)
    )

    if (duplicados.length > 0) {
      const lista = duplicados
        .slice(0, 10)
        .map((m) => `${m.numeroTitulo} (liquidação em ${m.dataLiquidacao})`)
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
    // Reaproveita o código "06" (Liquidação Normal) já cadastrado em
    // ocorrencias_ref - semanticamente é exatamente isso que toda linha da
    // Titan que chega até aqui representa (só passam as com Liquidação
    // preenchida - ver lib/parsers-retorno/titan.js).
    const ref06 = refMap['06']

    const { data: retorno, error: erroRetorno } = await supabase
      .from('retornos')
      .insert({
        // Titan não tem cabeçalho CNAB com código/nome de portador - usa um
        // marcador fixo só pra identificar a origem na tabela `retornos`.
        portador_codigo: 'TITAN',
        portador_nome: 'Titan',
        cnpj_cedente: null,
        nome_arquivo: nomeArquivo || null,
      })
      .select()
      .single()

    if (erroRetorno) throw erroRetorno

    // titulosAmbiguos: numero_titulo + nome_sacado bateu em mais de um
    // título cadastrado (tipicamente várias parcelas do mesmo título/
    // cliente) - não escolhemos nenhum automaticamente, fica pra resolução
    // manual (ver comentário no topo do arquivo).
    const titulosAmbiguos = []
    // naoConciliados: não bateu com nenhum título - só na resposta da
    // chamada por enquanto (mesmo padrão já usado pro Bancorp hoje: o
    // movimento é gravado com titulo_id nulo, sem coluna extra no banco).
    const naoConciliados = []

    const linhasParaGravar = movimentos.map((mov) => {
      const numero = normalizarNumeroTituloTitan(mov.numeroTitulo)
      const chave = `${numero}|${normalizarNomeSacado(mov.nomeSacado)}`
      let candidatos = numero ? indiceTitulos.get(chave) || [] : []

      // CNPJ como critério de desempate/validação extra - útil quando o
      // match por nome bateu em clientes diferentes por coincidência de
      // nome normalizado; NÃO resolve ambiguidade entre parcelas do mesmo
      // título/cliente (essas compartilham o mesmo CNPJ).
      if (candidatos.length > 1 && mov.cnpjSacado) {
        const cnpjLimpo = mov.cnpjSacado.replace(/\D/g, '')
        const filtradoPorCnpj = candidatos.filter(
          (t) => (t.cnpj_sacado || '').replace(/\D/g, '') === cnpjLimpo
        )
        if (filtradoPorCnpj.length > 0) candidatos = filtradoPorCnpj
      }

      const ambiguo = candidatos.length > 1
      const titulo = candidatos.length === 1 ? candidatos[0] : null
      const conciliado = !!titulo

      if (ambiguo) {
        titulosAmbiguos.push({
          numeroTitulo: mov.numeroTitulo,
          nomeSacado: mov.nomeSacado,
          titulosEncontrados: candidatos.map((t) => ({
            id: t.id,
            nossoNumero: t.nosso_numero,
            status: t.status,
          })),
        })
      } else if (!conciliado) {
        naoConciliados.push({
          numeroTitulo: mov.numeroTitulo,
          nomeSacado: mov.nomeSacado,
        })
      }

      return {
        linha: {
          retorno_id: retorno.id,
          titulo_id: titulo ? titulo.id : null,
          // Sem match, não há nosso_numero real disponível - usa o próprio
          // número do título da Titan como referência (coluna é NOT NULL).
          nosso_numero: titulo ? titulo.nosso_numero : mov.numeroTitulo,
          ocorrencia_codigo: '06',
          ocorrencia_descricao: ref06 ? ref06.descricao : 'Liquidação Normal',
          data_ocorrencia: mov.dataLiquidacao,
          valor_pago: mov.valorPago,
          data_credito: mov.dataLiquidacao,
          sacado_nome: mov.nomeSacado,
          seu_numero_raw: mov.numeroTitulo,
          gera_baixa: ref06 ? ref06.gera_baixa : true,
        },
        titulo,
        ambiguo,
        conciliado,
        mov,
      }
    })

    const { error: erroInsertLote } = await supabase
      .from('movimentos_retorno')
      .insert(linhasParaGravar.map((l) => l.linha))

    if (erroInsertLote) throw erroInsertLote

    // Atualiza o status dos títulos com match único, em lote - único status
    // possível vindo da Titan nesta versão é 'liquidado' (ver
    // lib/parsers-retorno/titan.js).
    const idsLiquidados = linhasParaGravar.filter((l) => l.titulo).map((l) => l.titulo.id)
    if (idsLiquidados.length > 0) {
      await supabase.from('titulos').update({ status: 'liquidado' }).in('id', idsLiquidados)
    }

    const resultado = linhasParaGravar.map(({ mov, titulo, ambiguo, conciliado }) => ({
      numeroTitulo: mov.numeroTitulo,
      nomeSacado: mov.nomeSacado,
      encontrado: conciliado,
      ambiguo,
      valorPago: mov.valorPago,
      dataLiquidacao: mov.dataLiquidacao,
    }))

    const totalAmbiguos = titulosAmbiguos.length
    const totalNaoConciliados = naoConciliados.length

    return res.status(200).json({
      ok: true,
      retornoId: retorno.id,
      resultado,
      resumo: `Retorno Titan processado: ${resultado.length} movimento(s) de liquidação${
        totalNaoConciliados > 0 ? `, ${totalNaoConciliados} não conciliado(s) (sem título correspondente)` : ''
      }${totalAmbiguos > 0 ? `, ${totalAmbiguos} com correspondência ambígua (revisão manual necessária)` : ''}.`,
      linhasIgnoradas: linhasIgnoradas.length > 0 ? linhasIgnoradas : undefined,
      titulosAmbiguos: totalAmbiguos > 0 ? titulosAmbiguos : undefined,
      naoConciliados: totalNaoConciliados > 0 ? naoConciliados : undefined,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao processar retorno da Titan' })
  }
}
