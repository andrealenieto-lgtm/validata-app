// Punto de entrada de la validación por teléfono: lo llama el formulario cuando el cliente
// escribe su número (y otra vez al enviar, para que no se pueda saltar desde el navegador).
//
// teléfono → normalizar → consultar fuentes (tienda + red externa) → reglas de la tienda
//          → respuesta pública: decisión, huella visible según el modo, opciones de pago.

import type { Accion, Ajustes } from "./ajustes.ts";
import { calcularEstadisticas, type Estadisticas, type PedidoHistorial } from "./historial.ts";
import { consultarFuentes, type FuenteHistorial } from "./fuentes.ts";
import { calcularPagos, enlaceWhatsapp, evaluar, type Motivo, type OpcionesPago } from "./motor.ts";
import { normalizarTelefono } from "./telefono.ts";

/**
 * Qué ve el cliente de su propia huella:
 *  - "oculta": solo el resultado (contraentrega disponible o no).
 *  - "nivel": una etiqueta ("Buen historial", "Historial con devoluciones"), sin números.
 *  - "detalle_verificado": etiqueta y, tras verificar el número con código, pedidos/entregas/devoluciones.
 * Mostrar números sin verificar dejaría a cualquiera consultar el historial de otra persona.
 */
export type ModoHuella = "oculta" | "nivel" | "detalle_verificado";

export type NivelHuella = "nuevo" | "bueno" | "con_devoluciones" | "alto_riesgo";

export interface Huella {
  nivel: NivelHuella;
  texto: string;
  /** Solo con modo "detalle_verificado" y el teléfono ya verificado. */
  detalle?: { pedidos: number; entregas: number; devoluciones: number; efectividad: number };
}

export interface Textos {
  niveles: Record<NivelHuella, string>;
  mensajes: Record<Accion, string>;
}

export const TEXTOS_POR_DEFECTO: Textos = {
  niveles: {
    nuevo: "Cliente nuevo",
    bueno: "Buen historial de entregas",
    con_devoluciones: "Historial con devoluciones",
    alto_riesgo: "Historial con varias devoluciones",
  },
  mensajes: {
    contraentrega: "✓ Pago contraentrega disponible",
    pago_previo: "Para este pedido necesitamos un pago previo. Elige cómo pagar:",
    whatsapp: "Para completar tu pedido, confírmalo con un asesor por WhatsApp.",
  },
};

export type RespuestaValidacion =
  | { ok: false; error: "telefono_invalido" }
  | {
      ok: true;
      telefono: string;
      accion: Accion;
      mensaje: string;
      huella: Huella | null;
      /** El modo pide verificación y el número aún no está verificado: ofrecer "Ver mi historial". */
      puedeVerificar: boolean;
      pagos: OpcionesPago | null;
      whatsapp: string | null;
    };

/** Resultado interno completo, para guardar en el pedido y en Análisis. Nunca se envía al navegador. */
export interface ResultadoInterno {
  publico: RespuestaValidacion;
  motivo: Motivo | null;
  estadisticas: Estadisticas | null;
  fuentesUsadas: string[];
  fuentesFallidas: string[];
}

/** El abono se cierra por WhatsApp: sin número de WhatsApp configurado no se ofrece. */
function pagosPrevios(total: number, a: Ajustes, decimales: number): OpcionesPago {
  const p = calcularPagos(total, a, decimales);
  return a.whatsapp.numero ? p : { ...p, abono: null };
}

function nivelDe(accion: Accion, e: Estadisticas | null): NivelHuella {
  if (!e || e.terminados === 0) return "nuevo";
  if (accion === "whatsapp") return "alto_riesgo";
  if (accion === "pago_previo" || e.devoluciones > 0) return "con_devoluciones";
  return "bueno";
}

