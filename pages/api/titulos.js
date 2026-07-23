import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const { data: titulos, error } = await supabase
      .from('titulos')
      .select('*, movimentos_retorno(*), remessas(portador_codigo, portador_nome, factoring)')
      .order('criado_em', { ascending: false })
      .limit(200)

    if (error) throw error

    return res.status(200).json({ titulos })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao buscar títulos' })
  }
}
