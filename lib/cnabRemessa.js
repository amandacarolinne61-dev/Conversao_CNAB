// Parser da REMESSA CNAB 400 (layout Itaú, validado com CB170707.TXT)
// Todas as linhas de remessa têm 400 caracteres de largura fixa (sem a
// inconsistência que existe no retorno de algumas factorings).

function toDate(ddmmaa) {
  if (!ddmmaa || ddmmaa.trim() === '' || ddmmaa === '000000') return null
  const dd = ddmmaa.slice(0, 2)
  const mm = ddmmaa.slice(2, 4)
  const aa = ddmmaa.slice(4, 6)
  const ano = parseInt(aa, 10) < 50 ? `20${aa}` : `19${aa}`
  return `${ano}-${mm}-${dd}`
}

function toValor(digitos13) {
  const n = parseInt(digitos13, 10)
  return isNaN(n) ? 0 : n / 100
}

export function parseRemessa(conteudo) {
  const linhas = conteudo.split(/\r\n|\r|\n/).filter((l) => l.length > 0)

  const header = linhas[0]
  const detalhes = linhas.filter((l) => l[0] === '1')

  const cabecalho = {
    portadorCodigo: header.slice(76, 79).trim(),
    portadorNome: header.slice(79, 94).trim(),
    nomeEmpresa: header.slice(46, 76).trim(),
    codigoTransmissao: header.slice(17, 29).trim(),
    dataGeracao: null,
    nomeArquivo: null,
  }

  const titulos = detalhes.map((l) => ({
    cnpjCedente: l.slice(3, 17).trim(),
    codigoTransmissao: l.slice(17, 29).trim(),
    nossoNumero: l.slice(62, 70).trim(),
    carteira: l.slice(83, 86).trim(),
    codigoCarteira: l.slice(107, 108).trim(),
    // Número do título (ex: "202600116A"): posição confirmada byte a byte
    // comparando parcelas diferentes do arquivo CB210703.TXT.
    seuNumero: l.slice(42, 52).trim().toUpperCase(),
    // Título no formato que o G3 realmente usa/mostra (ex: "01600626/A"),
    // COM a barra antes da letra da parcela - campo diferente do seuNumero
    // acima (mesmo sufixo/letra, prefixo diferente). Posição confirmada
    // byte a byte comparando parcelas diferentes do CB210704.TXT: fica
    // logo depois do código de carteira (posição 108), sempre 10
    // caracteres. Usado só na exportação de baixas (pro G3 reconhecer o
    // título) - o casamento título×retorno continua usando seuNumero.
    tituloG3: l.slice(108, 118).trim().toUpperCase(),
    dataVencimento: toDate(l.slice(120, 126)),
    valorTitulo: toValor(l.slice(126, 139)),
    dataEmissao: toDate(l.slice(150, 156)),
    cnpjSacado: l.slice(220, 234).trim(),
    nomeSacado: l.slice(234, 274).trim(),
    enderecoSacado: l.slice(274, 314).trim(),
    bairroSacado: l.slice(314, 326).trim(),
    cepSacado: l.slice(326, 334).trim(),
    cidadeSacado: l.slice(334, 349).trim(),
    ufSacado: l.slice(349, 351).trim(),
  }))

  return { cabecalho, titulos }
}
