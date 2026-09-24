// Integraciones y mensajería: configuración de cada tienda, envío de mensajes (WhatsApp, SMS o
// webhook), filas a Google Sheets, códigos de verificación y recordatorios de carrito abandonado.
//
// Un mensaje o una hoja que falle nunca tumba un pedido: se registra el error y se sigue.

import prisma from "./db.server";
import {
  MENSAJERIA_POR_DEFECTO,
  debeRecordar,
  normalizarMensajeria,
  proveedorListo,
  type ConfigMensajeria,
  type Evento,
} from "./lib/mensajeria.ts";
import {
  OTP_VIGENCIA_MS,
  crearOtp,
  solicitudMensaje,
  solicitudSheets,
  verificarOtp,
  type ResultadoOtp,
  type Solicitud,
} from "./lib/envios.ts";
import { registrarEvento } from "./tienda.server";

type Datos = Record<string, string | number | undefined>;

function leerJson(texto: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(texto || "{}");
  } catch {
    return {};
  }
}

export async function obtenerMensajeria(
  shop: string,
): Promise<ConfigMensajeria> {
  const t = await prisma.tienda.findUnique({ where: { shop } });
  const guardada = leerJson(t?.configuracion).mensajeria;
  return guardada ? normalizarMensajeria(guardada) : MENSAJERIA_POR_DEFECTO;
}

export async function guardarMensajeria(shop: string, entrada: unknown) {
  const anterior = await obtenerMensajeria(shop);
  const mensajeria = normalizarMensajeria(entrada, anterior);
  const t = await prisma.tienda.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
  await prisma.tienda.update({
    where: { shop },
    data: {
      configuracion: JSON.stringify({
        ...leerJson(t.configuracion),
        mensajeria,
      }),
    },
  });
  return mensajeria;
}

