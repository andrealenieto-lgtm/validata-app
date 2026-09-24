// Integraciones y mensajería: configuración de cada tienda (proveedor, plantillas, Google Sheets,
// autocompletado). Sin dependencias de Node: también la usa el panel en el navegador.
// El envío y los códigos de verificación están en envios.ts (solo servidor).

export type Evento =
  | "pedido_confirmado"
  | "carrito_abandonado"
  | "codigo_verificacion"
  | "pago_previo";
export const EVENTOS: Evento[] = [
  "pedido_confirmado",
  "pago_previo",
  "carrito_abandonado",
  "codigo_verificacion",
];

/** Por dónde salen los mensajes. La app no trae un número propio: cada tienda conecta el suyo. */
export type TipoProveedor = "ninguno" | "whatsapp_cloud" | "twilio" | "webhook";

export interface ProveedorMensajes {
  tipo: TipoProveedor;
  /** WhatsApp Business Cloud API (Meta). Los mensajes que inicia la tienda deben ser plantillas aprobadas. */
  whatsappCloud: { phoneNumberId: string; token: string; idioma: string };
  /** Twilio: SMS o WhatsApp por Twilio. */
  twilio: {
    accountSid: string;
    authToken: string;
    desde: string;
    canal: "sms" | "whatsapp";
  };
  /** Webhook: la app manda el mensaje ya armado a tu bot, Make, n8n o Zapier, y ellos lo envían. */
  webhook: { url: string; secreto: string };
}

export interface Plantilla {
  activa: boolean;
  texto: string;
  /** Nombre de la plantilla aprobada en Meta (solo WhatsApp Cloud). Sus {{1}}, {{2}}… son las variables del texto, en orden. */
  plantillaMeta: string;
}

export interface ConfigMensajeria {
  /** Nombre que va en {tienda}; se toma de Shopify al guardar. */
  nombreTienda: string;
  proveedor: ProveedorMensajes;
  plantillas: Record<Evento, Plantilla>;
  /** Pedir código por mensaje antes de crear un pedido contraentrega. */
  verificacion: { activa: boolean };
  carritoAbandonado: { minutosEspera: number };
  /** Google Sheets por Apps Script: la hoja publica una URL y la app le envía cada pedido. */
  googleSheets: { activo: boolean; url: string; columnas: string[] };
  autocompletadoGoogle: { activo: boolean; apiKey: string; paises: string[] };
}

export const VARIABLES: Record<Evento, string[]> = {
  pedido_confirmado: [
    "nombre",
    "pedido",
    "total",
    "producto",
    "direccion",
    "ciudad",
    "tienda",
  ],
  pago_previo: ["nombre", "pedido", "total", "enlace", "tienda"],
  carrito_abandonado: ["nombre", "producto", "enlace", "tienda"],
  codigo_verificacion: ["codigo", "tienda"],
};

export const COLUMNAS_SHEETS = [
  "fecha",
  "pedido",
  "nombre",
  "apellido",
  "telefono",
  "departamento",
  "ciudad",
  "direccion",
  "barrio",
  "producto",
  "cantidad",
  "total",
  "pago",
  "estado",
  "utm_source",
  "utm_campaign",
];

export const MENSAJERIA_POR_DEFECTO: ConfigMensajeria = {
  nombreTienda: "",
  proveedor: {
    tipo: "ninguno",
    whatsappCloud: { phoneNumberId: "", token: "", idioma: "es" },
    twilio: { accountSid: "", authToken: "", desde: "", canal: "sms" },
    webhook: { url: "", secreto: "" },
  },
  plantillas: {
    pedido_confirmado: {
      activa: true,
      texto:
        "Hola {nombre} 👋 Recibimos tu pedido {pedido} por {total}. Te avisaremos cuando salga.",
      plantillaMeta: "",
    },
    carrito_abandonado: {
      activa: false,
      texto:
        "Hola {nombre}, dejaste {producto} pendiente. Termina tu pedido aquí: {enlace}",
      plantillaMeta: "",
    },
    codigo_verificacion: {
      activa: true,
      texto:
        "Tu código de verificación de {tienda} es {codigo}. Vence en 10 minutos.",
      plantillaMeta: "",
    },
    pago_previo: {
      activa: true,
      texto:
        "Hola {nombre}, para despachar tu pedido completa el pago aquí: {enlace}",
      plantillaMeta: "",
    },
  },
  verificacion: { activa: false },
  carritoAbandonado: { minutosEspera: 30 },
  googleSheets: {
    activo: false,
    url: "",
    columnas: [
      "fecha",
      "pedido",
      "nombre",
      "apellido",
      "telefono",
      "departamento",
      "ciudad",
      "direccion",
      "producto",
      "total",
      "pago",
    ],
  },
  autocompletadoGoogle: { activo: false, apiKey: "", paises: ["CO"] },
};

