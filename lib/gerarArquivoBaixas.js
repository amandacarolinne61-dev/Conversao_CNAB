// Monta o conteúdo do .RET de baixas (CNAB 400), no MESMO layout confirmado
// do arquivo CB170707_RETORNO_SIMULADO.RET (validado byte a byte contra o
// retorno real da Bancorp em retorno_bankorp.RET - as posições de
// nosso_numero, ocorrencia, valor, datas e sacado são as MESMAS em ambos, o
// que confirma que esse é o layout padrão de RETORNO usado pelo sistema/G3,
// independente da factoring de origem).
//
// Usado tanto pela exportação automática (pages/api/exportar-baixas.js, lote
// de todo título liquidado ainda não exportado) quanto pela regeneração
// manual de títulos selecionados na tela
// (pages/api/gerar-baixa-selecionados.js) - a lógica de montagem de campos é
// a mesma nos dois casos, só muda quais títulos entram.
//
// Posições confirmadas (linha de 400 posições fixas):
//   42-52   NÃO é lido pelo G3 (ver correção de 22/07/2026 abaixo) - deixado
//           como está no template, sem sobrescrever
//   62-70   nosso_numero (8 dígitos)
//   108-110 código de ocorrência ("06" = liquidação)
//   111-117 data de ocorrência (DDMMAA)
//   117-127 nº do documento de cobrança (10 posições) - título completo,
//           única posição que o G3 realmente lê
//   127-135 confirmação do nosso número (8 dígitos) - mesmo valor da
//           posição 62
//   146-152 data de ocorrência (DDMMAA) [duplicado no layout de retorno]
//   152-165 valor pago (13 dígitos, sem separador decimal)
//   295-301 data de crédito (DDMMAA)
//   324-394 nome do sacado (70 posições)
//   394-400 número sequencial do registro (6 dígitos)
//
// ACHADO (22/07/2026): as posições 111-117 (data de ocorrência) e 117-135
// (nº do documento completo + confirmação do nosso número) nunca eram
// sobrescritas pelo código - ficavam congeladas com o valor do título de
// EXEMPLO usado pra montar o DETAIL_TEMPLATE ("150626" / "06564707"),
// idêntico em toda linha de toda exportação já gerada. Corrigido abaixo.
//
// CONFIRMADO independentemente contra CN20076A.RET - um arquivo de OUTRO
// cliente do G3 (não FENTE FILM), recebido como padrão de referência de
// como o arquivo precisa sair pro G3 ler. Nele, 117-127 varia por título
// completo ("004883/A", "004883/B", "004883/C"...) e 127-135 repete
// exatamente o nosso_numero de cada linha - bate 100% com a correção acima.
//
// ACHADO (22/07/2026): o "título" que o G3 realmente reconhece NÃO é o
// campo seu_numero da remessa (posição 43-52, sem barra, ex "202600626A") -
// é um campo DIFERENTE, na posição 109-118 da própria remessa, que já vem
// COM a barra antes da letra da parcela (ex "01600626/A"). Esse campo é
// extraído em cnabRemessa.js como `tituloG3` e gravado em `titulos.titulo_g3`.
// O casamento título×retorno em upload-retorno.js CONTINUA usando
// seu_numero (sem barra) - é um campo diferente, com propósito diferente.
//
// CORREÇÃO (22/07/2026): o achado acima também supunha que a posição 42 do
// .RET de saída era lida pelo G3 e por isso devia repetir o titulo_g3.
// Comparando com exemplos/como g3 le.RET (referência de outro cliente,
// ZPEL/MONEY SOLUTION) isso não se sustenta: lá a posição 42-52 vem quase
// vazia (ex. "48        ", resíduo do nosso_numero) e é a posição 116-126
// que carrega o título completo com barra (ex. "20260728/G"). Confirmado
// pelo usuário: só a posição 116 importa pro G3. Voltamos a NÃO escrever
// nada na posição 42 - fica como o DETAIL_TEMPLATE já traz.
//
// ACHADO (22/07/2026): a posição 38-62 (25 posições, "Nº do documento de
// cobrança" no layout oficial) também ficava congelada com lixo do título
// de exemplo ("...6564707..."). É um campo real da própria remessa
// (extraído em cnabRemessa.js como `documentoCobranca`, gravado em
// `titulos.documento_cobranca`) - confirmado pelo mesmo estilo em
// CN20076A.RET ("00767000004883AV"). Ecoado verbatim no export agora.
//
// CORREÇÃO (22/07/2026): dentro dessas 25 posições, a "Número do Título"
// (38-44, 7 dígitos) é o único trecho que realmente varia por título nos
// dados reais - o resto do campo fica em branco. Esse subcampo estava
// saindo com valor fixo/congelado em todas as linhas sempre que
// `documento_cobranca` vinha vazio/incompleto pro título. Agora é gravado
// à parte na remessa (`titulos.numero_titulo`) e escrito explicitamente
// na exportação, igual pro mesmo título em todas as parcelas (A/B/C/D) e
// diferente entre títulos diferentes.
//
// Header:
//   76-79   código do banco (SEMPRE "341"/Itaú, não sobrescrito - o G3 não
//           lê o arquivo se essa posição vier com outro número de banco;
//           chegou a ser trocado por um código por FACTORING, revertido)
//   94-100  data de geração (DDMMAA)
//   108-113 sequencial do arquivo (5 dígitos)
//   113-119 data de geração repetida (DDMMAA)

