import { supabase } from '../../lib/supabaseClient'
import { parseRetornoTitan, normalizarNomeSacado } from '../../lib/parsers-retorno/titan'

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

// CHAVE DE CASAMENTO da Titan: nome_sacado (normalizado) + a base numérica
// do "Título" da Titan comparada por SUFIXO contra `titulos.seu_numero`, com
// a parcela (posição ordinal, A=1ª/B=2ª/C=3ª...) resolvendo qual parcela
// específica bateu - ver o comentário grande em lib/parsers-retorno/titan.js
// sobre por que "Título" NÃO é o `numero_titulo` (esse é igual pra todas as
// parcelas, então nunca identificaria uma parcela específica; o formato
// real confirmado com o usuário é "<base>-<parcela>", onde <base> é o mesmo
// número no final do seu_numero da parcela e <parcela> é a posição
// ordinal). O CNPJ do sacado ainda serve de desempate extra pra falso
// positivo de nome parecido entre clientes diferentes.
function letraEBaseDoSeuNumero(seuNumero) {
  const valor = String(seuNumero || '').trim().toUpperCase()
  const m = valor.match(/^(\d+)([A-Z])$/)
  if (!m) return { letra: null, baseDigitos: null }
  return { letra: m[2], baseDigitos: m[1] }
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

    // --- Busca só remessas da Titan - cada remessa só concilia com o
    // retorno da MESMA factoring (ver comentário equivalente em
    // upload-retorno.js). Diferente do Bancorp, aqui não há fallback pra
    // `factoring IS NULL` - a Titan é nova, nenhum título legado pertence a
    // ela por omissão. ---
    const { data: remessasTitan, error: erroRemessas } = await supabase
      .from('remessas')
      .select('id')
      .eq('factoring', 'titan')

    if (erroRemessas) throw erroRemessas

    const remessaIdsTitan = (remessasTitan || []).map((r) => r.id)

    // --- Busca todos os títulos (só das remessas da Titan) e agrupa por
    // nome_sacado normalizado - a base+parcela é resolvida por título dentro
    // de cada grupo, na hora do casamento (loop abaixo), porque depende do
    // `tituloBase` de cada movimento específico. ---
    const { data: todosTitulos, error: erroTitulos } = await supabase
      .from('titulos')
      .select('id, remessa_id, nosso_numero, seu_numero, nome_sacado, cnpj_sacado, status, criado_em')
      .in('remessa_id', remessaIdsTitan)

    if (erroTitulos) throw erroTitulos

    const indicePorNome = new Map()
    for (const t of todosTitulos || []) {
      const { letra, baseDigitos } = letraEBaseDoSeuNumero(t.seu_numero)
      if (!letra) continue // seu_numero sem letra de parcela no final - não dá pra ordenar, não indexa
      const chave = normalizarNomeSacado(t.nome_sacado)
      if (!indicePorNome.has(chave)) indicePorNome.set(chave, [])
      indicePorNome.get(chave).push({ titulo: t, letra, baseDigitos })
    }

    // --- Duplicidade: mesmo título + mesma data de liquidação já processado? ---
    const { data: movimentosExistentes, error: erroChecagem } = await supabase
      .from('movimentos_retorno')
      .select('seu_numero_raw, ocorrencia_codigo, data_ocorrencia')

    if (erroChecagem) throw erroChecagem

    const chaveExistente = new Set(
      (movimentosExistentes || []).map(
        (m) => `${String(m.seu_numero_raw || '').trim()}|${m.ocorrencia_codigo}|${m.data_ocorrencia}`
      )
    )

    const duplicados = movimentos.filter((m) =>
      chaveExistente.has(`${m.numeroTitulo}|06|${m.dataLiquidacao}`)
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

    // titulosAmbiguos: sobrou mais de um candidato na MESMA posição ordinal
    // depois de filtrar por nome+base+CNPJ - só deve acontecer se dois
    // clientes distintos tiverem nome normalizado E final de seu_numero
    // iguais por coincidência. Fica pra resolução manual, nunca escolhemos
    // um automaticamente.
    const titulosAmbiguos = []
    // naoConciliados: não bateu com nenhum título (base não encontrada, ou
    // parcela fora do que existe pra esse título) - só na resposta da
    // chamada por enquanto, mesmo padrão já usado pro Bancorp hoje.
    const naoConciliados = []

    const linhasParaGravar = movimentos.map((mov) => {
      const candidatosCliente = indicePorNome.get(normalizarNomeSacado(mov.nomeSacado)) || []

      let candidatosTitulo = candidatosCliente.filter((c) =>
        c.baseDigitos.endsWith(String(mov.tituloBase))
      )

      // CNPJ como desempate extra, se sobrou mais de um cliente com nome
      // parecido e final de seu_numero coincidente.
      if (candidatosTitulo.length > 1 && mov.cnpjSacado) {
        const cnpjLimpo = mov.cnpjSacado.replace(/\D/g, '')
        const filtradoPorCnpj = candidatosTitulo.filter(
          (c) => (c.titulo.cnpj_sacado || '').replace(/\D/g, '') === cnpjLimpo
        )
        if (filtradoPorCnpj.length > 0) candidatosTitulo = filtradoPorCnpj
      }

      candidatosTitulo.sort((a, b) => a.letra.localeCompare(b.letra))

      const escolhido = candidatosTitulo[mov.tituloParcela - 1] || null
      const titulo = escolhido ? escolhido.titulo : null

      // Ambíguo de verdade só existe aqui se, mesmo depois de nome+base+
      // CNPJ, a posição ordinal escolhida não resolve unicamente pra um
      // título (ex: candidatosTitulo tem repetição de letra, o que não
      // deveria acontecer - fica como salvaguarda).
      const letrasRepetidas = new Set(candidatosTitulo.map((c) => c.letra)).size !== candidatosTitulo.length
      const ambiguo = !!titulo && letrasRepetidas
      const conciliado = !!titulo && !ambiguo

      if (ambiguo) {
        titulosAmbiguos.push({
          numeroTitulo: mov.numeroTitulo,
          nomeSacado: mov.nomeSacado,
          titulosEncontrados: candidatosTitulo.map((c) => ({
            id: c.titulo.id,
            nossoNumero: c.titulo.nosso_numero,
            status: c.titulo.status,
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
          titulo_id: conciliado ? titulo.id : null,
          // Sem match, não há nosso_numero real disponível - usa o próprio
          // número do título da Titan como referência (coluna é NOT NULL).
          nosso_numero: conciliado ? titulo.nosso_numero : mov.numeroTitulo,
          ocorrencia_codigo: '06',
          ocorrencia_descricao: ref06 ? ref06.descricao : 'Liquidação Normal',
          data_ocorrencia: mov.dataLiquidacao,
          valor_pago: mov.valorPago,
          data_credito: mov.dataLiquidacao,
          sacado_nome: mov.nomeSacado,
          seu_numero_raw: mov.numeroTitulo,
          gera_baixa: ref06 ? ref06.gera_baixa : true,
        },
        titulo: conciliado ? titulo : null,
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
      nossoNumero: titulo ? titulo.nosso_numero : null,
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
