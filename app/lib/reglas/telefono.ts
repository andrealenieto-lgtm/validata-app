// Normaliza teléfonos a formato E.164 (+573001234567) para comparar el número
// que escribe el cliente con el que viene en el historial importado.

export function normalizarTelefono(entrada: string, indicativoPais = "57"): string | null {
  const texto = String(entrada ?? "").trim();
  let digitos = texto.replace(/\D/g, "");
  if (!digitos) return null;

  if (texto.startsWith("+")) return digitos.length >= 8 ? `+${digitos}` : null;
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  else if (!digitos.startsWith(indicativoPais) || digitos.length <= 10) {
    // Número local: quitar el 0 de marcación nacional y poner el indicativo.
    digitos = indicativoPais + digitos.replace(/^0+/, "");
  }

  return digitos.length >= 10 && digitos.length <= 15 ? `+${digitos}` : null;
}