// Templates baseados em LINHAS REAIS do retorno da Bancorp (retorno_bankorp.RET,
// já processado com sucesso antes) - não mais no exemplo antigo da ZPEL, que
// deixava caracteres residuais de outro layout (ex: um "E" sobrando na
// posição 107, onde o arquivo real tem espaço em branco).
const HEADER_TEMPLATE =
  '02RETORNO01COBRANCA       000000000000        ENERGY POWER LTDA             341BANCO ITAU SA  21072600000BPI00000210726                                                                                                                                                                                                                                                                                   000001'

const DETAIL_TEMPLATE =
  '10260225985000185000000000000        6564707                  06564707            000065647070              0615062620260359/C06564707            150626000000178096000000000000000000000000                          000000000000000000000000000000000000000000000178096000000000000000000000000000   1606260000      0000000000000MB COMERCIO DE PELICULAS EIREL                                        000009'

const TRAILER_TEMPLATE =
  '9                                                                                                                                                                                                                                                                                                                                                                                                         000007'

function setAt(str, start, valor) {
  return str.slice(0, start) + valor + str.slice(start + valor.length)
}

function pad(valor, tamanho, char = '0') {
  const s = String(valor ?? '')
  return s.length >= tamanho ? s.slice(-tamanho) : char.repeat(tamanho - s.length) + s
}

function padDireita(valor, tamanho) {
  const s = String(valor ?? '')
  return s.length >= tamanho ? s.slice(0, tamanho) : s + ' '.repeat(tamanho - s.length)
}

export function hojeDDMMAA() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aa = String(d.getFullYear()).slice(2)
  return `${dd}${mm}${aa}`
}

function isoParaDDMMAA(iso) {
  if (!iso) return '000000'
  const [ano, mes, dia] = iso.split('-')
  return `${dia}${mes}${ano.slice(2)}`
}

function valorParaCNAB(valor, tamanho = 13) {
  const centavos = Math.round(Number(valor || 0) * 100)
  return pad(centavos, tamanho)
}

// Título completo (10 posições, com barra) escrito na posição 116 do .RET -
// única posição que o G3 realmente lê (ver correção de 22/07/2026 acima).
// Usa `titulo_g3` (ex "01600626/A"), com fallback pro `seu_numero` antigo
// (sem barra) só pra títulos gravados antes dessa coluna existir.
function formatarTituloG3(t) {
  const s = String(t.titulo_g3 || t.seu_numero || '').trim().toUpperCase()
  if (s.length >= 10) return s.slice(0, 10)
  return '0'.repeat(10 - s.length) + s
}

