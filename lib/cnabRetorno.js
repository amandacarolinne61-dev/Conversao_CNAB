// Parser do RETORNO CNAB 400.
//
// IMPORTANTE: arquivos de retorno de algumas factorings (ex: Bancorp) não têm
// largura 100% fixa - um campo de "seu número" no meio da linha às vezes vem
// sem zero à esquerda, o que empurra o resto da linha em 1 caractere (linhas
// de 400 ou 401 caracteres, dependendo do registro). Isso foi confirmado
// comparando o arquivo real 341RETCLI...RET campo a campo.
//
// Estratégia: os campos ANTES da zona variável são lidos por posição
// ABSOLUTA (a partir do início da linha) e os campos DEPOIS da zona variável
// são lidos por posição RELATIVA AO FIM da linha (contando de trás pra
// frente) - isso funciona porque a única coisa que varia é a largura do
// campo do meio, e tanto o início quanto o fim da linha continuam estáveis.

function toDate(ddmmaa) {
  if (!ddmmaa || ddmmaa.trim() === '' || ddmmaa === '000000') return null
  const dd = ddmmaa.slice(0, 2)
  const mm = ddmmaa.slice(2, 4)
  const aa = ddmmaa.slice(4, 6)
  const ano = parseInt(aa, 10) < 50 ? `20${aa}` : `19${aa}`
  return `${ano}-${mm}-${dd}`
}

function toValor(digitos) {
  const n = parseInt(digitos, 10)
  return isNaN(n) ? 0 : n / 100
}

export function parseRetorno(conteudo) {
  const linhas = conteudo.split(/\r\n|\r|\n/).filter((l) => l.length > 0)
  const header = linhas[0]
  const detalhes = linhas.filter((l) => l[0] === '1')

  const cabecalho = {
    portadorCodigo: header.slice(76, 79).trim(),
    portadorNome: header.slice(79, 94).trim(),
    nomeEmpresa: header.slice(46, 76).trim(),
    codigoTransmissao: header.slice(26, 46).trim(),
    dataGeracao: toDate(header.slice(94, 100)),
  }

  const movimentos = detalhes.map((l) => {
    const n = l.length

    // --- campos ancorados no INÍCIO (estáveis, antes da zona variável) ---
    const cnpjCedente = l.slice(3, 17).trim()
    const nossoNumero = l.slice(62, 70).trim()
    const ocorrenciaCodigo = l.slice(108, 110).trim()
    // trecho variável do "seu número" - melhor esforço, não é a chave de casamento
    const seuNumeroRaw = l.slice(120, n - 274).trim()

    // --- campos ancorados no FIM (estáveis, depois da zona variável) ---
    const dataOcorrencia = toDate(l.slice(n - 254, n - 248))
    const valorPago = toValor(l.slice(n - 248, n - 235))
    const dataCredito = toDate(l.slice(n - 105, n - 99))
    const sacadoNome = l.slice(n - 76, n - 6).trim()

    return {
      cnpjCedente,
      nossoNumero,
      ocorrenciaCodigo,
      seuNumeroRaw,
      dataOcorrencia,
      valorPago,
      dataCredito,
      sacadoNome,
    }
  })

  return { cabecalho, movimentos }
}