export async function validarTelefono(opciones: {
  telefono: string;
  ajustes: Ajustes;
  fuentes: FuenteHistorial[];
  modoHuella: ModoHuella;
  telefonoVerificado: boolean;
  total: number;
  datos: { nombre?: string; producto?: string; totalTexto?: string };
  textos?: Textos;
  decimales?: number;
  timeoutMs?: number;
}): Promise<ResultadoInterno> {
  const { ajustes: a, textos = TEXTOS_POR_DEFECTO } = opciones;

  const telefono = normalizarTelefono(opciones.telefono, a.indicativoPais);
  if (!telefono) {
    return {
      publico: { ok: false, error: "telefono_invalido" },
      motivo: null,
      estadisticas: null,
      fuentesUsadas: [],
      fuentesFallidas: [],
    };
  }

  const r = await consultarFuentes(telefono, opciones.fuentes, opciones.timeoutMs);
  // Sin datos (número desconocido o fuentes caídas) se trata como cliente nuevo: no se frenan ventas.
  const e = r.estadisticas ?? calcularEstadisticas([]);
  const decision = evaluar(e, a);
  const nivel = nivelDe(decision.accion, r.estadisticas);

  let huella: Huella | null = null;
  if (opciones.modoHuella !== "oculta") {
    huella = { nivel, texto: textos.niveles[nivel] };
    if (opciones.modoHuella === "detalle_verificado" && opciones.telefonoVerificado && e.terminados > 0) {
      huella.detalle = {
        pedidos: e.terminados,
        entregas: e.entregas,
        devoluciones: e.devoluciones,
        efectividad: Math.round(100 - e.tasaDevolucion),
      };
    }
  }

  return {
    publico: {
      ok: true,
      telefono,
      accion: decision.accion,
      mensaje: textos.mensajes[decision.accion],
      huella,
      puedeVerificar: opciones.modoHuella === "detalle_verificado" && !opciones.telefonoVerificado && e.terminados > 0,
      pagos: decision.accion === "pago_previo" ? pagosPrevios(opciones.total, a, opciones.decimales ?? 0) : null,
      whatsapp:
        decision.accion === "whatsapp"
          ? enlaceWhatsapp(a, {
              nombre: opciones.datos.nombre,
              producto: opciones.datos.producto,
              total: opciones.datos.totalTexto,
            })
          : null,
    },
    motivo: decision.motivo,
    estadisticas: r.estadisticas,
    fuentesUsadas: r.usadas,
    fuentesFallidas: r.fallidas,
  };
}

// ─── Fuentes y protecciones ─────────────────────────────────────────────────

/** Historial propio de la tienda (pedidos importados de Dropi o marcados en Shopify). */
export function fuenteTienda(
  buscar: (telefono: string) => Promise<PedidoHistorial[]>,
  mesesAntiguedad: number,
): FuenteHistorial {
  return {
    nombre: "tienda",
    async consultar(telefono) {
      const pedidos = await buscar(telefono);
      return pedidos.length ? calcularEstadisticas(pedidos, mesesAntiguedad) : null;
    },
  };
}

/**
 * Guarda en memoria las respuestas de una fuente por `ttlMs`. El cliente suele escribir el
 * número y luego enviar el formulario: así la red externa (que puede cobrar por consulta)
 * se consulta una sola vez.
 */
export function conCache(fuente: FuenteHistorial, ttlMs: number, ahora = () => Date.now()): FuenteHistorial {
  const cache = new Map<string, { valor: Estadisticas | null; vence: number }>();
  return {
    nombre: fuente.nombre,
    async consultar(telefono) {
      const c = cache.get(telefono);
      if (c && c.vence > ahora()) return c.valor;
      const valor = await fuente.consultar(telefono);
      cache.set(telefono, { valor, vence: ahora() + ttlMs });
      return valor;
    },
  };
}

/**
 * Límite de consultas por IP, para que nadie recorra números de teléfono con el formulario.
 * En producción el contador va en la base de datos o Redis; esta versión en memoria sirve para
 * un solo servidor.
 */
export function limitador(maximo: number, ventanaMs: number, ahora = () => Date.now()) {
  const registros = new Map<string, number[]>();
  return (clave: string): boolean => {
    const t = ahora();
    const recientes = (registros.get(clave) ?? []).filter((x) => t - x < ventanaMs);
    if (recientes.length >= maximo) {
      registros.set(clave, recientes);
      return false;
    }
    recientes.push(t);
    registros.set(clave, recientes);
    return true;
  };
}
