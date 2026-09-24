// Equivalencia entre los departamentos de Dropi (los del desplegable del formulario) y los
// códigos de provincia que Shopify usa para Colombia (ISO 3166-2 sin el prefijo "CO-").
// El pedido debe llegar con el código correcto para que la integración de Dropi lo importe.

const CODIGOS: Record<string, string> = {
  AMAZONAS: "AMA",
  ANTIOQUIA: "ANT",
  ARAUCA: "ARA",
  "ARCHIPIELAGO DE SAN ANDRES": "SAP",
  ATLANTICO: "ATL",
  BOLIVAR: "BOL",
  BOYACA: "BOY",
  CALDAS: "CAL",
  CAQUETA: "CAQ",
  CASANARE: "CAS",
  CAUCA: "CAU",
  CESAR: "CES",
  CHOCO: "CHO",
  CORDOBA: "COR",
  CUNDINAMARCA: "CUN",
  GUAINIA: "GUA",
  GUAVIARE: "GUV",
  HUILA: "HUI",
  "LA GUAJIRA": "LAG",
  MAGDALENA: "MAG",
  META: "MET",
  NARINO: "NAR",
  "NORTE DE SANTANDER": "NSA",
  PUTUMAYO: "PUT",
  QUINDIO: "QUI",
  RISARALDA: "RIS",
  SANTANDER: "SAN",
  SUCRE: "SUC",
  TOLIMA: "TOL",
  VALLE: "VAC",
  VAUPES: "VAU",
  VICHADA: "VID",
};

const limpiar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Código de provincia de Shopify. Bogotá va aparte (DC) aunque Dropi la liste en Cundinamarca. */
export function codigoProvincia(
  departamento: string,
  ciudad: string,
): string | null {
  const c = limpiar(ciudad);
  if (c === "BOGOTA" || c === "BOGOTA D C" || c === "BOGOTA DC") return "DC";
  return CODIGOS[limpiar(departamento)] ?? null;
}
