// Upsells de 1 clic, upsells de 1 casilla (1-Tick) y downsells: cuándo se muestran y cuánto cuestan.

import { aplicarDescuento, type Descuento, type PrecioProducto } from "./ofertas.ts";

/** A qué productos aplica. `productos`/`colecciones` guardan IDs de Shopify. */
export type Alcance =
  | { tipo: "todos" }
  | { tipo: "productos"; ids: string[] }
  | { tipo: "colecciones"; ids: string[] };

export interface ProductoEnCarrito {
  productoId: string;
  coleccionIds: string[];
}

export function aplicaA(alcance: Alcance, carrito: ProductoEnCarrito[]): boolean {
  if (alcance.tipo === "todos") return carrito.length > 0;
  const ids = new Set(alcance.ids);
  return carrito.some((p) =>
    alcance.tipo === "productos" ? ids.has(p.productoId) : p.coleccionIds.some((c) => ids.has(c)),
  );
}

// ─── 1-Click Upsell ──────────────────────────────────────────────────────────

export const MAX_OFERTAS_UPSELL = 5;

export interface OfertaUpsell {
  id: string;
  productoId: string;
  descuento: Descuento;
  selectorCantidad: boolean;
  seleccionVariantes: boolean;
  /** Minutos del temporizador; 0 = sin temporizador. */
  temporizadorMin: number;
}

export interface Upsell1Click {
  id: string;
  nombre: string;
  activo: boolean;
  /** Pre-compra: antes de enviar el formulario. Post-compra: después de crear el pedido. */
  modo: "pre" | "post";
  disparador: Alcance;
  /** Se muestran en orden; aceptar o rechazar una pasa a la siguiente. */
  ofertas: OfertaUpsell[];
  textos: {
    encabezado: string; // "Has desbloqueado una oferta especial"
    subtitulo: string; // "¡Solo por tiempo limitado!"
    temporizador: string; // "Date prisa, la oferta termina en {time}"
    etiquetaDescuento: string; // "- {discount}"
    aceptar: string; // "Sí, añadir a mi pedido"
    rechazar: string; // "No, gracias"
  };
  colores: { principal: string; fondo: string; texto: string };
}

/** Primer upsell activo que aplica al carrito (en el orden en que el comerciante los ordenó). */
export function upsellParaCarrito(
  upsells: Upsell1Click[],
  modo: "pre" | "post",
  carrito: ProductoEnCarrito[],
): Upsell1Click | null {
  return upsells.find((u) => u.activo && u.modo === modo && u.ofertas.length && aplicaA(u.disparador, carrito)) ?? null;
}

/**
 * Siguiente oferta de la secuencia. No se ofrece un producto que el cliente ya tiene en el
 * carrito o que ya aceptó en esta misma secuencia.
 */
export function siguienteOferta(
  upsell: Upsell1Click,
  indiceActual: number,
  productosEnPedido: string[],
): { oferta: OfertaUpsell; indice: number } | null {
  const tiene = new Set(productosEnPedido);
  const ofertas = upsell.ofertas.slice(0, MAX_OFERTAS_UPSELL);
  for (let i = indiceActual + 1; i < ofertas.length; i++) {
    if (!tiene.has(ofertas[i].productoId)) return { oferta: ofertas[i], indice: i };
  }
  return null;
}

export function precioOfertaUpsell(oferta: OfertaUpsell, producto: PrecioProducto, cantidad = 1) {
  const antes = producto.precio * cantidad;
  return { antes, total: aplicarDescuento(antes, oferta.descuento) };
}

/** "Date prisa, la oferta termina en {time}" → mm:ss. */
export function textoTemporizador(plantilla: string, segundosRestantes: number): string {
  const s = Math.max(0, Math.floor(segundosRestantes));
  const mmss = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return plantilla.replace(/\{time\}/g, mmss);
}

// ─── 1-Tick Upsell (casilla en el formulario) ────────────────────────────────

export interface Upsell1Tick {
  id: string;
  nombre: string;
  activo: boolean;
  alcance: Alcance;
  titulo: string; // "Envío prioritario"
  precio: number;
  /** Admite {{title}} y {{price}}. */
  texto: string;
  requiereEnvio: boolean;
  cobrarImpuesto: boolean;
  /** Si se vincula a un producto, entra como esa variante; si no, como línea personalizada. */
  varianteId?: string;
  selectorCantidad: boolean;
  colores: { marca: string; fondo: string; borde: string; estiloBorde: "solid" | "dashed" | "dotted" };
}