// `titulos` já vem com `remessas` e `movimentos_retorno` aninhados (mesmo
// shape retornado pelo select usado pelos dois endpoints que chamam essa
// função). Assume que todos são do mesmo portador/factoring - usa a
// remessa do primeiro título pro header (mesma limitação já documentada
// nos dois lugares que chamam essa função).
export function gerarArquivoBaixas(titulos) {
  const dataHoje = hojeDDMMAA()
  const remessaRef = titulos[0].remessas || {}

  const linhas = []

  // --- Header ---
  let header = HEADER_TEMPLATE
  header = setAt(header, 46, padDireita((remessaRef.nome_empresa || '').toUpperCase(), 30))
  // Posição 76-79 (código do banco, 3 dígitos) NÃO é sobrescrita - fica
  // sempre "341" (Itaú, valor do próprio template). Chegou a ser
  // sobrescrita com um código por FACTORING (MAPA_CODIGO_EXPORTACAO_BAIXA),
  // mas confirmado pelo usuário que o G3 não lê o arquivo se essa posição
  // vier com outro número de banco - removido.
  header = setAt(header, 79, padDireita((remessaRef.portador_nome || '').toUpperCase(), 15))
  header = setAt(header, 94, dataHoje) // data de geração
  header = setAt(header, 108, pad(1, 5)) // sequencial do arquivo
  header = setAt(header, 113, dataHoje) // data repetida
  header = setAt(header, 394, pad(1, 6)) // sequencial do registro
  linhas.push(header)

  // --- Detalhes: 1 linha por título ---
  let seq = 2
  for (const t of titulos) {
    const movimentosBaixa = (t.movimentos_retorno || [])
      .filter((m) => m.gera_baixa)
      .sort((a, b) => (b.data_ocorrencia || '').localeCompare(a.data_ocorrencia || ''))
    const mov = movimentosBaixa[0]

    let linha = DETAIL_TEMPLATE
    // Nº do documento de cobrança (posição 38-62, 25 posições) - ecoa
    // verbatim o mesmo campo da remessa (titulos.documento_cobranca).
    if (t.documento_cobranca) {
      linha = setAt(linha, 37, padDireita(t.documento_cobranca.toUpperCase(), 25))
    }
    // Número do título (posição 38-44, 7 dígitos) - sobrescreve por cima
    // do campo acima pra garantir que essas 7 posições especificamente
    // fiquem certas (mesmo valor pra todas as parcelas do título, vindo
    // da própria remessa via nosso_numero), em vez de depender do
    // documento_cobranca completo vir sempre preenchido corretamente.
    if (t.numero_titulo) {
      linha = setAt(linha, 37, pad(t.numero_titulo, 7))
    }
    linha = setAt(linha, 62, pad(t.nosso_numero, 8))
    linha = setAt(linha, 108, '06')
    linha = setAt(linha, 110, isoParaDDMMAA(mov?.data_ocorrencia))
    linha = setAt(linha, 116, formatarTituloG3(t)) // <-- única posição que o G3 lê (com barra)
    linha = setAt(linha, 126, pad(t.nosso_numero, 8)) // confirmação do nosso número
    linha = setAt(linha, 146, isoParaDDMMAA(mov?.data_ocorrencia))
    // Usa sempre o VALOR DO TÍTULO (contratado), não o valor pago no
    // retorno - eventuais diferenças (juros, liquidação combinada, etc.)
    // ficam só como alerta visual na tela, não vão pro arquivo do G3.
    linha = setAt(linha, 152, valorParaCNAB(t.valor_titulo))
    linha = setAt(linha, 253, valorParaCNAB(t.valor_titulo))
    linha = setAt(linha, 295, isoParaDDMMAA(mov?.data_credito || mov?.data_ocorrencia))
    linha = setAt(linha, 324, padDireita((t.nome_sacado || '').toUpperCase(), 70))
    linha = setAt(linha, 394, pad(seq, 6))

    linhas.push(linha)
    seq++
  }

  // --- Trailer ---
  // Preenche quantidade de títulos e valor total, em vez de deixar
  // zerado - um arquivo zerado nesse campo foi observado fazendo o G3 não
  // confiar no arquivo pra lançar os valores.
  const quantidadeTitulos = titulos.length
  const valorTotalCentavos = titulos.reduce(
    (soma, t) => soma + Math.round(Number(t.valor_titulo || 0) * 100),
    0
  )
  let trailer = TRAILER_TEMPLATE
  trailer = setAt(trailer, 177, pad(quantidadeTitulos, 7))
  trailer = setAt(trailer, 184, pad(valorTotalCentavos, 16))
  trailer = setAt(trailer, 394, pad(seq, 6))
  linhas.push(trailer)

  return linhas.join('\r\n') + '\r\n'
}
