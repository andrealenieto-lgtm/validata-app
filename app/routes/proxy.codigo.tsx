// POST /apps/validata/codigo (App Proxy): envía el código de verificación al teléfono del
// cliente. El código se comprueba al crear el pedido (proxy.pedido).

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { limitador } from "../lib/reglas/validacion.ts";
import { normalizarTelefono } from "../lib/reglas/telefono.ts";
import {
  enviarCodigo,
  obtenerMensajeria,
  verificacionActiva,
} from "../mensajes.server";

// Cada mensaje cuesta: 5 códigos por IP cada 10 minutos (y uno por minuto por teléfono).
const porIp = limitador(5, 10 * 60 * 1000);
const porTienda = limitador(300, 10 * 60 * 1000);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session)
    return Response.json({ ok: false, error: "no_instalada" }, { status: 404 });
  const shop = session.shop;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!(ip ? porIp(`${shop}:${ip}`) : porTienda(shop)))
    return Response.json(
      { ok: false, error: "demasiadas_consultas" },
      { status: 429 },
    );

  if (!verificacionActiva(await obtenerMensajeria(shop)))
    return Response.json({ ok: true, requerido: false });

  const body = (await request.json().catch(() => ({}))) as {
    telefono?: unknown;
  };
  const telefono = normalizarTelefono(
    typeof body.telefono === "string" ? body.telefono.slice(0, 30) : "",
  );
  if (!telefono)
    return Response.json(
      { ok: false, error: "telefono_invalido" },
      { status: 400 },
    );

  const r = await enviarCodigo(shop, telefono);
  if (r === "espera") return Response.json({ ok: false, error: "espera" });
  // "sin_envio": el mensaje no salió; el cliente sigue sin código y queda registrado.
  return Response.json({ ok: true, requerido: r === "enviado" });
};
