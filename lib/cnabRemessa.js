// Parser da REMESSA CNAB 400 (layout do sistema Energy Power / Money Solution,
// validado com CB170707.TXT e CB210703.TXT)
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
    // Número do título (ex: "202600116A"): confirmado byte a byte comparando
    // parcelas diferentes do mesmo arquivo (CB210703.TXT) - a posição antiga
    // (110-120) pegava um campo diferente e errado.
    seuNumero: l.slice(42, 52).trim(),
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
