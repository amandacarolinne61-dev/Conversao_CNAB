import { supabase } from '../../lib/supabaseClient'
import { parseRemessa } from '../../lib/cnabRemessa'

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const { conteudo, nomeArquivo, portadorCodigo, portadorNome, factoring } = req.body
    if (!conteudo) {
      return res.status(400).json({ error: 'Conteúdo do arquivo não informado' })
    }

    const { cabecalho, titulos } = parseRemessa(conteudo)

    if (titulos.length === 0) {
      return res.status(400).json({ error: 'Nenhum título de detalhe encontrado no arquivo' })
    }

    // --- Duplicidade: algum Nosso Número desse arquivo já existe no sistema? ---
    // Diferente do comportamento antigo (bloqueava o arquivo inteiro se
    // achasse qualquer duplicata), agora os títulos novos são gravados
    // normalmente e só os duplicados ficam de fora, avisados na resposta -
    // não trava mais o upload inteiro por causa de alguns repetidos.
    const nossosNumeros = titulos.map((t) => t.nossoNumero).filter(Boolean)

    const { data: titulosExistentes, error: erroChecagem } = await supabase
      .from('titulos')
      .select('nosso_numero, seu_numero, nome_sacado')
      .in('nosso_numero', nossosNumeros)

    if (erroChecagem) throw erroChecagem

    const nossosNumerosExistentes = new Set((titulosExistentes || []).map((t) => t.nosso_numero))
    const titulosNovos = titulos.filter((t) => !nossosNumerosExistentes.has(t.nossoNumero))

    const duplicados = (titulosExistentes || []).map((t) => ({
      nossoNumero: t.nosso_numero,
      seuNumero: t.seu_numero,
      nomeSacado: t.nome_sacado,
    }))

    if (titulosNovos.length === 0) {
      return res.status(200).json({
        ok: true,
        remessaId: null,
        quantidadeTitulos: 0,
        duplicados,
        aviso: `⚠️ Todos os ${duplicados.length} título(s) do arquivo já existiam no sistema - nenhum título novo foi gravado.`,
      })
    }

    const { data: remessa, error: erroRemessa } = await supabase
      .from('remessas')
      .insert({
        portador_codigo: portadorCodigo || cabecalho.portadorCodigo,
        // Nome do banco/portador do PRÓPRIO sistema (ex: "BANCO TESTE"),
        // lido do cabeçalho da remessa - é esse código+nome que deve
        // aparecer no .RET de saída, não o do retorno da factoring.
        portador_nome: portadorNome || cabecalho.portadorNome || null,
        cnpj_cedente: titulosNovos[0].cnpjCedente,
        nome_empresa: cabecalho.nomeEmpresa,
        codigo_transmissao: cabecalho.codigoTransmissao,
        nome_arquivo: nomeArquivo || null,
        header_bruto: cabecalho.headerBruto,
        trailer_bruto: cabecalho.trailerBruto,
        // Qual factoring vai processar o retorno dessa remessa - restringe
        // o casamento em upload-retorno.js/upload-retorno-titan.js pra só
        // considerar títulos da mesma factoring (ver comentário em
        // schema.sql sobre `remessas.factoring`).
        factoring: factoring === 'titan' ? 'titan' : 'bancorp',
      })
      .select()
      .single()

    if (erroRemessa) throw erroRemessa

    const linhasTitulos = titulosNovos.map((t) => ({
      remessa_id: remessa.id,
      nosso_numero: t.nossoNumero,
      seu_numero: t.seuNumero,
      titulo_g3: t.tituloG3,
      documento_cobranca: t.documentoCobranca,
      numero_titulo: t.numeroTitulo,
      linha_bruta_detalhe: t.linhaBrutaDetalhe,
      linha_bruta_mensagem: t.linhaBrutaMensagem,
      carteira: t.carteira,
      cnpj_sacado: t.cnpjSacado,
      nome_sacado: t.nomeSacado,
      endereco_sacado: t.enderecoSacado,
      bairro_sacado: t.bairroSacado,
      cep_sacado: t.cepSacado,
      cidade_sacado: t.cidadeSacado,
      uf_sacado: t.ufSacado,
      valor_titulo: t.valorTitulo,
      data_vencimento: t.dataVencimento,
      data_emissao: t.dataEmissao,
    }))

    const { error: erroTitulos } = await supabase.from('titulos').insert(linhasTitulos)
    if (erroTitulos) throw erroTitulos

    return res.status(200).json({
      ok: true,
      remessaId: remessa.id,
      quantidadeTitulos: titulosNovos.length,
      duplicados,
      aviso:
        duplicados.length > 0
          ? `⚠️ ${duplicados.length} título(s) já existiam no sistema e não foram gravados de novo: ${duplicados
              .slice(0, 10)
              .map((d) => `${d.nossoNumero} (${d.seuNumero || 's/ nº'} - ${d.nomeSacado || ''})`)
              .join('; ')}${duplicados.length > 10 ? '...' : ''}`
          : null,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao processar remessa' })
  }
}
