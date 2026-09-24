// Configuración: visibilidad del formulario, protección contra el fraude y eventos de píxeles.
// La pestaña General (redirección, CSS, importar/exportar) y Socios son datos sin lógica propia.

import type { Alcance, ProductoEnCarrito } from "./upsells.ts";
import { aplicaA } from "./upsells.ts";

// ─── Visibilidad ─────────────────────────────────────────────────────────────

export type Pagina = "producto" | "carrito" | "inicio" | "coleccion" | "regular" | "busqueda" | "carrito_desplegable";

export interface Visibilidad {
  activo: boolean;
  colocacion: "toda_la_tienda" | "solo_productos" | "solo_carrito";
  desactivarEn: Pagina[];
  ocultarBotones: { pagar: boolean; agregarCarrito: boolean; comprarAhora: boolean };
  /** Qué compra el cliente al abrir el formulario desde un producto. */
  contenido: "solo_producto" | "producto_y_carrito";
  soloPara?: Alcance;
  excepto?: Alcance;
  /** Códigos ISO de país. Vacío = todos. Fuera de la lista se usa el checkout normal de Shopify. */
  paises: string[];
  /** Rango de total del pedido para ofrecer contraentrega. */
  rangoTotal?: { min?: number; max?: number };
  desactivarSinStock: boolean;
}

export interface Contexto {
  pagina: Pagina;
  carrito: ProductoEnCarrito[];
  pais?: string;
  total: number;
  hayStock: boolean;
}

export type MotivoOculto =
  | "desactivado"
  | "pagina"
  | "producto_no_incluido"
  | "producto_excluido"
  | "pais"
  | "total_fuera_de_rango"
  | "sin_stock";

/** null = se muestra el formulario; si no, por qué no (para depurar en el panel). */
export function motivoOculto(v: Visibilidad, c: Contexto): MotivoOculto | null {
  if (!v.activo) return "desactivado";
  if (v.desactivarEn.includes(c.pagina)) return "pagina";
  if (v.colocacion === "solo_productos" && c.pagina !== "producto") return "pagina";
  if (v.colocacion === "solo_carrito" && c.pagina !== "carrito" && c.pagina !== "carrito_desplegable") return "pagina";
  if (v.soloPara && v.soloPara.tipo !== "todos" && !aplicaA(v.soloPara, c.carrito)) return "producto_no_incluido";
  if (v.excepto && v.excepto.tipo !== "todos" && aplicaA(v.excepto, c.carrito)) return "producto_excluido";
  if (v.paises.length && c.pais && !v.paises.includes(c.pais.toUpperCase())) return "pais";
  if (v.rangoTotal) {
    const { min, max } = v.rangoTotal;
    if ((min != null && c.total < min) || (max != null && c.total > max)) return "total_fuera_de_rango";
  }
  if (v.desactivarSinStock && !c.hayStock) return "sin_stock";
  return null;
}

// ─── Protección contra el fraude ─────────────────────────────────────────────

export interface ProteccionFraude {
  limitePedidos?: { maximo: number; horas: number };
  maxUnidadesPorPedido?: number;
  telefonosBloqueados: string[]; // E.164
  /** Correos completos o dominios ("domain.com"). */
  correosBloqueados: string[];
  ipsBloqueadas: string[];
  ipsPermitidas: string[];
  codigosPostales?: { modo: "permitir" | "bloquear"; codigos: string[] };
  mensajeBloqueo: string;
}

export interface Intento {
  telefono: string; // E.164
  correo?: string;
  ip: string;
  codigoPostal?: string;
  unidades: number;
  /** Pedidos de prueba del comerciante o su equipo: no se bloquean. */
  esPrueba?: boolean;
}

export interface PedidoPrevio {
  telefono: string;
  correo?: string;
  ip: string;
  fecha: number; // ms
}

export type MotivoFraude =
  | "telefono_bloqueado"
  | "correo_bloqueado"
  | "ip_bloqueada"
  | "codigo_postal"
  | "demasiadas_unidades"
  | "limite_pedidos";

