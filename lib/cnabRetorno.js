// Parser da RETORNO CNAB 400
//
// CHAVE DE CASAMENTO: Seu Número / Nº do Documento (posição 117-126),
// tratado no upload-retorno.js como "número do título" - é a chave forte
// do sistema (definida pelo usuário, não pelo layout do banco).
//
// Histórico: essa posição já foi tentada como chave antes e descartada,
// porque no caso da FENTE FILM o mesmo Seu Número (ex: "20260061/C")
// apareceu repetido em até 9 títulos DIFERENTES, com sacados diferentes -
// usar isso cegamente como chave teria colado a liquidação no título
// errado. Retomamos como chave principal, mas upload-retorno.js agora
// detecta esse tipo de colisão (mais de um título com o mesmo número) e
// NÃO escolhe nenhum automaticamente - grava o movimento sem vínculo e
// devolve um aviso ("titulosAmbiguos") pra resolução manual, em vez de
// arriscar aplicar o pagamento no título errado.
//
// Nosso Número (posição 63-70) continua sendo extraído e gravado, mas
// deixou de ser usado como chave de busca - ele serve pra ligar a remessa
// original ao título já casado na hora de montar o .RET de saída
// (exportar-baixas.js), não pra encontrar o título no retorno.

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

  // Nosso Número: não é mais a chave de busca do título, só referência
  // pra ligar de volta à remessa original na hora de exportar a baixa.
  const nossoNumeroFactoring = campo(linha, 63, 70)

  const ocorrenciaCodigo = campo(linha, 109, 110)
  const dataOcorrencia = toDate(campo(linha, 111, 116))

  // O campo Seu Número / Nº do Documento (nominalmente 117-126, 10 chars)
  // às vezes precisa de 1 caractere a mais (ex: "202600063/D" tem 11,
  // por causa da barra antes da letra da parcela). A Bancorp NÃO
  // compensa esse excesso em nenhum outro lugar da linha - ela deixa a
  // linha inteira crescer pra 401 bytes (em vez de 400), empurrando TUDO
  // que vem depois por essa mesma quantidade. Confirmado byte a byte
  // contra o arquivo real da Bancorp (341RETCLI...RET): 283 de 298
  // linhas de detalhe vinham com 401 bytes, e sem esse ajuste o valor
  // pago saía com 1 dígito a menos (ex: R$ 1.080,83 em vez de
  // R$ 10.808,38) e a data de crédito saía com lixo grudado na frente.
  //
  // Como o próprio excedente de tamanho da linha (linha.length - 400)
  // já denuncia o deslocamento, usamos ele pra realinhar todos os campos
  // daqui pra frente, em vez de confiar em posições fixas.
  const deslocamento = Math.max(0, linha.length - 400)
  const numeroDocumento = campo(linha, 117, 126 + deslocamento)

  function campoDeslocado(inicio1based, fim1based) {
    return campo(linha, inicio1based + deslocamento, fim1based + deslocamento)
  }

  // >>> CHAVE DE CASAMENTO: Seu Número / Nº do Documento, acima. <<<
  const vencimento = toDate(campoDeslocado(147, 152))
  const valorTitulo = toValor(campoDeslocado(153, 165))
  const valorAbatimento = toValor(campoDeslocado(228, 240))
  const valorDesconto = toValor(campoDeslocado(241, 253))
  const valorPrincipal = toValor(campoDeslocado(254, 266))
  const jurosMoraMulta = toValor(campoDeslocado(267, 279))
  const dataCredito = toDate(campoDeslocado(296, 301))
  const sacadoNome = campoDeslocado(325, 354)

  const valorPago = OCORRENCIAS_LIQUIDACAO.has(ocorrenciaCodigo)
    ? valorPrincipal || valorTitulo - valorDesconto - valorAbatimento + jurosMoraMulta
    : 0

  return {
    cnpjCedente,
    nossoNumeroFactoring,       // <- só referência, usado no export da baixa
    referenciaTitulo: numeroDocumento.replace(/\//g, ''), // <- eco informativo (compat.), não usado no casamento
    seuNumeroRaw: numeroDocumento, // <- chave de casamento real (normalizada em upload-retorno.js)
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
