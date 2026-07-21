// Parser da RETORNO CNAB 400
//
// CHAVE DE CASAMENTO: Nosso Número (posição 63-70, front-anchored).
//
// Por quê: confirmado com dois portadores reais que essa posição bate
// exatamente com o Nosso Número atribuído na remessa, e é ÚNICA por título:
//   - GLEISIANE (Itaú, carteira 109 "I")
//   - FENTE FILM (Itaú, carteira 109 "E" - Escritural)
//
// O campo "Seu Número" (Nº do Documento, posição 117-126) NÃO é confiável
// como chave nesses arquivos: no caso da FENTE FILM, o mesmo Seu Número
// (ex: "20260061/C") aparece repetido em até 9 títulos DIFERENTES, com
// sacados diferentes. Usar Seu Número como chave de casamento atribuiria
// a liquidação ao título errado. Por isso ele é mantido só como campo
// informativo (`referenciaTitulo` / `seuNumeroRaw`), nunca usado pra buscar
// o título na tabela `titulos`.
//
// Se algum portador específico (ex: Bancorp) realmente devolver um Nosso
// Número que não bate com o que foi enviado na remessa, isso deve ser
// tratado como um caso à parte (com o arquivo real em mãos pra confirmar),
// não como regra geral - o risco de colar título errado é alto demais.

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

const OCORRENCIAS_LIQUIDACAO = new Set(['06', '07', '08', '09', '10'])

function parseCabecalho(linha) {
  return {
    portadorCodigo: campo(linha, 77, 79),
    portadorNome: campo(linha, 80, 94),
    nomeEmpresa: campo(linha, 47, 76),
    agencia: campo(linha, 27, 30),
    conta: campo(linha, 33, 37),
    dataGeracao: toDate(campo(linha, 95, 100)),
  }
}

function parseMovimento(linha) {
  const cnpjCedente = campo(linha, 4, 17)

  // >>> CHAVE DE CASAMENTO: Nosso Número, sempre posição 63-70. <<<
  const nossoNumeroFactoring = campo(linha, 63, 70)

  const ocorrenciaCodigo = campo(linha, 109, 110)
  const dataOcorrencia = toDate(campo(linha, 111, 116))
  const numeroDocumento = campo(linha, 117, 126) // Seu Número - só informativo
  const vencimento = toDate(campo(linha, 147, 152))
  const valorTitulo = toValor(campo(linha, 153, 165))
  const valorAbatimento = toValor(campo(linha, 228, 240))
  const valorDesconto = toValor(campo(linha, 241, 253))
  const valorPrincipal = toValor(campo(linha, 254, 266))
  const jurosMoraMulta = toValor(campo(linha, 267, 279))
  const dataCredito = toDate(campo(linha, 296, 301))
  const sacadoNome = campo(linha, 325, 354)

  const valorPago = OCORRENCIAS_LIQUIDACAO.has(ocorrenciaCodigo)
    ? valorPrincipal || valorTitulo - valorDesconto - valorAbatimento + jurosMoraMulta
    : 0

  return {
    cnpjCedente,
    nossoNumeroFactoring,       // <- chave de casamento real
    referenciaTitulo: numeroDocumento.replace(/\//g, ''), // <- só informativo
    seuNumeroRaw: numeroDocumento,
    ocorrenciaCodigo,
    dataOcorrencia,
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
  const linhasIgnoradas = []

  for (const [indice, linha] of linhas.entries()) {
    const tipo = linha[0]
    if (tipo === '0') {
      cabecalho = parseCabecalho(linha)
    } else if (tipo === '1') {
      if (linha.length < 126) {
        linhasIgnoradas.push({
          numeroLinha: indice + 1,
          motivo: 'linha mais curta que o esperado',
          conteudo: linha,
        })
        continue
      }
      const mov = parseMovimento(linha)
      if (!mov.nossoNumeroFactoring) {
        linhasIgnoradas.push({
          numeroLinha: indice + 1,
          motivo: 'Nosso Número vazio na posição 63-70',
          conteudo: linha,
        })
        continue
      }
      movimentos.push(mov)
    }
  }

  return { cabecalho, movimentos, linhasIgnoradas }
}

module.exports = { parseRetorno }
