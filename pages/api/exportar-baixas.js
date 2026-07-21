import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const { data: movimentos, error } = await supabase
      .from('movimentos_retorno')
      .select('*, titulos(seu_numero, nome_sacado, valor_titulo)')
      .eq('gera_baixa', true)
      .order('data_ocorrencia', { ascending: true })

    if (error) throw error

    const linhas = [
      'nosso_numero;seu_numero;sacado;data_ocorrencia;valor_pago;ocorrencia',
      ...movimentos.map((m) =>
        [
          m.nosso_numero,
          m.titulos?.seu_numero || '',
          m.titulos?.nome_sacado || m.sacado_nome || '',
          m.data_ocorrencia || '',
          m.valor_pago?.toFixed(2).replace('.', ',') || '0,00',
          m.ocorrencia_descricao,
        ].join(';')
      ),
    ]

    res.setHeader('Content-Type', 'text/csv; charset=iso-8859-1')
    res.setHeader('Content-Disposition', 'attachment; filename="baixas_g3.csv"')
    return res.status(200).send(linhas.join('\n'))
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Erro ao exportar baixas' })
  }
}
