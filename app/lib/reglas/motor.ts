// Decide qué método de pago ve el cliente según su historial y los ajustes de la tienda.

import type { Accion, Ajustes } from "./ajustes.ts";
import type { Estadisticas } from "./historial.ts";

export type Motivo =
  | "cliente_nuevo"
  | "devoluciones_seguidas"
  | "devoluciones_sin_entrega"
  | "tasa_whatsapp"
  | "tasa_cod"
  | "historial_bueno"
  | "historial_insuficiente";

export interface Decision {
  accion: Accion;
  /** Uso interno (panel y etiquetas del pedido). Nunca se muestra al cliente. */
  motivo: Motivo;
}

export function evaluar(e: Estadisticas, a: Ajustes): Decision {
  if (e.terminados === 0) return { accion: a.clienteNuevo, motivo: "cliente_nuevo" };

  if (a.devolucionesSeguidas > 0 && e.devolucionesSeguidas >= a.devolucionesSeguidas) {
    return { accion: "whatsapp", motivo: "devoluciones_seguidas" };
  }

  if (a.devolucionesSinEntrega > 0 && e.entregas === 0 && e.devoluciones >= a.devolucionesSinEntrega) {
    return { accion: "pago_previo", motivo: "devoluciones_sin_entrega" };
  }

  if (e.terminados < a.minPedidos) return { accion: "contraentrega", motivo: "historial_insuficiente" };

  if (e.tasaDevolucion > a.maxDevolucionWhatsapp) return { accion: "whatsapp", motivo: "tasa_whatsapp" };
  if (e.tasaDevolucion > a.maxDevolucionCOD) return { accion: "pago_previo", motivo: "tasa_cod" };

  return { accion: "contraentrega", motivo: "historial_bueno" };
}

export interface OpcionesPago {
  /** Total a pagar por adelantado, ya con descuento. */
  anticipado: number;
  /** null si la tienda no ofrece abono. */
  abono: { monto: number; saldoContraentrega: number } | null;
}

/** Montos para la pantalla de pago previo. Redondea a `decimales` (0 para COP). */
export function calcularPagos(total: number, a: Ajustes, decimales = 0): OpcionesPago {
  const f = 10 ** decimales;
  const r = (n: number) => Math.round(n * f) / f;

  const anticipado = r(total * (1 - a.descuentoAnticipado / 100));
  if (a.abono.valor <= 0) return { anticipado, abono: null };

  const monto = r(
    Math.min(total, a.abono.tipo === "porcentaje" ? (total * a.abono.valor) / 100 : a.abono.valor),
  );
  // Un abono igual al total es un pago anticipado sin descuento: no tiene sentido ofrecerlo.
  if (monto >= total) return { anticipado, abono: null };
  return { anticipado, abono: { monto, saldoContraentrega: r(total - monto) } };
}

/** Enlace wa.me con la plantilla llenada. Las variables sin dato quedan vacías. */
export function enlaceWhatsapp(
  a: Ajustes,
  datos: Record<string, string | number | undefined>,
  plantilla: string = a.whatsapp.mensaje,
): string | null {
  if (!a.whatsapp.numero) return null;
  const texto = plantilla.replace(/\{(\w+)\}/g, (_, k: string) => String(datos[k] ?? ""));
  return `https://wa.me/${a.whatsapp.numero}?text=${encodeURIComponent(texto)}`;
}
