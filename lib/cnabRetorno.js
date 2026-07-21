// Parser do RETORNO CNAB 400.
//
// IMPORTANTE: arquivos de retorno de algumas factorings (ex: Bancorp) não têm
// largura 100% fixa - um campo de referência do título no meio da linha às
// vezes vem sem zero à esquerda (ou sem a barra "/"), o que empurra o resto
// da linha em 1 caractere (linhas de 400 ou 401 caracteres, dependendo do
// registro). Isso foi confirmado comparando o arquivo real 341RETCLI...RET
// campo a campo.
//
// DESCOBERTA IMPORTANTE (21/07): o campo lido nas posições 62-70 é o
// "nosso número" da PRÓPRIA FACTORING (ex: "06564083"), NÃO o seu_numero/
// título do seu sistema. A CHAVE DE CASAMENTO real é a referência do título
// que aparece embutida na zona variável (ex: "202600309/F"), que corresponde
// ao seu_numero salvo na remessa (ex: "202600309F", sem a barra).
//
// Essa referência é extraída de forma robusta: ela sempre termina bem antes
// de o número da factoring (posições 62-70) se repetir mais adiante na
// linha - usamos essa repetição como âncora de fim, o que funciona
// independente da referência ter 8, 9 ou 10 caracteres, com ou sem barra.
//
// Estratégia geral: os campos ANTES da zona variável são lidos por posição
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
    // Nosso número DA FACTORING (número interno dela, não é o seu_numero
    // do seu sistema) - mantido só como informação de apoio/debug.
    const nossoNumeroFactoring = l.slice(62, 70).trim()
    const ocorrenciaCodigo = l.slice(108, 110).trim()

    // Referência do título (CHAVE DE CASAMENTO): começa logo após a data de
    // ocorrência (posição 116) e vai até a próxima ocorrência do nosso
    // número da factoring mais adiante na linha - essa repetição serve de
    // âncora de fim confiável, mesmo com largura variável.
    let referenciaTitulo = ''
    if (nossoNumeroFactoring) {
      const fimRef = l.indexOf(nossoNumeroFactoring, 116)
      if (fimRef > 116) {
        referenciaTitulo = l.slice(116, fimRef).trim()
      }
    }
    // Normaliza removendo a barra "/" (formato antigo da factoring) pra
    // bater com o seu_numero do seu sistema (ex: "202600309/F" -> "202600309F")
    const referenciaNormalizada = referenciaTitulo.replace(/\//g, '')

    // --- campos ancorados no FIM (estáveis, depois da zona variável) ---
    const dataOcorrencia = toDate(l.slice(n - 254, n - 248))
    const valorPago = toValor(l.slice(n - 248, n - 235))
    const dataCredito = toDate(l.slice(n - 105, n - 99))
    const sacadoNome = l.slice(n - 76, n - 6).trim()

    return {
      cnpjCedente,
      nossoNumeroFactoring,
      ocorrenciaCodigo,
      referenciaTitulo: referenciaNormalizada,
      dataOcorrencia,
      valorPago,
      dataCredito,
      sacadoNome,
    }
  })

  return { cabecalho, movimentos }
}