/** Hace la petición con un tiempo máximo. Devuelve el resultado en vez de lanzar. */
export async function ejecutar(
  s: Solicitud,
): Promise<{ ok: boolean; estado: number; detalle: string }> {
  try {
    const r = await fetch(s.url, {
      method: s.method,
      headers: s.headers,
      body: s.body,
      redirect: "follow", // Apps Script responde con una redirección
      signal: AbortSignal.timeout(8000),
    });
    const detalle = (await r.text().catch(() => "")).slice(0, 300);
    return { ok: r.ok, estado: r.status, detalle };
  } catch (e) {
    return {
      ok: false,
      estado: 0,
      detalle: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function enviarMensaje(
  shop: string,
  evento: Evento,
  telefono: string,
  datos: Datos,
  cfg?: ConfigMensajeria,
) {
  const c = cfg ?? (await obtenerMensajeria(shop));
  const s = solicitudMensaje(c, evento, telefono, {
    tienda: c.nombreTienda || shop.replace(/\.myshopify\.com$/, ""),
    ...datos,
  });
  if (!s) return { ok: false, estado: 0, detalle: "sin_configurar" };
  const r = await ejecutar(s);
  if (!r.ok) {
    console.error(
      `mensaje ${evento} (${c.proveedor.tipo})`,
      r.estado,
      r.detalle,
    );
    await registrarEvento(shop, "mensaje_fallido", {
      evento,
      proveedor: c.proveedor.tipo,
      estado: r.estado,
    });
  }
  return r;
}

export async function enviarASheets(
  shop: string,
  datos: Datos,
  cfg?: ConfigMensajeria,
) {
  const s = solicitudSheets(cfg ?? (await obtenerMensajeria(shop)), datos);
  if (!s) return { ok: false, estado: 0, detalle: "sin_configurar" };
  const r = await ejecutar(s);
  if (!r.ok) console.error("google sheets", r.estado, r.detalle);
  return r;
}

// ─── Código de verificación ──────────────────────────────────────────────────

const SECRETO_OTP = () => process.env.SHOPIFY_API_SECRET || "validata-dev-otp";
/** Marca que se guarda cuando el mensaje no salió: ese cliente puede seguir sin código. */
const SIN_ENVIO = "sin_envio";

/** La verificación está activa y hay por dónde enviar el código. */
export const verificacionActiva = (c: ConfigMensajeria) =>
  c.verificacion.activa && proveedorListo(c.proveedor);

export async function enviarCodigo(
  shop: string,
  telefono: string,
): Promise<"enviado" | "espera" | "sin_envio"> {
  const cfg = await obtenerMensajeria(shop);
  const previo = await prisma.otp.findUnique({
    where: { shop_telefono: { shop, telefono } },
  });
  const r = crearOtp(
    telefono,
    SECRETO_OTP(),
    Date.now(),
    previo && previo.hash !== SIN_ENVIO
      ? { ...previo, creado: previo.creado.getTime() }
      : null,
  );
  if ("error" in r) return "espera";
  // El código se manda aunque la plantilla esté apagada: sin él no se puede verificar.
  const conPlantilla = {
    ...cfg,
    plantillas: {
      ...cfg.plantillas,
      codigo_verificacion: {
        ...cfg.plantillas.codigo_verificacion,
        activa: true,
      },
    },
  };
  const envio = await enviarMensaje(
    shop,
    "codigo_verificacion",
    telefono,
    { codigo: r.codigo },
    conPlantilla,
  );
  // Si el proveedor falla, no se le cierra la venta al cliente (se registra para revisar).
  const hash = envio.ok ? r.guardado.hash : SIN_ENVIO;
  await prisma.otp.upsert({
    where: { shop_telefono: { shop, telefono } },
    create: { shop, telefono, hash, creado: new Date(), intentos: 0 },
    update: { hash, creado: new Date(), intentos: 0 },
  });
  return envio.ok ? "enviado" : "sin_envio";
}

/** Verifica y, si es válido, consume el código (no sirve para un segundo pedido). */
export async function comprobarCodigo(
  shop: string,
  telefono: string,
  codigo: string,
): Promise<ResultadoOtp | "sin_codigo"> {
  const g = await prisma.otp.findUnique({
    where: { shop_telefono: { shop, telefono } },
  });
  if (!g) return "sin_codigo";
  if (g.hash === SIN_ENVIO) {
    if (Date.now() - g.creado.getTime() > OTP_VIGENCIA_MS) return "vencido";
    await prisma.otp.delete({ where: { shop_telefono: { shop, telefono } } });
    return "valido";
  }
  const { resultado, guardado } = verificarOtp(
    {
      telefono,
      hash: g.hash,
      creado: g.creado.getTime(),
      intentos: g.intentos,
    },
    codigo,
    SECRETO_OTP(),
  );
  if (resultado === "valido")
    await prisma.otp.delete({ where: { shop_telefono: { shop, telefono } } });
  else if (guardado.intentos !== g.intentos)
    await prisma.otp.update({
      where: { shop_telefono: { shop, telefono } },
      data: { intentos: guardado.intentos },
    });
  return resultado;
}

// ─── Carrito abandonado ──────────────────────────────────────────────────────

export async function guardarBorrador(
  shop: string,
  b: { telefono: string; nombre: string; producto: string; ruta: string },
) {
  await prisma.borrador.upsert({
    where: { shop_telefono: { shop, telefono: b.telefono } },
    create: { shop, ...b },
    update: { ...b, actualizado: new Date(), completado: false },
  });
}

export async function completarBorrador(shop: string, telefono: string) {
  await prisma.borrador.updateMany({
    where: { shop, telefono },
    data: { completado: true },
  });
}

/** Envía los recordatorios que ya tocan. Un solo recordatorio por borrador. */
export async function revisarCarritos(ahora = Date.now()) {
  const pendientes = await prisma.borrador.findMany({
    where: {
      completado: false,
      recordado: false,
      actualizado: { lte: new Date(ahora - 10 * 60_000) },
      // Más de un día: ya no tiene sentido recordarle.
      AND: { actualizado: { gte: new Date(ahora - 24 * 3600_000) } },
    },
    take: 200,
  });
  const configs = new Map<string, ConfigMensajeria>();
  for (const b of pendientes) {
    if (!configs.has(b.shop))
      configs.set(b.shop, await obtenerMensajeria(b.shop));
    const cfg = configs.get(b.shop)!;
    const borrador = {
      telefono: b.telefono,
      actualizado: b.actualizado.getTime(),
      completado: b.completado,
      recordatorioEnviado: b.recordado,
    };
    if (!debeRecordar(borrador, cfg.carritoAbandonado.minutosEspera, ahora))
      continue;
    // Se marca antes de enviar: si el envío falla, no se reintenta en bucle.
    await prisma.borrador.update({
      where: { shop_telefono: { shop: b.shop, telefono: b.telefono } },
      data: { recordado: true },
    });
    const r = await enviarMensaje(
      b.shop,
      "carrito_abandonado",
      b.telefono,
      {
        nombre: b.nombre,
        producto: b.producto,
        enlace: `https://${b.shop}${b.ruta}`,
      },
      cfg,
    );
    if (r.ok)
      await registrarEvento(b.shop, "carrito_recordado", {
        telefono: b.telefono,
      });
  }
}

// Revisión cada 5 minutos, una sola vez por proceso (en desarrollo el módulo se recarga).
const global_ = globalThis as unknown as { __vdCarritos?: NodeJS.Timeout };
if (!global_.__vdCarritos && process.env.NODE_ENV !== "test") {
  global_.__vdCarritos = setInterval(
    () => revisarCarritos().catch((e) => console.error("carritos", e)),
    5 * 60_000,
  );
  global_.__vdCarritos.unref?.();
}
