// Envío de mensajes y códigos de verificación (solo servidor: usa node:crypto).

import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  filaSheets,
  llenarPlantilla,
  proveedorListo,
  type ConfigMensajeria,
  type Evento,
} from "./mensajeria.ts";

// ─── Código de verificación (OTP) ────────────────────────────────────────────

export const OTP_VIGENCIA_MS = 10 * 60 * 1000;
export const OTP_MAX_INTENTOS = 5;
/** Mínimo entre envíos al mismo número, para que nadie use el formulario para hacer spam. */
export const OTP_ESPERA_REENVIO_MS = 60 * 1000;

export interface OtpGuardado {
  telefono: string;
  /** Solo se guarda el hash, nunca el código. */
  hash: string;
  creado: number;
  intentos: number;
}

const hashCodigo = (telefono: string, codigo: string, secreto: string) =>
  createHash("sha256").update(`${secreto}:${telefono}:${codigo}`).digest("hex");

export function crearOtp(
  telefono: string,
  secreto: string,
  ahora = Date.now(),
  anterior?: OtpGuardado | null,
): { codigo: string; guardado: OtpGuardado } | { error: "espera" } {
  if (anterior && ahora - anterior.creado < OTP_ESPERA_REENVIO_MS)
    return { error: "espera" };
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return {
    codigo,
    guardado: {
      telefono,
      hash: hashCodigo(telefono, codigo, secreto),
      creado: ahora,
      intentos: 0,
    },
  };
}

export type ResultadoOtp = "valido" | "invalido" | "vencido" | "bloqueado";

/** Devuelve el resultado y el registro actualizado (con el intento sumado) para guardarlo. */
export function verificarOtp(
  guardado: OtpGuardado,
  codigo: string,
  secreto: string,
  ahora = Date.now(),
): { resultado: ResultadoOtp; guardado: OtpGuardado } {
  if (guardado.intentos >= OTP_MAX_INTENTOS)
    return { resultado: "bloqueado", guardado };
  if (ahora - guardado.creado > OTP_VIGENCIA_MS)
    return { resultado: "vencido", guardado };

  const actualizado = { ...guardado, intentos: guardado.intentos + 1 };
  const a = Buffer.from(hashCodigo(guardado.telefono, codigo.trim(), secreto));
  const b = Buffer.from(guardado.hash);
  return {
    resultado:
      a.length === b.length && timingSafeEqual(a, b) ? "valido" : "invalido",
    guardado: actualizado,
  };
}

// ─── Envío ───────────────────────────────────────────────────────────────────

export interface Solicitud {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Variables que aparecen en el texto, en orden y sin repetir: son los {{1}}, {{2}}… de la plantilla de Meta. */
export function variablesDelTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/**
 * Arma la petición HTTP para enviar un mensaje con el proveedor configurado, o null si ese
 * evento está apagado o falta configuración. No envía nada: así se puede probar sin red.
 */
export function solicitudMensaje(
  c: ConfigMensajeria,
  evento: Evento,
  telefono: string,
  datos: Record<string, string | number | undefined>,
  ahora = Date.now(),
): Solicitud | null {
  const plantilla = c.plantillas[evento];
  if (
    !plantilla?.activa ||
    !proveedorListo(c.proveedor) ||
    !/^\+\d{8,15}$/.test(telefono)
  )
    return null;
  const mensaje = llenarPlantilla(plantilla.texto, datos);
  const p = c.proveedor;

  if (p.tipo === "whatsapp_cloud") {
    const w = p.whatsappCloud;
    // Fuera de una conversación abierta, WhatsApp solo deja enviar plantillas aprobadas.
    const cuerpo = plantilla.plantillaMeta
      ? {
          messaging_product: "whatsapp",
          to: telefono.slice(1),
          type: "template",
          template: {
            name: plantilla.plantillaMeta,
            language: { code: w.idioma },
            components: [
              {
                type: "body",
                parameters: variablesDelTexto(plantilla.texto).map((k) => ({
                  type: "text",
                  text: String(datos[k] ?? "-") || "-",
                })),
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: telefono.slice(1),
          type: "text",
          text: { body: mensaje },
        };
    return {
      url: `https://graph.facebook.com/v21.0/${w.phoneNumberId}/messages`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${w.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    };
  }

  if (p.tipo === "twilio") {
    const t = p.twilio;
    const pre = t.canal === "whatsapp" ? "whatsapp:" : "";
    return {
      url: `https://api.twilio.com/2010-04-01/Accounts/${t.accountSid}/Messages.json`,
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: pre + telefono,
        From: pre + t.desde,
        Body: mensaje,
      }).toString(),
    };
  }

  // Webhook: firmado con HMAC para que el receptor sepa que viene de la app.
  const body = JSON.stringify({
    evento,
    telefono,
    mensaje,
    datos,
    enviado: new Date(ahora).toISOString(),
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (p.webhook.secreto) {
    headers["X-Validata-Firma"] = createHmac("sha256", p.webhook.secreto)
      .update(body)
      .digest("hex");
  }
  return { url: p.webhook.url, method: "POST", headers, body };
}

/** Petición a la hoja de Google (Apps Script). */
export function solicitudSheets(
  c: ConfigMensajeria,
  datos: Record<string, string | number | undefined>,
): Solicitud | null {
  const g = c.googleSheets;
  if (!g.activo || !g.url) return null;
  return {
    url: g.url,
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script no necesita preflight así
    body: JSON.stringify({
      columnas: g.columnas,
      fila: filaSheets(g.columnas, datos),
    }),
  };
}
