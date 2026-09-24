// POST /apps/validata/borrador (App Proxy): el cliente dejó su teléfono en el formulario y no
// ha terminado. Si no termina, se le envía un recordatorio (carrito abandonado).

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { limitador } from "../lib/reglas/validacion.ts";
import { normalizarTelefono } from "../lib/reglas/telefono.ts";
import { proveedorListo } from "../lib/mensajeria.ts";
import { guardarBorrador, obtenerMensajeria } from "../mensajes.server";

const porIp = limitador(10, 10 * 60 * 1000);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ ok: false }, { status: 404 });
  const shop = session.shop;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip && !porIp(`${shop}:${ip}`))
    return Response.json({ ok: false }, { status: 429 });

  const cfg = await obtenerMensajeria(shop);
  if (
    !cfg.plantillas.carrito_abandonado.activa ||
    !proveedorListo(cfg.proveedor)
  )
    return Response.json({ ok: true });

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const t = (k: string, max: number) =>
    typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "";
  const telefono = normalizarTelefono(t("telefono", 30));
  if (!telefono) return Response.json({ ok: false }, { status: 400 });
  // Solo una ruta de la misma tienda: el enlace del recordatorio no puede apuntar a otro sitio.
  const ruta = t("ruta", 200);
  await guardarBorrador(shop, {
    telefono,
    nombre: t("nombre", 60),
    producto: t("producto", 120),
    ruta: /^\/[\w\-./%]*$/.test(ruta) && !ruta.startsWith("//") ? ruta : "/",
  });
  return Response.json({ ok: true });
};
