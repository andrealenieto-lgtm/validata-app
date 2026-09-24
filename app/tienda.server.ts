// Acceso a la configuración y al historial de cada tienda, y fuentes de historial para la validación.

import prisma from "./db.server";
import { normalizarAjustes, type Ajustes } from "./lib/reglas/ajustes.ts";
import {
  fuenteHttp,
  fuenteHuellaDropi,
  type FuenteHistorial,
} from "./lib/reglas/fuentes.ts";
import {
  conCache,
  fuenteTienda,
  type ModoHuella,
} from "./lib/reglas/validacion.ts";
import { clasificarEstado } from "./lib/reglas/historial.ts";
import type { FilaImportada } from "./lib/importar.ts";
import { normalizarUpsells, type ConfigUpsells } from "./lib/upsells.ts";
import { normalizarFormulario } from "./lib/formulario/esquema.ts";
import {
  normalizarOferta,
  normalizarPaquete,
  type OfertaCantidad,
  type Paquete,
} from "./lib/ofertas.ts";

const MODOS: ModoHuella[] = ["oculta", "nivel", "detalle_verificado"];

function leerJson<T>(texto: string | null | undefined): Partial<T> {
  try {
    return JSON.parse(texto || "{}") as Partial<T>;
  } catch {
    return {};
  }
}

export async function obtenerTienda(shop: string) {
  const t = await prisma.tienda.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
  return {
    ...t,
    formularioConfig: normalizarFormulario(leerJson(t.formulario)),
    ajustes: normalizarAjustes(leerJson<Ajustes>(t.validacion)),
    modoHuella: (MODOS.includes(t.modoHuella as ModoHuella)
      ? t.modoHuella
      : "detalle_verificado") as ModoHuella,
  };
}

export async function guardarFormulario(shop: string, entrada: unknown) {
  const limpio = normalizarFormulario(entrada);
  const formulario = JSON.stringify(limpio);
  await prisma.tienda.upsert({
    where: { shop },
    create: { shop, formulario },
    update: { formulario },
  });
  return limpio;
}

export async function guardarValidacion(
  shop: string,
  ajustes: Partial<Ajustes>,
  modoHuella: string,
) {
  const limpio = normalizarAjustes(ajustes);
  const modo = MODOS.includes(modoHuella as ModoHuella)
    ? modoHuella
    : "detalle_verificado";
  await prisma.tienda.upsert({
    where: { shop },
    create: { shop, validacion: JSON.stringify(limpio), modoHuella: modo },
    update: { validacion: JSON.stringify(limpio), modoHuella: modo },
  });
  return limpio;
}

// La red externa se crea una sola vez por proceso para que la caché sirva entre peticiones.
// Sin credenciales (mientras llega el convenio con 99 envíos) solo se usa el historial de la tienda.
let red: FuenteHistorial | null | undefined;
function fuenteRed(): FuenteHistorial | null {
  if (red === undefined) {
    const url = process.env.RED_HISTORIAL_URL;
    const apiKey = process.env.RED_HISTORIAL_API_KEY;
    red =
      url && apiKey
        ? conCache(
            fuenteHttp({ nombre: "99envios", url, apiKey }),
            10 * 60 * 1000,
          )
        : null;
  }
  return red;
}

export function fuentesPara(shop: string, ajustes: Ajustes): FuenteHistorial[] {
  const tienda = fuenteTienda(
    async (telefono) =>
      (
        await prisma.historialPedido.findMany({
          where: { shop, telefono },
          select: { estado: true, fecha: true },
          orderBy: { fecha: "asc" },
        })
      ).map((p) => ({
        estado: p.estado,
        fecha: p.fecha?.toISOString() ?? null,
      })),
    ajustes.mesesAntiguedad,
  );
  const huella = fuenteHuellaDropi((telefono) =>
    prisma.huellaDropi.findUnique({
      where: { shop_telefono: { shop, telefono } },
    }),
  );
  const r = fuenteRed();
  return r ? [tienda, huella, r] : [tienda, huella];
}

/**
 * Guarda filas importadas. Si la orden ya existía (misma referencia) se actualiza su estado:
 * así, reimportar un export más reciente convierte "EN REPARTO" en "ENTREGADO" o "DEVOLUCION".
 */
