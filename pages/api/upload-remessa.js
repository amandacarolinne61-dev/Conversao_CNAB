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
    const { conteudo, nomeArquivo, portadorCodigo, portadorNome } = req.body
    if (!conteudo) {
      return res.status(400).json({ error: 'Conteúdo do arquivo não informado' })
    }

    const { cabecalho, titulos } = parseRemessa(conteudo)

    if (titulos.length === 0) {
      return res.status(400).json({ error: 'Nenhum título de detalhe encontrado no arquivo' })
    }

    const { data: remessa, error: erroRemessa } = await supabase
      .from('remessas')
      .insert({
        portador_codigo: portadorCodigo || cabecalho.portadorCodigo,
        portador_nome: portadorNome || null,
        cnpj_cedente: titulos[0].cnpjCedente,
        nome_empresa: cabecalho.nomeEmpresa,
        codigo_transmissao: cabecalho.codigoTransmissao,
        nome_arquivo: nomeArquivo || null,
      })
      .select()
      .single()

    if (erroRemessa) throw erroRemessa

    const linhasTitulos = titulos.map((t) => ({
      remessa_id: remessa.id,
      nosso_numero: t.nossoNumero,
      seu_numero: t.seuNumero,
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
      quantidadeTitulos: titulos.length,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao processar remessa' })
  }
}
