// Parámetros del "modo simple" que cada tienda configura desde el panel.

export type Accion = "contraentrega" | "pago_previo" | "whatsapp";

export interface Ajustes {
  /** Pedidos terminados (entregados + devueltos) mínimos para evaluar por porcentaje. */
  minPedidos: number;
  /** % de devolución por encima del cual se quita la contraentrega. */
  maxDevolucionCOD: number;
  /** % de devolución por encima del cual se envía a WhatsApp. */
  maxDevolucionWhatsapp: number;
  /** Devoluciones consecutivas (las más recientes) que envían a WhatsApp. 0 = desactivado. */
  devolucionesSeguidas: number;
  /** Con 0 entregas y al menos N devoluciones se quita la contraentrega. 0 = desactivado. */
  devolucionesSinEntrega: number;
  /** Abono ofrecido cuando se quita la contraentrega. valor 0 = no se ofrece abono. */
  abono: { tipo: "porcentaje" | "monto"; valor: number };
  /** % de descuento por pagar el pedido completo por adelantado. */
  descuentoAnticipado: number;
  /** Qué ve un cliente sin historial. */
  clienteNuevo: "contraentrega" | "pago_previo";
  /** Solo cuentan pedidos de los últimos N meses. 0 = todo el historial. */
  mesesAntiguedad: number;
  /** Código de país que se asume cuando el cliente escribe el número sin indicativo. */
  indicativoPais: string;
  whatsapp: {
    numero: string;
    /** Cuando el historial manda a WhatsApp. Admite {nombre}, {producto}, {total}. */
    mensaje: string;
    /**
     * Cuando el cliente elige abonar: la venta se cierra por WhatsApp, la app no cobra el abono.
     * Admite además {cantidad}, {abono}, {saldo}, {telefono}, {direccion}, {ciudad}, {departamento}.
     */
    mensajeAbono: string;
  };
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  minPedidos: 4,
  maxDevolucionCOD: 35,
  maxDevolucionWhatsapp: 60,
  devolucionesSeguidas: 3,
  devolucionesSinEntrega: 2,
  abono: { tipo: "porcentaje", valor: 30 },
  descuentoAnticipado: 5,
  clienteNuevo: "contraentrega",
  mesesAntiguedad: 12,
  indicativoPais: "57",
  whatsapp: {
    numero: "",
    mensaje: "Hola, soy {nombre}. Quiero pedir {producto} por {total}.",
    mensajeAbono:
      "Hola, soy {nombre}. Quiero {producto} x{cantidad} por {total}. Quiero abonar {abono} y pagar {saldo} al recibir. Envío a: {direccion}, {ciudad} ({departamento}). Celular: {telefono}.",
  },
};

const entero = (v: unknown, min: number, max: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Mezcla lo guardado con los valores por defecto y corrige valores fuera de rango. */
export function normalizarAjustes(entrada: Partial<Ajustes> | null | undefined): Ajustes {
  const d = AJUSTES_POR_DEFECTO;
  const e = entrada ?? {};

  const maxDevolucionCOD = entero(e.maxDevolucionCOD, 0, 100, d.maxDevolucionCOD);
  // El corte de WhatsApp nunca puede quedar por debajo del de contraentrega.
  const maxDevolucionWhatsapp = Math.max(
    maxDevolucionCOD,
    entero(e.maxDevolucionWhatsapp, 0, 100, d.maxDevolucionWhatsapp),
  );

  const tipoAbono = e.abono?.tipo === "monto" ? "monto" : "porcentaje";
  const valorAbono =
    tipoAbono === "porcentaje"
      ? entero(e.abono?.valor, 0, 100, d.abono.valor)
      : Math.max(0, Number(e.abono?.valor) || 0);

  return {
    minPedidos: entero(e.minPedidos, 1, 100, d.minPedidos),
    maxDevolucionCOD,
    maxDevolucionWhatsapp,
    devolucionesSeguidas: entero(e.devolucionesSeguidas, 0, 50, d.devolucionesSeguidas),
    devolucionesSinEntrega: entero(e.devolucionesSinEntrega, 0, 50, d.devolucionesSinEntrega),
    abono: { tipo: tipoAbono, valor: valorAbono },
    descuentoAnticipado: entero(e.descuentoAnticipado, 0, 90, d.descuentoAnticipado),
    clienteNuevo: e.clienteNuevo === "pago_previo" ? "pago_previo" : "contraentrega",
    mesesAntiguedad: entero(e.mesesAntiguedad, 0, 120, d.mesesAntiguedad),
    indicativoPais: String(e.indicativoPais ?? d.indicativoPais).replace(/\D/g, "") || d.indicativoPais,
    whatsapp: {
      numero: String(e.whatsapp?.numero ?? "").replace(/\D/g, ""),
      mensaje: String(e.whatsapp?.mensaje || d.whatsapp.mensaje),
      mensajeAbono: String(e.whatsapp?.mensajeAbono || d.whatsapp.mensajeAbono),
    },
  };
}
