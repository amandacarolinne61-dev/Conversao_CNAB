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
