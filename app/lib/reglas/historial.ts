// Convierte el historial de pedidos de un teléfono en las métricas que usa el motor.

export interface PedidoHistorial {
  estado: string;
  /** ISO 8601. Sin fecha se asume el orden en que vienen (del más viejo al más nuevo). */
  fecha?: string | null;
}

export type Resultado = "entregado" | "devuelto" | "otro";

export interface Estadisticas {
  entregas: number;
  devoluciones: number;
  /** entregas + devoluciones: los únicos pedidos que dicen algo del cliente. */
  terminados: number;
  /** % de devolución sobre los terminados (0 si no hay terminados). */
  tasaDevolucion: number;
  /** Devoluciones consecutivas contando desde el pedido terminado más reciente. */
  devolucionesSeguidas: number;
}

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/** Clasifica un estado de Dropi / transportadora / Shopify. Cancelados y en tránsito no cuentan. */
export function clasificarEstado(estado: string): Resultado {
  const e = sinTildes(estado);
  if (e === "ENTREGADO" || e === "ENTREGADA" || e === "DELIVERED") return "entregado";
  if (e.startsWith("DEVOLU") || e.startsWith("DEVUELT") || e.startsWith("RECHAZAD") || e === "RETURNED") {
    return "devuelto";
  }
  return "otro";
}

export function calcularEstadisticas(
  pedidos: PedidoHistorial[],
  mesesAntiguedad = 0,
  ahora: Date = new Date(),
): Estadisticas {
  let limite = -Infinity;
  if (mesesAntiguedad > 0) {
    const d = new Date(ahora);
    d.setMonth(d.getMonth() - mesesAntiguedad);
    limite = d.getTime();
  }

  const terminados = pedidos
    .map((p, i) => ({ i, t: p.fecha ? Date.parse(p.fecha) : NaN, r: clasificarEstado(p.estado) }))
    .filter((p) => p.r !== "otro" && (Number.isNaN(p.t) || p.t >= limite))
    // Más reciente primero; sin fecha válida se respeta el orden de entrada.
    .sort((a, b) =>
      Number.isNaN(a.t) || Number.isNaN(b.t) ? b.i - a.i : b.t - a.t || b.i - a.i,
    );

  const entregas = terminados.filter((p) => p.r === "entregado").length;
  const devoluciones = terminados.length - entregas;
  const primeraEntrega = terminados.findIndex((p) => p.r === "entregado");

  return {
    entregas,
    devoluciones,
    terminados: terminados.length,
    tasaDevolucion: terminados.length ? (devoluciones / terminados.length) * 100 : 0,
    devolucionesSeguidas: primeraEntrega === -1 ? devoluciones : primeraEntrega,
  };
}
