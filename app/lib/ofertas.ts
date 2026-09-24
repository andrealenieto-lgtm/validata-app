// Ofertas por cantidad y paquetes: definición y cálculo de precios.
// El servidor recalcula todo con los precios reales de Shopify al crear el pedido;
// nunca se confía en los montos que manda el navegador.

export type TipoDescuento = "porcentaje" | "monto" | "precioFijo";

export interface Descuento {
  tipo: TipoDescuento;
  /** % (0-100), monto a restar, o precio final fijo, según `tipo`. */
  valor: number;
}

export interface NivelCantidad {
  id: string;
  cantidad: number;
  titulo: string; // "2 Unidades"
  /** Admite {descuento} (p. ej. "Ahorra {descuento}"). */
  subtitulo: string;
  /** Insignia sobre el nivel, estilo Kaching: "Más popular", "Mejor precio". Vacía = sin insignia. */
  etiqueta: string;
  descuento: Descuento;
  porDefecto: boolean;
}

export interface DisenoOferta {
  /** "barras": una fila por nivel (Kaching). "tarjetas": niveles lado a lado. */
  plantilla: "barras" | "tarjetas";
  encabezado: string; // "¡Compra más y ahorra!"
  colorPrincipal: string; // borde y radio del nivel elegido
  colorFondo: string;
  colorFondoSeleccionado: string;
  colorTexto: string;
  colorEtiqueta: string;
  colorTextoEtiqueta: string;
  radio: number;
}

export interface OfertaCantidad {
  id: string;
  nombre: string;
  activa: boolean;
  /** Todos los productos de la tienda o solo los de `productoIds` (ids numéricos de Shopify). */
  todosLosProductos: boolean;
  productoIds: string[];
  niveles: NivelCantidad[];
  diseno: DisenoOferta;
  /** Dónde se muestran las barras: dentro del formulario y/o encima del botón de compra. */
  ubicacion: { formulario: boolean; encimaBoton: boolean };
  opciones: {
    /** Muestra el precio por unidad ("$ 79.760 c/u"). */
    mostrarPrecioUnitario: boolean;
    /** Usa el precio de comparación de Shopify como precio tachado. */
    usarPrecioComparacion: boolean;
  };
}

export interface ProductoPaquete {
  productoId: string;
  cantidad: number;
}

export interface Paquete {
  id: string;
  nombre: string;
  activo: boolean;
  /** De 2 a 5 productos. El paquete se ofrece en la página de cualquiera de ellos. */
  productos: ProductoPaquete[];
  descuento: Descuento;
  titulo: string; // "Paquete completo"
  /** Admite {descuento}. */
  subtitulo: string; // "Ahorra {descuento}"
  etiqueta: string; // "MÁS POPULAR"
  textoPrecioEstandar: string; // "Precio estándar"
  /** El paquete sale elegido al abrir el formulario. */
  porDefecto: boolean;
  /** Productos del paquete en fila (horizontal) o en columna (vertical). */
  plantilla: "horizontal" | "vertical";
  diseno: DisenoOferta;
}

/** Precio unitario y de comparación de un producto/variante, en unidades de moneda. */
export interface PrecioProducto {
  precio: number;
  precioComparacion?: number | null;
}

const redondear = (n: number, decimales: number) => {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
};

/** Aplica un descuento a un monto. Nunca devuelve negativo ni más que el monto original. */
export function aplicarDescuento(monto: number, d: Descuento, decimales = 2): number {
  let r: number;
  if (d.tipo === "porcentaje") r = monto * (1 - Math.min(100, Math.max(0, d.valor)) / 100);
  else if (d.tipo === "monto") r = monto - d.valor;
  else r = d.valor;
  return redondear(Math.min(monto, Math.max(0, r)), decimales);
}

export interface PrecioCalculado {
  /** Lo que paga el cliente. */
  total: number;
  /** Precio tachado. */
  antes: number;
  ahorro: number;
  /** Ahorro redondeado en %, para "Ahorra 20%". */
  ahorroPct: number;
}

const resultado = (total: number, antes: number, decimales: number): PrecioCalculado => ({
  total,
  antes,
  ahorro: redondear(antes - total, decimales),
  ahorroPct: antes > 0 ? Math.round(((antes - total) / antes) * 100) : 0,
});

