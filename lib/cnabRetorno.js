// Parser da RETORNO CNAB 400
//
// AJUSTE (21/07/2026): o Nosso Número agora é lido SEMPRE da posição 63-70
// (front-anchored, 0-indexed 62-70). Essa é a única posição confirmada como
// confiável em todos os portadores testados:
//
//   - GLEISIANE (Itaú, carteira 109 "I"): posições 63-70, 86-93 e 127-134
//     batem entre si (redundantes, mas OK usar qualquer uma).
//   - FENTE FILM (Itaú, carteira 109 "E" - Escritural): SÓ a posição 63-70
//     varia por título. As posições 86-93 e 127-134 vêm FIXAS (ex:
//     "06564707" repetido em todas as linhas do arquivo) — não são o Nosso
//     Número do título, parecem ser código de convênio/lote. Usar essas
//     posições pra matching colapsa todos os títulos numa chave só.
//
// Confirmado cruzando com a remessa real da FENTE FILM: título 600619/B
// tem Nosso Número 00000328 tanto na remessa (pos 63-70) quanto no retorno
// (pos 63-70). Por isso: NUNCA usar 86-93 ou 127-134 como chave.
//
// IMPORTANTE: a interface pública (nomes de campos em `cabecalho` e
// `movimentos`) foi mantida IGUAL à versão anterior, pra não quebrar o
// pages/api/upload-retorno.js que já consome esse parser. Só a lógica
// interna de extração de posições foi corrigida.

function campo(linha, inicio1based, fim1based) {
  return linha.slice(inicio1based - 1, fim1based).trim()
}

function toDate(ddmmaa) {
  if (!ddmmaa || ddmmaa.trim() === '' || ddmmaa === '000000') return null
  const dd = ddmmaa.slice(0, 2)
  const mm = ddmmaa.slice(2, 4)
  const aa = ddmmaa.slice(4, 6)
  if (dd === '00' || mm === '00') return null
  const ano = parseInt(aa, 10) < 50 ? `20${aa}` : `19${aa}`
  return `${ano}-${mm}-${dd}`
}

function toValor(digitos) {
  const limpo = (digitos || '').replace(/\D/g, '')
  if (!limpo) return 0
  return parseInt(limpo, 10) / 100
}

// Ocorrências que geram baixa/liquidação de verdade (crédito ao beneficiário).
// A tabela ocorrencias_ref no Supabase é quem manda de fato (gera_baixa),
// isso aqui é só usado internamente pra calcular o valorPago com segurança.
const OCORRENCIAS_LIQUIDACAO = new Set(['06', '07', '08', '09', '10'])

function parseCabecalho(linha) {
  return {
    portadorCodigo: campo(linha, 77, 79),      // ex: "341"
    portadorNome: campo(linha, 80, 94),        // ex: "BANCO ITAU SA"
    nomeEmpresa: campo(linha, 47, 76),
    agencia: campo(linha, 27, 30),
    conta: campo(linha, 33, 37),
    dataGeracao: toDate(campo(linha, 95, 100)),
  }
}

function parseMovimento(linha) {
  // --- Campos front-anchored (posição absoluta a partir do início da linha) ---
  const cnpjCedente = campo(linha, 4, 17)

  // >>> NOSSO NÚMERO: sempre da posição 63-70. NUNCA 86-93 ou 127-134. <<<
  const nossoNumero = campo(linha, 63, 70)

  const ocorrenciaCodigo = campo(linha, 109, 110)
  const dataOcorrencia = toDate(campo(linha, 111, 116))
  const seuNumeroRaw = campo(linha, 117, 126) // "Nº do Documento" / seu número
  const vencimento = toDate(campo(linha, 147, 152))
  const valorTitulo = toValor(campo(linha, 153, 165))
  const valorAbatimento = toValor(campo(linha, 228, 240))
  const valorDesconto = toValor(campo(linha, 241, 253))
  const valorPrincipal = toValor(campo(linha, 254, 266))
  const jurosMoraMulta = toValor(campo(linha, 267, 279))
  const dataCredito = toDate(campo(linha, 296, 301))
  const sacadoNome = campo(linha, 325, 354)

  // Valor efetivamente pago/creditado. Só calcula de verdade quando a
  // ocorrência é de liquidação — pra entrada confirmada e afins, fica 0
  // (o campo valor do título ali não é dinheiro recebido).
  const valorPago = OCORRENCIAS_LIQUIDACAO.has(ocorrenciaCodigo)
    ? valorPrincipal || valorTitulo - valorDesconto - valorAbatimento + jurosMoraMulta
    : 0

  return {
    cnpjCedente,
    nossoNumero,
    ocorrenciaCodigo,
    dataOcorrencia,
    seuNumeroRaw,
    vencimento,
    valorTitulo,
    valorPago,
    dataCredito,
    sacadoNome,
  }
}

function parseRetorno(conteudoArquivo) {
  const linhas = conteudoArquivo
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)

  let cabecalho = null
  const movimentos = []

  for (const linha of linhas) {
    const tipo = linha[0]
    if (tipo === '0') {
      cabecalho = parseCabecalho(linha)
    } else if (tipo === '1') {
      movimentos.push(parseMovimento(linha))
    }
    // tipo '9' (trailer) e '4' (rateio) não são usados no fluxo atual
  }

  return { cabecalho, movimentos }
}

module.exports = { parseRetorno }
