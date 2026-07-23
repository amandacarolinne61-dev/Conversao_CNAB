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

// Normaliza o número do título (Seu Número) pra comparação: remove tudo
// que não for letra/dígito (barra, espaço, traço) e ignora maiúsc./minúsc.
// Nunca retorna string vazia como chave válida - ver uso abaixo.
function normalizarNumeroTitulo(valor) {
  return String(valor || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

// CHAVE DE CASAMENTO: número do título (Seu Número / Nº do Documento).
//
// É a "chave forte" do sistema - definida pelo usuário antes de gerar a
// remessa, não pelo layout do banco. Diferente do Nosso Número (que só é
// único DENTRO de uma remessa - `unique (remessa_id, nosso_numero)` - e
// não ajuda a diferenciar clientes/sacados quando o CNPJ do cedente é
// sempre o mesmo), o número do título já mora direto em `titulos.seu_numero`
// e no retorno em `mov.seuNumeroRaw`, sem precisar juntar com `remessas`.
//
// Só que já houve um caso real (FENTE FILM) de Seu Número repetido em até
// 9 títulos DIFERENTES, com sacados diferentes. Por isso NUNCA escolhemos
// um título automaticamente quando a busca encontra mais de um - ver
// `indiceTitulos` e `titulosAmbiguos` abaixo.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const { conteudo, nomeArquivo, factoring } = req.body
    if (!conteudo) {
      return res.status(400).json({ error: 'Conteúdo do arquivo não informado' })
    }

    // Esse endpoint atende qualquer factoring que use o layout CNAB 400
    // padrão (confirmado que a Apollo usa exatamente o mesmo layout da
    // Bancorp, byte a byte, contra um arquivo real - só muda o nome/código
    // do portador no próprio header do arquivo). 'bancorp' é o padrão pra
    // manter compatibilidade com chamadas antigas sem esse campo.
    const factoringAlvo = factoring || 'bancorp'

    const { cabecalho, movimentos, linhasIgnoradas } = parseRetorno(conteudo)

    if (movimentos.length === 0) {
      return res.status(400).json({ error: 'Nenhum movimento encontrado no arquivo' })
    }

    // --- Busca só remessas da factoring alvo - cada remessa só concilia
    // com o retorno da MESMA factoring (títulos de remessa sem `factoring`
    // gravado, de antes dessa coluna existir, contam como Bancorp - era a
    // única opção até então, então só entram nesse fallback quando o alvo é
    // 'bancorp'). Fetch separado em vez de join/nested select, seguindo o
    // mesmo cuidado já usado pro índice de títulos abaixo. ---
    const query = supabase.from('remessas').select('id')
    const { data: remessasAlvo, error: erroRemessas } =
      factoringAlvo === 'bancorp'
        ? await query.or('factoring.eq.bancorp,factoring.is.null')
        : await query.eq('factoring', factoringAlvo)

    if (erroRemessas) throw erroRemessas

    const remessaIdsAlvo = (remessasAlvo || []).map((r) => r.id)

    // --- Busca todos os títulos (só das remessas da factoring alvo) e
    // agrupa por número do título ---
    // Guarda TODOS os candidatos por chave (não só o mais recente) - se
    // mais de um título tiver o mesmo número, isso vira ambiguidade
    // detectável abaixo, em vez de escolher um silenciosamente.
    const { data: todosTitulos, error: erroTitulos } = await supabase
      .from('titulos')
      .select('id, remessa_id, nosso_numero, seu_numero, status, criado_em')
      .in('remessa_id', remessaIdsAlvo)

    if (erroTitulos) throw erroTitulos

    const indiceTitulos = new Map()
    for (const t of todosTitulos || []) {
      const chave = normalizarNumeroTitulo(t.seu_numero)
      if (!chave) continue // nunca indexa título sem número - evita casar "vazio com vazio"
      if (!indiceTitulos.has(chave)) indiceTitulos.set(chave, [])
      indiceTitulos.get(chave).push(t)
    }

    // --- Duplicidade: mesmo número de título + mesma ocorrência + mesma data já existe? ---
    const { data: movimentosExistentes, error: erroChecagem } = await supabase
      .from('movimentos_retorno')
      .select('seu_numero_raw, ocorrencia_codigo, data_ocorrencia')

    if (erroChecagem) throw erroChecagem

    const chaveExistente = new Set(
      (movimentosExistentes || []).map(
        (m) => `${normalizarNumeroTitulo(m.seu_numero_raw)}|${m.ocorrencia_codigo}|${m.data_ocorrencia}`
      )
    )

    const cnpjCedenteDesteArquivo = movimentos[0]?.cnpjCedente

    const duplicados = movimentos.filter((m) =>
      chaveExistente.has(
        `${normalizarNumeroTitulo(m.seuNumeroRaw)}|${m.ocorrenciaCodigo}|${m.dataOcorrencia}`
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
    // titulosAmbiguos: números de título que bateram em mais de um título
    // cadastrado - não escolhemos nenhum automaticamente (ver comentário
    // de normalizarNumeroTitulo acima), fica pra resolução manual.
    const titulosAmbiguos = []

    const linhasParaGravar = movimentos.map((mov) => {
      const chave = normalizarNumeroTitulo(mov.seuNumeroRaw)
      const candidatos = chave ? indiceTitulos.get(chave) || [] : []
      const ambiguo = candidatos.length > 1
      const titulo = candidatos.length === 1 ? candidatos[0] : null

      if (ambiguo) {
        titulosAmbiguos.push({
          numeroTitulo: mov.seuNumeroRaw,
          nossoNumero: mov.nossoNumeroFactoring,
          titulosEncontrados: candidatos.map((t) => ({
            id: t.id,
            nossoNumero: t.nosso_numero,
            status: t.status,
          })),
        })
      }

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
        ambiguo,
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

    const resultado = linhasParaGravar.map(({ mov, titulo, ambiguo, ref, geraBaixa }) => ({
      nossoNumero: mov.nossoNumeroFactoring,
      seuNumero: mov.seuNumeroRaw,
      encontrado: !!titulo,
      ambiguo,
      ocorrencia: mov.ocorrenciaCodigo,
      descricao: ref ? ref.descricao : 'Código não mapeado',
      valorPago: mov.valorPago,
      geraBaixa,
    }))

    const semTitulo = resultado.filter((r) => !r.encontrado && !r.ambiguo).length
    const totalAmbiguos = titulosAmbiguos.length

    return res.status(200).json({
      ok: true,
      retornoId: retorno.id,
      resultado,
      resumo: `Retorno processado: ${resultado.length} movimento(s), ${semTitulo} sem título correspondente${
        totalAmbiguos > 0
          ? `, ${totalAmbiguos} com número de título duplicado (revisão manual necessária)`
          : ''
      }.`,
      linhasIgnoradas: linhasIgnoradas.length > 0 ? linhasIgnoradas : undefined,
      titulosAmbiguos: totalAmbiguos > 0 ? titulosAmbiguos : undefined,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao processar retorno' })
  }
}