export function precioNivel(
  nivel: NivelCantidad,
  producto: PrecioProducto,
  usarPrecioComparacion = false,
  decimales = 2,
): PrecioCalculado {
  const base = redondear(producto.precio * nivel.cantidad, decimales);
  // El pedido se cobra por unidad: el total es precio unitario redondeado × cantidad, para que
  // lo que ve el cliente y lo que cobra Shopify coincidan al centavo.
  const unitario = redondear(aplicarDescuento(base, nivel.descuento, 6) / nivel.cantidad, decimales);
  const total = redondear(unitario * nivel.cantidad, decimales);
  const comp = producto.precioComparacion;
  const antes =
    usarPrecioComparacion && comp && comp > producto.precio ? redondear(comp * nivel.cantidad, decimales) : base;
  return resultado(total, antes, decimales);
}

export interface LineaPaquete {
  productoId: string;
  cantidad: number;
  /** Precio por unidad con el descuento repartido (lo que se cobra en el pedido). */
  unitario: number;
  /** Precio final de la línea = unitario × cantidad. */
  total: number;
  antes: number;
}

/**
 * Precio del paquete. El descuento se reparte en proporción al precio de cada producto y cada
 * línea se cobra por unidad (unitario × cantidad), así el pedido de Shopify suma exacto.
 */
export function precioPaquete(
  paquete: Pick<Paquete, "productos" | "descuento">,
  precios: Record<string, PrecioProducto>,
  decimales = 2,
): PrecioCalculado & { lineas: LineaPaquete[] } {
  const lineas = paquete.productos.map((p) => {
    const precio = precios[p.productoId];
    if (!precio) throw new Error(`Producto sin precio: ${p.productoId}`);
    return { productoId: p.productoId, cantidad: p.cantidad, antes: redondear(precio.precio * p.cantidad, decimales) };
  });

  const antes = redondear(lineas.reduce((s, l) => s + l.antes, 0), decimales);
  const objetivo = aplicarDescuento(antes, paquete.descuento, 6);
  const conTotal = lineas.map((l) => {
    const unitario = redondear((antes ? (l.antes / antes) * objetivo : 0) / l.cantidad, decimales);
    return { ...l, unitario, total: redondear(unitario * l.cantidad, decimales) };
  });
  const total = redondear(conTotal.reduce((s, l) => s + l.total, 0), decimales);
  return { ...resultado(total, antes, decimales), lineas: conTotal };
}

/** Reemplaza {descuento} en textos como "Ahorra {descuento}". */
export function textoConDescuento(plantilla: string, ahorroPct: number): string {
  return plantilla.replace(/\{(descuento|discount)\}/g, `${ahorroPct}%`);
}

export interface Resumen {
  subtotal: number;
  descuento: number;
  envio: number;
  total: number;
}

/** Bloque "Resumen del pedido": subtotal a precio normal, descuentos, envío y total. */
export function resumenPedido(
  lineas: { antes: number; total: number }[],
  envio = 0,
  decimales = 2,
): Resumen {
  const subtotal = redondear(lineas.reduce((s, l) => s + l.antes, 0), decimales);
  const conDescuento = redondear(lineas.reduce((s, l) => s + l.total, 0), decimales);
  return {
    subtotal,
    descuento: redondear(subtotal - conDescuento, decimales),
    envio,
    total: redondear(conDescuento + envio, decimales),
  };
}

// ─── Normalización y selección (ofertas por cantidad) ───────────────────────

export const DISENO_POR_DEFECTO: DisenoOferta = {
  plantilla: "barras",
  encabezado: "¡Compra más y ahorra!",
  colorPrincipal: "#10b981",
  colorFondo: "#ffffff",
  colorFondoSeleccionado: "#ecfdf5",
  colorTexto: "#111111",
  colorEtiqueta: "#10b981",
  colorTextoEtiqueta: "#ffffff",
  radio: 12,
};

export const NIVELES_POR_DEFECTO: NivelCantidad[] = [
  { id: "n1", cantidad: 1, titulo: "1 unidad", subtitulo: "Precio normal", etiqueta: "", descuento: { tipo: "porcentaje", valor: 0 }, porDefecto: false },
  { id: "n2", cantidad: 2, titulo: "2 unidades", subtitulo: "Ahorra {descuento}", etiqueta: "Más popular", descuento: { tipo: "porcentaje", valor: 20 }, porDefecto: true },
  { id: "n3", cantidad: 3, titulo: "3 unidades", subtitulo: "Ahorra {descuento}", etiqueta: "Mejor precio", descuento: { tipo: "porcentaje", valor: 30 }, porDefecto: false },
];

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown, def: string, max = 80) => (typeof v === "string" ? v.slice(0, max) : def);
const color = (v: unknown, def: string) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : def);
const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

