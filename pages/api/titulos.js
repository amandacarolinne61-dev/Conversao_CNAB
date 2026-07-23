import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    // Sem limit() - a tela filtra e pagina no que já foi carregado (ver
    // pages/index.js), e um limit() fixo aqui escondia registros mais
    // antigos da busca por completo (ex: títulos liquidados fora da janela
    // dos 200 mais recentes não apareciam nem com o filtro de status
    // aplicado, porque o filtro só rodava sobre o que a API já tinha
    // cortado). Volume atual (centenas de títulos) não justifica paginação
    // no banco.
    const { data: titulos, error } = await supabase
      .from('titulos')
      .select('*, movimentos_retorno(*), remessas(portador_codigo, portador_nome, factoring)')
      .order('criado_em', { ascending: false })

    if (error) throw error

    return res.status(200).json({ titulos })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao buscar títulos' })
  }
}