export function ticksParaCarrito(ticks: Upsell1Tick[], carrito: ProductoEnCarrito[]): Upsell1Tick[] {
  return ticks.filter((t) => t.activo && aplicaA(t.alcance, carrito));
}

export function textoTick(t: Upsell1Tick, formatear: (n: number) => string): string {
  return t.texto.replace(/\{\{\s*title\s*\}\}/g, t.titulo).replace(/\{\{\s*price\s*\}\}/g, formatear(t.precio));
}

// ─── Downsell (al cerrar el formulario) ──────────────────────────────────────

export interface Downsell {
  id: string;
  nombre: string;
  activo: boolean;
  alcance: Alcance;
  /** Cuántas veces debe cerrarse el formulario antes de mostrarlo (1-4). */
  cierresNecesarios: number;
  descuento: Descuento;
  textos: {
    titulo: string; // "¡Espera!"
    subtitulo: string; // "¡Felicidades! ¡Acabas de desbloquear un descuento especial!"
    descripcion: string; // "Compra ahora, ¡obtén un descuento!"
    insignia: string; // "descuento"
    aceptar: string; // "Completar pedido con {discount} de DESCUENTO"
    rechazar: string; // "No, gracias"
  };
  colores: { fondo: string; texto: string; boton: string; textoBoton: string };
}

/** Downsell a mostrar después de este cierre, o null. Solo se muestra una vez por visita. */
export function downsellAlCerrar(
  downsells: Downsell[],
  carrito: ProductoEnCarrito[],
  cierres: number,
  yaMostrado: boolean,
): Downsell | null {
  if (yaMostrado) return null;
  return downsells.find((d) => d.activo && aplicaA(d.alcance, carrito) && cierres === d.cierresNecesarios) ?? null;
}

/** "Completar pedido con {discount} de DESCUENTO". */
export function textoDownsell(plantilla: string, d: Descuento, formatear: (n: number) => string): string {
  const valor = d.tipo === "porcentaje" ? `${d.valor}%` : formatear(d.valor);
  return plantilla.replace(/\{(discount|descuento)\}/g, valor);
}

// ─── Configuración guardada y validación ─────────────────────────────────────

export interface ConfigUpsells {
  ticks: Upsell1Tick[];
  clicks: Upsell1Click[];
  downsells: Downsell[];
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown, def: string, max = 160) => (typeof v === "string" ? v.slice(0, max) : def);
const color = (v: unknown, def: string) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : def);
const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
const idValido = (v: unknown, def: string) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : def);
const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function normalizarAlcance(v: unknown): Alcance {
  const a = obj(v);
  const ids = (Array.isArray(a.ids) ? a.ids : []).map(soloDigitos).filter(Boolean).slice(0, 100);
  if (a.tipo === "productos") return { tipo: "productos", ids };
  if (a.tipo === "colecciones") return { tipo: "colecciones", ids };
  return { tipo: "todos" };
}

function normalizarDescuento(v: unknown, def: Descuento): Descuento {
  const d = obj(v);
  if (!Object.keys(d).length) return def;
  const tipo = d.tipo === "monto" ? "monto" : "porcentaje";
  return { tipo, valor: num(d.valor, 0, tipo === "porcentaje" ? 90 : 1e9, def.valor) };
}

export const TICK_POR_DEFECTO: Omit<Upsell1Tick, "id"> = {
  nombre: "Envío prioritario",
  activo: true,
  alcance: { tipo: "todos" },
  titulo: "Envío prioritario",
  precio: 5000,
  texto: "🔥 Añade {{title}} por solo {{price}} y recibe tu producto en 24-48 horas.",
  requiereEnvio: false,
  cobrarImpuesto: false,
  selectorCantidad: false,
  colores: { marca: "#1579ff", fondo: "#f6fff4", borde: "#0eda52", estiloBorde: "dashed" },
};