function normalizarDescuento(v: unknown): Descuento {
  const d = obj(v);
  const tipo: TipoDescuento = d.tipo === "monto" || d.tipo === "precioFijo" ? d.tipo : "porcentaje";
  return { tipo, valor: num(d.valor, 0, tipo === "porcentaje" ? 100 : 1e9, 0) };
}

/** Todo lo que guarda el editor pasa por aquí: los textos llegan a la tienda y los montos al pedido. */
export function normalizarOferta(entrada: unknown, id: string): OfertaCantidad {
  const e = obj(entrada);
  const d = obj(e.diseno);
  const vistos = new Set<number>();
  let niveles = (Array.isArray(e.niveles) ? e.niveles : NIVELES_POR_DEFECTO)
    .slice(0, 6)
    .map((v, i): NivelCantidad => {
      const n = obj(v);
      return {
        id: typeof n.id === "string" && /^[\w-]{1,40}$/.test(n.id) ? n.id : `n${i + 1}`,
        cantidad: Math.round(num(n.cantidad, 1, 20, i + 1)),
        titulo: txt(n.titulo, `${i + 1} unidades`),
        subtitulo: txt(n.subtitulo, ""),
        etiqueta: txt(n.etiqueta, "", 30),
        descuento: normalizarDescuento(n.descuento),
        porDefecto: bool(n.porDefecto, false),
      };
    })
    // Una cantidad no puede repetirse; se muestran de menor a mayor.
    .filter((n) => !vistos.has(n.cantidad) && !!vistos.add(n.cantidad))
    .sort((a, b) => a.cantidad - b.cantidad);
  if (!niveles.length) niveles = NIVELES_POR_DEFECTO.map((n) => ({ ...n }));
  // Exactamente un nivel elegido por defecto.
  const elegido = Math.max(0, niveles.findIndex((n) => n.porDefecto));
  niveles = niveles.map((n, i) => ({ ...n, porDefecto: i === elegido }));

  const u = obj(e.ubicacion);
  const o = obj(e.opciones);
  return {
    id,
    nombre: txt(e.nombre, "Nueva oferta", 80) || "Nueva oferta",
    activa: bool(e.activa, true),
    todosLosProductos: bool(e.todosLosProductos, false),
    productoIds: (Array.isArray(e.productoIds) ? e.productoIds : [])
      .map((x) => String(x).replace(/\D/g, ""))
      .filter(Boolean)
      .slice(0, 100),
    niveles,
    diseno: {
      plantilla: d.plantilla === "tarjetas" ? "tarjetas" : "barras",
      encabezado: txt(d.encabezado, DISENO_POR_DEFECTO.encabezado),
      colorPrincipal: color(d.colorPrincipal, DISENO_POR_DEFECTO.colorPrincipal),
      colorFondo: color(d.colorFondo, DISENO_POR_DEFECTO.colorFondo),
      colorFondoSeleccionado: color(d.colorFondoSeleccionado, DISENO_POR_DEFECTO.colorFondoSeleccionado),
      colorTexto: color(d.colorTexto, DISENO_POR_DEFECTO.colorTexto),
      colorEtiqueta: color(d.colorEtiqueta, DISENO_POR_DEFECTO.colorEtiqueta),
      colorTextoEtiqueta: color(d.colorTextoEtiqueta, DISENO_POR_DEFECTO.colorTextoEtiqueta),
      radio: Math.round(num(d.radio, 0, 30, DISENO_POR_DEFECTO.radio)),
    },
    ubicacion: { formulario: bool(u.formulario, true), encimaBoton: bool(u.encimaBoton, false) },
    opciones: {
      mostrarPrecioUnitario: bool(o.mostrarPrecioUnitario, true),
      usarPrecioComparacion: bool(o.usarPrecioComparacion, false),
    },
  };
}