/** Lo que se muestra en el panel en lugar de un secreto ya guardado. */
export const SECRETO_OCULTO = "••••••••";

const txt = (v: unknown, max = 500) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * URL a la que el servidor de la app puede llamar: solo https y nunca a la red interna,
 * para que nadie use la app como puente hacia servidores privados.
 */
export function urlPublicaSegura(valor: string): string {
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return "";
  }
  if (u.protocol !== "https:" || u.username || u.password) return "";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privada =
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    !h.includes(".") ||
    /^(0|10|127)\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    h.includes(":"); // IPv6 literal
  return privada ? "" : u.toString();
}

/**
 * Limpia lo que llega del panel. Un secreto vacío u oculto conserva el guardado, para que el
 * panel nunca tenga que recibir los tokens de vuelta.
 */
export function normalizarMensajeria(
  entrada: unknown,
  anterior: ConfigMensajeria = MENSAJERIA_POR_DEFECTO,
): ConfigMensajeria {
  const e = (entrada && typeof entrada === "object" ? entrada : {}) as Record<
    string,
    any
  >;
  const d = MENSAJERIA_POR_DEFECTO;
  const secreto = (nuevo: unknown, previo: string) => {
    const v = txt(nuevo, 1000);
    return !v || v === SECRETO_OCULTO ? previo : v;
  };
  const p = e.proveedor ?? {};
  const tipos: TipoProveedor[] = [
    "ninguno",
    "whatsapp_cloud",
    "twilio",
    "webhook",
  ];
  const plantillas = {} as Record<Evento, Plantilla>;
  for (const ev of EVENTOS) {
    const x = e.plantillas?.[ev] ?? {};
    plantillas[ev] = {
      activa:
        typeof x.activa === "boolean" ? x.activa : d.plantillas[ev].activa,
      texto: txt(x.texto, 1000) || d.plantillas[ev].texto,
      plantillaMeta: txt(x.plantillaMeta, 100).replace(/[^a-z0-9_]/g, ""),
    };
  }
  const columnas = Array.isArray(e.googleSheets?.columnas)
    ? [
        ...new Set(
          (e.googleSheets.columnas as unknown[]).filter(
            (c): c is string =>
              typeof c === "string" && COLUMNAS_SHEETS.includes(c),
          ),
        ),
      ]
    : d.googleSheets.columnas;
  const paises = Array.isArray(e.autocompletadoGoogle?.paises)
    ? (e.autocompletadoGoogle.paises as unknown[])
        .filter(
          (c): c is string => typeof c === "string" && /^[A-Z]{2}$/.test(c),
        )
        .slice(0, 5)
    : d.autocompletadoGoogle.paises;
  return {
    nombreTienda: txt(e.nombreTienda, 80),
    proveedor: {
      tipo: tipos.includes(p.tipo) ? p.tipo : "ninguno",
      whatsappCloud: {
        phoneNumberId: txt(p.whatsappCloud?.phoneNumberId, 40).replace(
          /\D/g,
          "",
        ),
        token: secreto(
          p.whatsappCloud?.token,
          anterior.proveedor.whatsappCloud.token,
        ),
        idioma: /^[a-z]{2}(_[A-Z]{2})?$/.test(txt(p.whatsappCloud?.idioma))
          ? txt(p.whatsappCloud?.idioma)
          : "es",
      },
      twilio: {
        accountSid: txt(p.twilio?.accountSid, 64).replace(/[^A-Za-z0-9]/g, ""),
        authToken: secreto(
          p.twilio?.authToken,
          anterior.proveedor.twilio.authToken,
        ),
        desde: txt(p.twilio?.desde, 20).replace(/[^\d+]/g, ""),
        canal: p.twilio?.canal === "whatsapp" ? "whatsapp" : "sms",
      },
      webhook: {
        url: urlPublicaSegura(txt(p.webhook?.url, 500)),
        secreto: secreto(
          p.webhook?.secreto,
          anterior.proveedor.webhook.secreto,
        ),
      },
    },
    plantillas,
    verificacion: { activa: !!e.verificacion?.activa },
    carritoAbandonado: {
      minutosEspera: Math.min(
        24 * 60,
        Math.max(
          10,
          Math.round(Number(e.carritoAbandonado?.minutosEspera) || 30),
        ),
      ),
    },
    googleSheets: {
      activo: !!e.googleSheets?.activo,
      url: urlPublicaSegura(txt(e.googleSheets?.url, 500)),
      columnas: columnas.length ? columnas : d.googleSheets.columnas,
    },
    autocompletadoGoogle: {
      activo: !!e.autocompletadoGoogle?.activo,
      apiKey: txt(e.autocompletadoGoogle?.apiKey, 100).replace(
        /[^A-Za-z0-9_-]/g,
        "",
      ),
      paises: paises.length ? paises : ["CO"],
    },
  };
}