export const CLICK_POR_DEFECTO: Omit<Upsell1Click, "id"> = {
  nombre: "Nueva venta adicional",
  activo: true,
  modo: "pre",
  disparador: { tipo: "todos" },
  ofertas: [],
  textos: {
    encabezado: "Has desbloqueado una oferta especial",
    subtitulo: "¡Solo por tiempo limitado!",
    temporizador: "Date prisa, la oferta termina en {time}",
    etiquetaDescuento: "- {discount}",
    aceptar: "Sí, añadir a mi pedido",
    rechazar: "No, gracias",
  },
  colores: { principal: "#111111", fondo: "#ffffff", texto: "#111111" },
};

export const DOWNSELL_POR_DEFECTO: Omit<Downsell, "id"> = {
  nombre: "Descuento al cerrar",
  activo: true,
  alcance: { tipo: "todos" },
  cierresNecesarios: 1,
  descuento: { tipo: "porcentaje", valor: 10 },
  textos: {
    titulo: "¡Espera!",
    subtitulo: "¡Felicidades! ¡Acabas de desbloquear un descuento especial!",
    descripcion: "Compra ahora, ¡obtén un descuento!",
    insignia: "descuento",
    aceptar: "Completar pedido con {discount} de DESCUENTO",
    rechazar: "No, gracias",
  },
  colores: { fondo: "#fde68a", texto: "#111111", boton: "#e11d48", textoBoton: "#ffffff" },
};

function normalizarTick(v: unknown, i: number): Upsell1Tick {
  const e = obj(v);
  const d = TICK_POR_DEFECTO;
  const c = obj(e.colores);
  const variante = soloDigitos(e.varianteId);
  return {
    id: idValido(e.id, `tick${i + 1}`),
    nombre: txt(e.nombre, d.nombre, 80) || d.nombre,
    activo: bool(e.activo, d.activo),
    alcance: normalizarAlcance(e.alcance),
    titulo: txt(e.titulo, d.titulo, 80) || d.titulo,
    precio: Math.round(num(e.precio, 0, 1e9, d.precio) * 100) / 100,
    texto: txt(e.texto, d.texto, 300),
    requiereEnvio: bool(e.requiereEnvio, d.requiereEnvio),
    cobrarImpuesto: bool(e.cobrarImpuesto, d.cobrarImpuesto),
    ...(variante ? { varianteId: variante } : {}),
    selectorCantidad: false,
    colores: {
      marca: color(c.marca, d.colores.marca),
      fondo: color(c.fondo, d.colores.fondo),
      borde: color(c.borde, d.colores.borde),
      estiloBorde: c.estiloBorde === "solid" || c.estiloBorde === "dotted" ? c.estiloBorde : "dashed",
    },
  };
}

function normalizarClick(v: unknown, i: number): Upsell1Click {
  const e = obj(v);
  const d = CLICK_POR_DEFECTO;
  const t = obj(e.textos);
  const c = obj(e.colores);
  const vistos = new Set<string>();
  return {
    id: idValido(e.id, `click${i + 1}`),
    nombre: txt(e.nombre, d.nombre, 80) || d.nombre,
    activo: bool(e.activo, d.activo),
    // Por ahora solo antes de confirmar: el de después de la compra necesita editar pedidos.
    modo: "pre",
    disparador: normalizarAlcance(e.disparador),
    ofertas: (Array.isArray(e.ofertas) ? e.ofertas : [])
      .map((x, j): OfertaUpsell => {
        const o = obj(x);
        return {
          id: idValido(o.id, `o${j + 1}`),
          productoId: soloDigitos(o.productoId),
          descuento: normalizarDescuento(o.descuento, { tipo: "porcentaje", valor: 10 }),
          selectorCantidad: false,
          seleccionVariantes: false,
          temporizadorMin: Math.round(num(o.temporizadorMin, 0, 60, 10)),
        };
      })
      .filter((o) => o.productoId && !vistos.has(o.id) && !!vistos.add(o.id))
      .slice(0, MAX_OFERTAS_UPSELL),
    textos: {
      encabezado: txt(t.encabezado, d.textos.encabezado),
      subtitulo: txt(t.subtitulo, d.textos.subtitulo),
      temporizador: txt(t.temporizador, d.textos.temporizador),
      etiquetaDescuento: txt(t.etiquetaDescuento, d.textos.etiquetaDescuento, 40),
      aceptar: txt(t.aceptar, d.textos.aceptar, 60) || d.textos.aceptar,
      rechazar: txt(t.rechazar, d.textos.rechazar, 60) || d.textos.rechazar,
    },
    colores: {
      principal: color(c.principal, d.colores.principal),
      fondo: color(c.fondo, d.colores.fondo),
      texto: color(c.texto, d.colores.texto),
    },
  };
}

