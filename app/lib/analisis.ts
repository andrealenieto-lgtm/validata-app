// Análisis: aperturas del formulario, pedidos, ingresos, conversión, valor promedio,
// datos UTM y los resultados de la validación por teléfono.
// A diferencia de EasySell, los días se agrupan en la zona horaria de la tienda, no en UTC.

import type { Accion } from "./reglas/ajustes.ts";

export interface Utm {
  campana?: string | null;
  fuente?: string | null;
  medio?: string | null;
}

export type EventoAnalisis =
  | { tipo: "apertura"; fecha: string; utm?: Utm }
  | { tipo: "pedido"; fecha: string; total: number; utm?: Utm; upsell?: number }
  /** Resultado de la validación por teléfono al enviar el formulario. */
  | { tipo: "validacion"; fecha: string; accion: Accion };

/** "YYYY-MM-DD" del instante en la zona horaria dada. */
export function diaLocal(fechaIso: string, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(fechaIso),
  );
}

export interface PuntoDia {
  dia: string;
  aperturas: number;
  pedidos: number;
  ingresos: number;
}

export interface Resumen {
  aperturas: number;
  pedidos: number;
  ingresos: number;
  ingresosUpsell: number;
  /** % de aperturas que terminan en pedido. */
  conversion: number;
  valorPromedio: number;
  validacion: Record<Accion, number>;
  serie: PuntoDia[];
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Todos los días del rango (inclusive), para que los días sin datos salgan en 0 en la gráfica. */
function dias(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const d = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  for (; d <= fin; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export function resumir(eventos: EventoAnalisis[], zona: string, desde: string, hasta: string): Resumen {
  const serie = new Map(dias(desde, hasta).map((dia) => [dia, { dia, aperturas: 0, pedidos: 0, ingresos: 0 }]));
  const validacion: Record<Accion, number> = { contraentrega: 0, pago_previo: 0, whatsapp: 0 };
  let ingresosUpsell = 0;

  for (const e of eventos) {
    const p = serie.get(diaLocal(e.fecha, zona));
    if (!p) continue; // fuera del rango
    if (e.tipo === "apertura") p.aperturas++;
    else if (e.tipo === "pedido") {
      p.pedidos++;
      p.ingresos = r2(p.ingresos + e.total);
      ingresosUpsell = r2(ingresosUpsell + (e.upsell ?? 0));
    } else validacion[e.accion]++;
  }

  const puntos = [...serie.values()];
  const aperturas = puntos.reduce((s, p) => s + p.aperturas, 0);
  const pedidos = puntos.reduce((s, p) => s + p.pedidos, 0);
  const ingresos = r2(puntos.reduce((s, p) => s + p.ingresos, 0));
  return {
    aperturas,
    pedidos,
    ingresos,
    ingresosUpsell,
    conversion: pct(pedidos, aperturas),
    valorPromedio: pedidos ? r2(ingresos / pedidos) : 0,
    validacion,
    serie: puntos,
  };
}

export interface FilaUtm {
  campana: string;
  fuente: string;
  medio: string;
  aperturas: number;
  pedidos: number;
  conversion: number;
}

/** Tabla "Datos UTM", ordenada por pedidos. Los valores vacíos se muestran como "-". */
export function tablaUtm(eventos: EventoAnalisis[]): FilaUtm[] {
  const filas = new Map<string, FilaUtm>();
  for (const e of eventos) {
    if (e.tipo === "validacion") continue;
    const campana = e.utm?.campana || "-";
    const fuente = e.utm?.fuente || "-";
    const medio = e.utm?.medio || "-";
    const clave = JSON.stringify([campana, fuente, medio]);
    const f = filas.get(clave) ?? { campana, fuente, medio, aperturas: 0, pedidos: 0, conversion: 0 };
    if (e.tipo === "apertura") f.aperturas++;
    else f.pedidos++;
    filas.set(clave, f);
  }
  return [...filas.values()]
    .map((f) => ({ ...f, conversion: pct(f.pedidos, f.aperturas) }))
    .sort((a, b) => b.pedidos - a.pedidos || b.aperturas - a.aperturas);
}

/**
 * Estimado de lo que se ahorró la tienda al no despachar contraentrega a clientes riesgosos:
 * pedidos frenados × costo de una devolución (flete de ida y vuelta que define el comerciante).
 * Es un estimado: no todos los pedidos frenados se habrían devuelto.
 */
export function ahorroEstimado(r: Resumen, costoDevolucion: number, tasaDevolucionEvitada = 1): number {
  const frenados = r.validacion.pago_previo + r.validacion.whatsapp;
  return Math.round(frenados * costoDevolucion * tasaDevolucionEvitada);
}
