// Planes de suscripción. El cobro lo hace Shopify (Billing API, appSubscriptionCreate):
// un cargo recurrente por el plan y, en planes mensuales, un cargo por uso para los
// pedidos adicionales. Aquí se define qué incluye cada plan y se controla el cupo.

export type IdPlan = "gratis" | "profesional" | "avanzado" | "ilimitado";
export type Intervalo = "mensual" | "anual";

export type Funcion =
  | "validacionTienda" // reglas con el historial propio de la tienda
  | "validacionRed" // consulta a la red externa (99 envíos)
  | "pagoParcial" // abono + saldo contraentrega
  | "upsells"
  | "ofertasCantidad"
  | "paquetes"
  | "plantillas"
  | "multilingue"
  | "pixelesPorProducto";

export interface Plan {
  id: IdPlan;
  nombre: string;
  /** USD al mes con pago mensual. */
  precioMensual: number;
  /** Pedidos incluidos por ciclo de 30 días. null = ilimitado. */
  pedidosIncluidos: number | null;
  /** USD por pedido adicional. null = al llegar al cupo no se crean más pedidos. */
  precioAdicional: number | null;
  funciones: Funcion[];
}

const BASE: Funcion[] = ["validacionTienda", "upsells", "ofertasCantidad"];
const PROFESIONAL: Funcion[] = [...BASE, "validacionRed", "paquetes", "plantillas"];
const AVANZADO: Funcion[] = [...PROFESIONAL, "pagoParcial", "multilingue", "pixelesPorProducto"];

export const PLANES: Record<IdPlan, Plan> = {
  gratis: {
    id: "gratis",
    nombre: "Gratis",
    precioMensual: 0,
    pedidosIncluidos: 60,
    precioAdicional: null,
    funciones: BASE,
  },
  profesional: {
    id: "profesional",
    nombre: "Profesional",
    precioMensual: 9.95,
    pedidosIncluidos: 440,
    precioAdicional: 0.05,
    funciones: PROFESIONAL,
  },
  avanzado: {
    id: "avanzado",
    nombre: "Avanzado",
    precioMensual: 24.95,
    pedidosIncluidos: 10000,
    precioAdicional: 0.05,
    funciones: AVANZADO,
  },
  ilimitado: {
    id: "ilimitado",
    nombre: "Ilimitado",
    precioMensual: 49.95, // Pendiente de confirmar.
    pedidosIncluidos: null,
    precioAdicional: null,
    funciones: AVANZADO,
  },
};

export const DESCUENTO_ANUAL = 0.25;
/** Porcentaje del cupo a partir del cual se avisa al comerciante. */
export const AVISO_CUPO = 0.8;
/** Tope de cargos por uso por ciclo (capacidad que el comerciante aprueba en Shopify). */
export const TOPE_USO_USD = 100;

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Precio a cobrar por ciclo: mensual, o el año completo con el descuento. */
export function precio(idPlan: IdPlan, intervalo: Intervalo): number {
  const m = PLANES[idPlan].precioMensual;
  return intervalo === "anual" ? redondear(m * 12 * (1 - DESCUENTO_ANUAL)) : m;
}

/** Precio mensual equivalente que se muestra en la tarjeta del plan. */
export function precioMensualMostrado(idPlan: IdPlan, intervalo: Intervalo): number {
  const m = PLANES[idPlan].precioMensual;
  return intervalo === "anual" ? redondear(m * (1 - DESCUENTO_ANUAL)) : m;
}

export function tieneFuncion(idPlan: IdPlan, f: Funcion): boolean {
  return (PLANES[idPlan] ?? PLANES.gratis).funciones.includes(f);
}

export interface EstadoCupo {
  /** Se puede crear el pedido desde el formulario. */
  permitido: boolean;
  /** El pedido que se va a crear genera un cargo por uso. */
  cobrarAdicional: boolean;
  usados: number;
  incluidos: number | null;
  /** Ya se pasó el umbral de aviso: mostrar banner "Mejorar plan" y enviar correo. */
  avisar: boolean;
}

/**
 * Estado del cupo antes de crear un pedido.
 * `usoCobradoUsd` es lo ya cobrado por uso en el ciclo, para no pasar el tope aprobado.
 * Shopify no permite cargos por uso en suscripciones anuales: en anual, al llenar el cupo
 * el formulario se desactiva igual que en el plan gratis.
 */
export function estadoCupo(
  idPlan: IdPlan,
  intervalo: Intervalo,
  pedidosDelCiclo: number,
  usoCobradoUsd = 0,
): EstadoCupo {
  const plan = PLANES[idPlan] ?? PLANES.gratis;
  const incluidos = plan.pedidosIncluidos;
  const usados = pedidosDelCiclo;

  if (incluidos === null) {
    return { permitido: true, cobrarAdicional: false, usados, incluidos, avisar: false };
  }

  const avisar = usados >= Math.floor(incluidos * AVISO_CUPO);
  if (usados < incluidos) return { permitido: true, cobrarAdicional: false, usados, incluidos, avisar };

  const puedeCobrar =
    plan.precioAdicional !== null &&
    intervalo === "mensual" &&
    usoCobradoUsd + plan.precioAdicional <= TOPE_USO_USD;
  return { permitido: puedeCobrar, cobrarAdicional: puedeCobrar, usados, incluidos, avisar: true };
}