/** La oferta que aplica a un producto: la primera activa que lo incluye (o que aplica a todos). */
export function ofertaParaProducto(ofertas: OfertaCantidad[], productoId: string): OfertaCantidad | null {
  const id = String(productoId).replace(/\D/g, "");
  return (
    ofertas.find((o) => o.activa && !o.todosLosProductos && o.productoIds.includes(id)) ??
    ofertas.find((o) => o.activa && o.todosLosProductos) ??
    null
  );
}

/**
 * Precio que cobra el servidor por un nivel. null si el nivel no existe en la oferta: así el
 * navegador no puede inventar un descuento.
 */
export function cobroNivel(
  oferta: OfertaCantidad | null,
  nivelId: string | null | undefined,
  producto: PrecioProducto,
): { cantidad: number; total: number; antes: number; nivel: NivelCantidad } | null {
  const nivel = oferta?.niveles.find((n) => n.id === nivelId);
  if (!oferta || !nivel) return null;
  const p = precioNivel(nivel, producto, oferta.opciones.usarPrecioComparacion);
  return { cantidad: nivel.cantidad, total: p.total, antes: p.antes, nivel };
}

// ─── Paquetes (combos de varios productos) ──────────────────────────────────

export const PAQUETE_POR_DEFECTO: Omit<Paquete, "id"> = {
  nombre: "Nuevo paquete",
  activo: true,
  productos: [],
  descuento: { tipo: "porcentaje", valor: 20 },
  titulo: "Paquete completo",
  subtitulo: "Ahorra {descuento}",
  etiqueta: "Más popular",
  textoPrecioEstandar: "Precio estándar",
  porDefecto: true,
  plantilla: "horizontal",
  diseno: { ...DISENO_POR_DEFECTO, encabezado: "" },
};

export function normalizarPaquete(entrada: unknown, id: string): Paquete {
  const e = obj(entrada);
  const d = obj(e.diseno);
  const dp = PAQUETE_POR_DEFECTO;
  const vistos = new Set<string>();
  const productos = (Array.isArray(e.productos) ? e.productos : [])
    .map((v) => {
      const p = obj(v);
      return {
        productoId: String(p.productoId ?? "").replace(/\D/g, ""),
        cantidad: Math.round(num(p.cantidad, 1, 10, 1)),
      };
    })
    .filter((p) => p.productoId && !vistos.has(p.productoId) && !!vistos.add(p.productoId))
    .slice(0, 5);
  return {
    id,
    nombre: txt(e.nombre, dp.nombre) || dp.nombre,
    activo: bool(e.activo, dp.activo),
    productos,
    descuento: e.descuento ? normalizarDescuento(e.descuento) : dp.descuento,
    titulo: txt(e.titulo, dp.titulo),
    subtitulo: txt(e.subtitulo, dp.subtitulo),
    etiqueta: txt(e.etiqueta, dp.etiqueta, 30),
    textoPrecioEstandar: txt(e.textoPrecioEstandar, dp.textoPrecioEstandar),
    porDefecto: bool(e.porDefecto, dp.porDefecto),
    plantilla: e.plantilla === "vertical" ? "vertical" : "horizontal",
    diseno: {
      plantilla: "barras",
      encabezado: txt(d.encabezado, ""),
      colorPrincipal: color(d.colorPrincipal, dp.diseno.colorPrincipal),
      colorFondo: color(d.colorFondo, dp.diseno.colorFondo),
      colorFondoSeleccionado: color(d.colorFondoSeleccionado, dp.diseno.colorFondoSeleccionado),
      colorTexto: color(d.colorTexto, dp.diseno.colorTexto),
      colorEtiqueta: color(d.colorEtiqueta, dp.diseno.colorEtiqueta),
      colorTextoEtiqueta: color(d.colorTextoEtiqueta, dp.diseno.colorTextoEtiqueta),
      radio: Math.round(num(d.radio, 0, 30, dp.diseno.radio)),
    },
  };
}

/** Un paquete necesita al menos 2 productos para tener sentido. */
export const paqueteValido = (p: Paquete) => p.productos.length >= 2;

/** El primer paquete activo que incluye el producto. */
export function paqueteParaProducto(paquetes: Paquete[], productoId: string): Paquete | null {
  const id = String(productoId).replace(/\D/g, "");
  return paquetes.find((p) => p.activo && paqueteValido(p) && p.productos.some((x) => x.productoId === id)) ?? null;
}