/** Copia para el panel: los tokens se reemplazan por puntos (la clave de Google no es secreta: va en la tienda). */
export function ocultarSecretos(c: ConfigMensajeria): ConfigMensajeria {
  const o = (v: string) => (v ? SECRETO_OCULTO : "");
  return {
    ...c,
    proveedor: {
      ...c.proveedor,
      whatsappCloud: {
        ...c.proveedor.whatsappCloud,
        token: o(c.proveedor.whatsappCloud.token),
      },
      twilio: {
        ...c.proveedor.twilio,
        authToken: o(c.proveedor.twilio.authToken),
      },
      webhook: {
        ...c.proveedor.webhook,
        secreto: o(c.proveedor.webhook.secreto),
      },
    },
  };
}

/** Si el proveedor elegido tiene todo lo necesario para enviar. */
export function proveedorListo(p: ProveedorMensajes): boolean {
  switch (p.tipo) {
    case "whatsapp_cloud":
      return !!(p.whatsappCloud.phoneNumberId && p.whatsappCloud.token);
    case "twilio":
      return !!(p.twilio.accountSid && p.twilio.authToken && p.twilio.desde);
    case "webhook":
      return !!p.webhook.url;
    default:
      return false;
  }
}

/** Reemplaza {variable}; las que no vienen se quedan vacías para no enviar "{nombre}" al cliente. */
export function llenarPlantilla(
  texto: string,
  datos: Record<string, string | number | undefined>,
): string {
  return texto.replace(/\{(\w+)\}/g, (_, k: string) =>
    (datos[k] ?? "").toString(),
  );
}

// ─── Carrito abandonado ──────────────────────────────────────────────────────

export interface Borrador {
  telefono: string | null;
  actualizado: number;
  completado: boolean;
  recordatorioEnviado: boolean;
}

/** El cliente dejó teléfono, no terminó y ya pasó el tiempo de espera. Un solo recordatorio. */
export function debeRecordar(
  b: Borrador,
  minutosEspera: number,
  ahora = Date.now(),
): boolean {
  return (
    !!b.telefono &&
    !b.completado &&
    !b.recordatorioEnviado &&
    ahora - b.actualizado >= minutosEspera * 60_000
  );
}

// ─── Google Sheets ───────────────────────────────────────────────────────────

/**
 * Fila en el orden de columnas configurado. Neutraliza fórmulas (=, +, -, @) para que un
 * dato escrito por el cliente no se ejecute como fórmula en la hoja.
 */
export function filaSheets(
  columnas: string[],
  datos: Record<string, string | number | undefined>,
): string[] {
  return columnas.map((c) => {
    const v = (datos[c] ?? "").toString();
    return /^[=+\-@]/.test(v) ? `'${v}` : v;
  });
}

/** Código para pegar en Extensiones → Apps Script de la hoja. Escribe los encabezados la primera vez. */
export const SCRIPT_SHEETS = `function doPost(e) {
  var datos = JSON.parse(e.postData.contents);
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (hoja.getLastRow() === 0) hoja.appendRow(datos.columnas);
  hoja.appendRow(datos.fila);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`;