const limpiarIp = (ip: string) => ip.trim().toLowerCase();

/** Se evalúa antes de la validación por historial: si hay fraude, ni siquiera se consulta a 99 envíos. */
export function revisarFraude(
  p: ProteccionFraude,
  i: Intento,
  previos: PedidoPrevio[],
  ahora = Date.now(),
): MotivoFraude | null {
  if (i.esPrueba) return null;
  const ip = limpiarIp(i.ip);
  if (p.ipsPermitidas.map(limpiarIp).includes(ip)) return null;

  if (p.telefonosBloqueados.includes(i.telefono)) return "telefono_bloqueado";

  if (i.correo) {
    const correo = i.correo.trim().toLowerCase();
    const dominio = correo.split("@")[1] ?? "";
    const bloqueado = p.correosBloqueados.some((b) => {
      const x = b.trim().toLowerCase();
      return x.includes("@") ? x === correo : x === dominio;
    });
    if (bloqueado) return "correo_bloqueado";
  }

  if (p.ipsBloqueadas.map(limpiarIp).includes(ip)) return "ip_bloqueada";

  if (p.codigosPostales && i.codigoPostal != null) {
    const enLista = p.codigosPostales.codigos.includes(i.codigoPostal.trim());
    if (p.codigosPostales.modo === "permitir" ? !enLista : enLista) return "codigo_postal";
  }

  if (p.maxUnidadesPorPedido && i.unidades > p.maxUnidadesPorPedido) return "demasiadas_unidades";

  if (p.limitePedidos) {
    const desde = ahora - p.limitePedidos.horas * 3_600_000;
    const correo = i.correo?.trim().toLowerCase();
    const recientes = previos.filter(
      (x) =>
        x.fecha >= desde &&
        (x.telefono === i.telefono || limpiarIp(x.ip) === ip || (!!correo && x.correo?.toLowerCase() === correo)),
    ).length;
    if (recientes >= p.limitePedidos.maximo) return "limite_pedidos";
  }

  return null;
}

/** Convierte un textarea (una entrada por línea) en lista limpia y sin duplicados. */
export function lineas(texto: string): string[] {
  return [...new Set(texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

// ─── Píxeles ─────────────────────────────────────────────────────────────────

export type Plataforma = "facebook" | "tiktok" | "snap" | "pinterest" | "google" | "taboola" | "kwai";
export type Momento = "ver_contenido" | "agregar_carrito" | "abrir_formulario" | "llenar_formulario" | "compra";

/** Nombre del evento de cada plataforma para cada momento (null = esa plataforma no lo tiene). */
export const EVENTOS: Record<Plataforma, Partial<Record<Momento, string>>> = {
  facebook: {
    ver_contenido: "ViewContent",
    agregar_carrito: "AddToCart",
    abrir_formulario: "InitiateCheckout",
    llenar_formulario: "AddPaymentInfo",
    compra: "Purchase",
  },
  tiktok: { abrir_formulario: "InitiateCheckout", compra: "CompletePayment" },
  snap: { abrir_formulario: "START_CHECKOUT", compra: "PURCHASE" },
  pinterest: { compra: "checkout" },
  google: { abrir_formulario: "begin_checkout", compra: "purchase" },
  taboola: { abrir_formulario: "start_checkout", compra: "make_purchase" },
  kwai: { abrir_formulario: "initiatedCheckout", compra: "purchase" },
};

/**
 * Diferencia clave con EasySell: la compra solo se reporta a los píxeles cuando el pedido
 * queda confirmado. Si la validación pidió pago previo, se reporta cuando el cliente paga;
 * si lo mandó a WhatsApp, no se reporta. Así Meta/TikTok optimizan hacia clientes que sí reciben.
 */
export function reportarCompra(accion: "contraentrega" | "pago_previo" | "whatsapp", pagado: boolean): boolean {
  if (accion === "contraentrega") return true;
  if (accion === "pago_previo") return pagado;
  return false;
}