function normalizarDownsell(v: unknown, i: number): Downsell {
  const e = obj(v);
  const d = DOWNSELL_POR_DEFECTO;
  const t = obj(e.textos);
  const c = obj(e.colores);
  return {
    id: idValido(e.id, `down${i + 1}`),
    nombre: txt(e.nombre, d.nombre, 80) || d.nombre,
    activo: bool(e.activo, d.activo),
    alcance: normalizarAlcance(e.alcance),
    cierresNecesarios: Math.round(num(e.cierresNecesarios, 1, 4, d.cierresNecesarios)),
    descuento: normalizarDescuento(e.descuento, d.descuento),
    textos: {
      titulo: txt(t.titulo, d.textos.titulo),
      subtitulo: txt(t.subtitulo, d.textos.subtitulo),
      descripcion: txt(t.descripcion, d.textos.descripcion),
      insignia: txt(t.insignia, d.textos.insignia, 30),
      aceptar: txt(t.aceptar, d.textos.aceptar, 80) || d.textos.aceptar,
      rechazar: txt(t.rechazar, d.textos.rechazar, 60) || d.textos.rechazar,
    },
    colores: {
      fondo: color(c.fondo, d.colores.fondo),
      texto: color(c.texto, d.colores.texto),
      boton: color(c.boton, d.colores.boton),
      textoBoton: color(c.textoBoton, d.colores.textoBoton),
    },
  };
}

function unicos<T extends { id: string }>(lista: T[]): T[] {
  const vistos = new Set<string>();
  return lista.filter((x) => !vistos.has(x.id) && !!vistos.add(x.id));
}

export function normalizarUpsells(entrada: unknown): ConfigUpsells {
  const e = obj(entrada);
  const lista = (v: unknown) => (Array.isArray(v) ? v.slice(0, 20) : []);
  return {
    ticks: unicos(lista(e.ticks).map(normalizarTick)),
    clicks: unicos(lista(e.clicks).map(normalizarClick)),
    downsells: unicos(lista(e.downsells).map(normalizarDownsell)),
  };
}

/** Lo que el cliente eligió en el formulario. Solo se usan ids; los montos los pone el servidor. */
export interface SeleccionExtras {
  ticks?: unknown;
  upsell?: unknown; // { upsellId, ofertaId }
  downsell?: unknown; // id
}

export interface ExtrasValidados {
  ticks: Upsell1Tick[];
  upsell: { upsell: Upsell1Click; oferta: OfertaUpsell } | null;
  downsell: Downsell | null;
}

/**
 * Acepta solo lo que existe, está activo y aplica al producto del pedido. Lo demás se ignora
 * en silencio: un id inventado no produce un descuento ni un producto gratis.
 */
export function validarExtras(cfg: ConfigUpsells, carrito: ProductoEnCarrito[], sel: SeleccionExtras): ExtrasValidados {
  const idsTicks = new Set((Array.isArray(sel.ticks) ? sel.ticks : []).map(String));
  const ticks = ticksParaCarrito(cfg.ticks, carrito).filter((t) => idsTicks.has(t.id));

  let upsell: ExtrasValidados["upsell"] = null;
  const u = obj(sel.upsell);
  const candidato = upsellParaCarrito(cfg.clicks, "pre", carrito);
  if (candidato && candidato.id === u.upsellId) {
    const oferta = candidato.ofertas.find((o) => o.id === u.ofertaId);
    // No se ofrece como upsell un producto que ya está en el pedido.
    if (oferta && !carrito.some((p) => p.productoId === oferta.productoId)) upsell = { upsell: candidato, oferta };
  }

  const d = cfg.downsells.find((x) => x.id === sel.downsell && x.activo && aplicaA(x.alcance, carrito)) ?? null;
  return { ticks, upsell, downsell: d };
}

/** % que representa el downsell sobre el total (un monto fijo se convierte a %). */
export function porcentajeDownsell(d: Downsell | null, total: number): number {
  if (!d || total <= 0) return 0;
  if (d.descuento.tipo === "porcentaje") return Math.min(90, d.descuento.valor);
  return Math.min(90, Math.round((d.descuento.valor / total) * 10000) / 100);
}