export async function guardarHistorial(
  shop: string,
  filas: FilaImportada[],
  origen = "csv",
) {
  for (let i = 0; i < filas.length; i += 500) {
    await prisma.$transaction(
      filas.slice(i, i + 500).map((f) =>
        prisma.historialPedido.upsert({
          where: {
            shop_origen_referencia: { shop, origen, referencia: f.referencia },
          },
          create: { shop, origen, ...f },
          update: { telefono: f.telefono, estado: f.estado, fecha: f.fecha },
        }),
      ),
    );
  }
}

export async function resumenHistorial(shop: string) {
  const [pedidos, telefonos, porEstado] = await Promise.all([
    prisma.historialPedido.count({ where: { shop } }),
    prisma.historialPedido
      .groupBy({ by: ["telefono"], where: { shop } })
      .then((g) => g.length),
    prisma.historialPedido.groupBy({
      by: ["estado"],
      where: { shop },
      _count: true,
    }),
  ]);
  let entregados = 0;
  let devueltos = 0;
  for (const e of porEstado) {
    const tipo = clasificarEstado(e.estado);
    if (tipo === "entregado") entregados += e._count;
    else if (tipo === "devuelto") devueltos += e._count;
  }
  return { pedidos, telefonos, entregados, devueltos };
}

export async function registrarEvento(
  shop: string,
  tipo: string,
  datos: unknown,
) {
  await prisma.evento.create({
    data: { shop, tipo, datos: JSON.stringify(datos) },
  });
}

// ─── Ofertas por cantidad ────────────────────────────────────────────────────

export async function listarOfertas(shop: string): Promise<OfertaCantidad[]> {
  const filas = await prisma.oferta.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });
  return filas.map((f) => normalizarOferta(leerJson(f.datos), f.id));
}

export async function obtenerOferta(shop: string, id: string) {
  const f = await prisma.oferta.findFirst({ where: { id, shop } });
  return f ? normalizarOferta(leerJson(f.datos), f.id) : null;
}

/** Crea (sin id) o actualiza una oferta. Devuelve la versión normalizada. */
export async function guardarOferta(
  shop: string,
  id: string | null,
  entrada: unknown,
) {
  const existente = id
    ? await prisma.oferta.findFirst({ where: { id, shop } })
    : null;
  const fila = existente ?? (await prisma.oferta.create({ data: { shop } }));
  const oferta = normalizarOferta(entrada, fila.id);
  await prisma.oferta.update({
    where: { id: fila.id },
    data: { datos: JSON.stringify(oferta) },
  });
  return oferta;
}

export async function eliminarOferta(shop: string, id: string) {
  await prisma.oferta.deleteMany({ where: { id, shop } });
}

// ─── Paquetes (combos) ───────────────────────────────────────────────────────

export async function listarPaquetes(shop: string): Promise<Paquete[]> {
  const filas = await prisma.paquete.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });
  return filas.map((f) => normalizarPaquete(leerJson(f.datos), f.id));
}

export async function obtenerPaquete(shop: string, id: string) {
  const f = await prisma.paquete.findFirst({ where: { id, shop } });
  return f ? normalizarPaquete(leerJson(f.datos), f.id) : null;
}

/** Crea (sin id) o actualiza un paquete. Devuelve la versión normalizada. */
export async function guardarPaquete(
  shop: string,
  id: string | null,
  entrada: unknown,
) {
  const existente = id
    ? await prisma.paquete.findFirst({ where: { id, shop } })
    : null;
  const fila = existente ?? (await prisma.paquete.create({ data: { shop } }));
  const paquete = normalizarPaquete(entrada, fila.id);
  await prisma.paquete.update({
    where: { id: fila.id },
    data: { datos: JSON.stringify(paquete) },
  });
  return paquete;
}

export async function eliminarPaquete(shop: string, id: string) {
  await prisma.paquete.deleteMany({ where: { id, shop } });
}

// ─── Upsells y downsells ─────────────────────────────────────────────────────
// Se guardan dentro de Tienda.configuracion (clave "upsells"), sin tabla propia.

export async function obtenerUpsells(shop: string): Promise<ConfigUpsells> {
  const t = await prisma.tienda.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
  return normalizarUpsells(
    leerJson<{ upsells: unknown }>(t.configuracion).upsells,
  );
}

export async function guardarUpsells(shop: string, entrada: unknown) {
  const upsells = normalizarUpsells(entrada);
  const t = await prisma.tienda.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
  const configuracion = {
    ...leerJson<Record<string, unknown>>(t.configuracion),
    upsells,
  };
  await prisma.tienda.update({
    where: { shop },
    data: { configuracion: JSON.stringify(configuracion) },
  });
  return upsells;
}
