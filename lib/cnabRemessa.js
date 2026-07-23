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
  const trailer = linhas[linhas.length - 1]

  const cabecalho = {
    portadorCodigo: header.slice(76, 79).trim(),
    portadorNome: header.slice(79, 94).trim(),
    nomeEmpresa: header.slice(46, 76).trim(),
    codigoTransmissao: header.slice(17, 29).trim(),
    dataGeracao: null,
    nomeArquivo: null,
    // Linhas brutas de header/trailer, guardadas pra permitir montar um
    // reenvio de remessa (só com os títulos selecionados) reaproveitando
    // esse header/trailer verbatim, sem reconstruir do layout oficial -
    // ver comentário em schema.sql sobre `remessas.header_bruto`.
    headerBruto: header,
    trailerBruto: trailer,
  }

  // Cada título ocupa duas linhas físicas na remessa: um registro tipo `1`
  // (detalhe) sempre seguido por um registro tipo `5` (mensagem/endereço) -
  // confirmado byte a byte em CB210704.TXT, par 1-5 sem exceção pros 54
  // títulos do arquivo. Guardamos as duas linhas brutas por título (ver
  // `titulos.linha_bruta_detalhe`/`linha_bruta_mensagem` em schema.sql).
  const pares = []
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i][0] === '1') {
      const mensagem = linhas[i + 1] && linhas[i + 1][0] === '5' ? linhas[i + 1] : null
      pares.push({ detalhe: linhas[i], mensagem })
    }
  }

  const titulos = pares.map(({ detalhe: l, mensagem }) => ({
    linhaBrutaDetalhe: l,
    linhaBrutaMensagem: mensagem,
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
    // Nº do documento de cobrança (posição 38-62, 25 posições, layout
    // oficial CNAB 400) - campo bruto que o G3 ecoa de volta no arquivo de
    // retorno (confirmado byte a byte contra CN20076A.RET, outro cliente
    // G3 que já funcionou: mesmo estilo "00767000004883AV"). Gravado
    // verbatim (sem reformatar) e ecoado igual na exportação de baixas.
    documentoCobranca: l.slice(37, 62).toUpperCase(),
    // Número do título (posição 38-44, 7 dígitos) - sub-campo dentro do
    // "documento de cobrança" acima, mas é o único trecho dessas 25
    // posições que realmente varia por título (o resto fica em branco
    // nos arquivos reais). Igual pra todas as parcelas (A/B/C/D) de um
    // mesmo título, muda de título pra título - confirmado byte a byte:
    // título 600626 (parcelas A/B/C) = "0002820", 600636 (A/B/C/D) =
    // "0003220", 600631 = "0004820". Gravado à parte pra garantir que a
    // exportação de baixas escreva esse valor certo mesmo se o restante
    // do campo documentoCobranca vier vazio/incompleto.
    numeroTitulo: l.slice(37, 44).trim(),
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
