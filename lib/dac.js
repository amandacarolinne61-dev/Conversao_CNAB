// Dígito verificador do Nosso Número - algoritmo módulo 10 (padrão Itaú)
// sequência: agência (4) + conta (7) + carteira (3) + nosso número (8) = 22 dígitos
export function calcularDacModulo10(sequenciaDigitos) {
  let peso = 2
  let total = 0
  for (let i = sequenciaDigitos.length - 1; i >= 0; i--) {
    let produto = parseInt(sequenciaDigitos[i], 10) * peso
    if (produto > 9) produto -= 9
    total += produto
    peso = peso === 2 ? 1 : 2
  }
  const resto = total % 10
  return resto === 0 ? 0 : 10 - resto
}
