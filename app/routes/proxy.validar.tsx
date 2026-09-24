// POST /apps/validata/validar (App Proxy): el formulario de la tienda consulta aquí la huella
// del teléfono. Shopify firma la petición y `authenticate.public.appProxy` la verifica.
//
// El total que llega del navegador solo sirve para mostrar los montos de pago previo; al crear
// el pedido se vuelve a validar y a calcular todo con los precios reales de Shopify.

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { limitador, validarTelefono } from "../lib/reglas/validacion.ts";
import { fuentesPara, obtenerTienda, registrarEvento } from "../tienda.server";

// 20 consultas por IP cada 10 minutos; si Shopify no reenvía la IP, un tope general por tienda.
const porIp = limitador(20, 10 * 60 * 1000);
const porTienda = limitador(600, 10 * 60 * 1000);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session)
    return Response.json({ ok: false, error: "no_instalada" }, { status: 404 });
  const shop = session.shop;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!(ip ? porIp(`${shop}:${ip}`) : porTienda(shop))) {
    return Response.json(
      { ok: false, error: "demasiadas_consultas" },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const texto = (v: unknown) =>
    typeof v === "string" ? v.slice(0, 200) : undefined;

  const tienda = await obtenerTienda(shop);
  const r = await validarTelefono({
    telefono: texto(body.telefono) ?? "",
    ajustes: tienda.ajustes,
    fuentes: fuentesPara(shop, tienda.ajustes),
    modoHuella: tienda.modoHuella,
    telefonoVerificado: false, // Se activa cuando esté la ruta de verificación por código.
    total: Math.max(0, Number(body.total) || 0),
    datos: {
      nombre: texto(body.nombre),
      producto: texto(body.producto),
      totalTexto: texto(body.totalTexto),
    },
  });

  if (r.publico.ok) {
    await registrarEvento(shop, "validacion", {
      accion: r.publico.accion,
      motivo: r.motivo,
      fuentes: r.fuentesUsadas,
      fallidas: r.fuentesFallidas,
    });
  }
  return Response.json(r.publico);
};
