import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MENSAJERIA_POR_DEFECTO,
  SECRETO_OCULTO,
  debeRecordar,
  filaSheets,
  llenarPlantilla,
  normalizarMensajeria,
  ocultarSecretos,
  urlPublicaSegura,
} from "../app/lib/mensajeria.ts";
import {
  OTP_ESPERA_REENVIO_MS,
  OTP_MAX_INTENTOS,
  OTP_VIGENCIA_MS,
  crearOtp,
  solicitudMensaje,
  solicitudSheets,
  variablesDelTexto,
  verificarOtp,
  type OtpGuardado,
} from "../app/lib/envios.ts";

const SECRETO = "prueba";
const TEL = "+573001234567";

function nuevo(ahora = 0) {
  const r = crearOtp(TEL, SECRETO, ahora);
  if ("error" in r) throw new Error("no debería esperar");
  return r;
}

test("plantillas: variables faltantes quedan vacías", () => {
  assert.equal(
    llenarPlantilla("Hola {nombre}, pedido {pedido}", { nombre: "Ana" }),
    "Hola Ana, pedido ",
  );
});

test("OTP: código de 6 dígitos y solo se guarda el hash", () => {
  const { codigo, guardado } = nuevo();
  assert.match(codigo, /^\d{6}$/);
  assert.ok(!JSON.stringify(guardado).includes(codigo));
});

test("OTP: válido, inválido y vencido", () => {
  const { codigo, guardado } = nuevo(0);
  assert.equal(
    verificarOtp(guardado, codigo, SECRETO, 1000).resultado,
    "valido",
  );
  assert.equal(
    verificarOtp(
      guardado,
      codigo === "000000" ? "111111" : "000000",
      SECRETO,
      1000,
    ).resultado,
    "invalido",
  );
  assert.equal(
    verificarOtp(guardado, codigo, SECRETO, OTP_VIGENCIA_MS + 1).resultado,
    "vencido",
  );
  assert.equal(
    verificarOtp(guardado, codigo, "otro-secreto", 1000).resultado,
    "invalido",
  );
});

test("OTP: se bloquea tras los intentos máximos, aunque luego acierte", () => {
  const { codigo } = nuevo(0);
  let g: OtpGuardado = nuevo(0).guardado; // otro código distinto
  for (let i = 0; i < OTP_MAX_INTENTOS; i++)
    g = verificarOtp(g, "999999x", SECRETO, 1000).guardado;
  assert.equal(verificarOtp(g, codigo, SECRETO, 1000).resultado, "bloqueado");
});

test("OTP: no reenvía antes de un minuto", () => {
  const { guardado } = nuevo(0);
  assert.deepEqual(crearOtp(TEL, SECRETO, 30_000, guardado), {
    error: "espera",
  });
  assert.ok(
    "codigo" in crearOtp(TEL, SECRETO, OTP_ESPERA_REENVIO_MS, guardado),
  );
});

test("carrito abandonado: un solo recordatorio después de la espera", () => {
  const b = {
    telefono: TEL,
    actualizado: 0,
    completado: false,
    recordatorioEnviado: false,
  };
  assert.equal(debeRecordar(b, 30, 29 * 60_000), false);
  assert.equal(debeRecordar(b, 30, 30 * 60_000), true);
  assert.equal(
    debeRecordar({ ...b, recordatorioEnviado: true }, 30, 60 * 60_000),
    false,
  );
  assert.equal(debeRecordar({ ...b, telefono: null }, 30, 60 * 60_000), false);
});

test("Google Sheets: orden de columnas y fórmulas neutralizadas", () => {
  assert.deepEqual(
    filaSheets(["nombre", "telefono", "total"], {
      nombre: '=HYPERLINK("x")',
      telefono: "+57300",
      total: 99700,
    }),
    ['\'=HYPERLINK("x")', "'+57300", "99700"],
  );
});

const conProveedor = (proveedor: Record<string, unknown>) =>
  normalizarMensajeria({
    ...MENSAJERIA_POR_DEFECTO,
    proveedor: { ...MENSAJERIA_POR_DEFECTO.proveedor, ...proveedor },
  });

test("URL segura: solo https pública", () => {
  assert.equal(
    urlPublicaSegura("https://hook.make.com/abc"),
    "https://hook.make.com/abc",
  );
  for (const u of [
    "http://hook.make.com/abc",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://192.168.1.1/x",
    "https://169.254.169.254/latest",
    "https://[::1]/x",
    "https://intranet/x",
    "https://user:pw@hook.make.com/",
    "javascript:alert(1)",
  ])
    assert.equal(urlPublicaSegura(u), "", u);
});

test("normalizar: un secreto vacío u oculto conserva el guardado", () => {
  const guardado = conProveedor({
    tipo: "twilio",
    twilio: {
      accountSid: "AC1",
      authToken: "secreto1",
      desde: "+15550001",
      canal: "sms",
    },
  });
  const panel = ocultarSecretos(guardado);
  assert.equal(panel.proveedor.twilio.authToken, SECRETO_OCULTO);
  assert.equal(
    normalizarMensajeria(panel, guardado).proveedor.twilio.authToken,
    "secreto1",
  );
  const nuevo = {
    ...panel,
    proveedor: {
      ...panel.proveedor,
      twilio: { ...panel.proveedor.twilio, authToken: "otro" },
    },
  };
  assert.equal(
    normalizarMensajeria(nuevo, guardado).proveedor.twilio.authToken,
    "otro",
  );
});

test("normalizar: columnas y países desconocidos se descartan", () => {
  const c = normalizarMensajeria({
    googleSheets: {
      activo: true,
      url: "https://script.google.com/macros/s/x/exec",
      columnas: ["nombre", "=MAL()", "nombre", "total"],
    },
    autocompletadoGoogle: {
      activo: true,
      apiKey: "AIza<script>",
      paises: ["CO", "xx", "MX"],
    },
  });
  assert.deepEqual(c.googleSheets.columnas, ["nombre", "total"]);
  assert.equal(c.autocompletadoGoogle.apiKey, "AIzascript");
  assert.deepEqual(c.autocompletadoGoogle.paises, ["CO", "MX"]);
});

test("mensajes: nada sin proveedor, evento apagado o teléfono inválido", () => {
  assert.equal(
    solicitudMensaje(MENSAJERIA_POR_DEFECTO, "pedido_confirmado", TEL, {}),
    null,
  );
  const c = conProveedor({
    tipo: "webhook",
    webhook: { url: "https://hook.make.com/a", secreto: "" },
  });
  assert.equal(solicitudMensaje(c, "carrito_abandonado", TEL, {}), null); // apagado por defecto
  assert.equal(
    solicitudMensaje(c, "pedido_confirmado", "3001234567", {}),
    null,
  );
});

test("mensajes: webhook firmado con el mensaje armado", () => {
  const c = conProveedor({
    tipo: "webhook",
    webhook: { url: "https://hook.make.com/a", secreto: "s" },
  });
  const r = solicitudMensaje(
    c,
    "pedido_confirmado",
    TEL,
    { nombre: "Ana", pedido: "#1004", total: "$ 99.700" },
    0,
  )!;
  const cuerpo = JSON.parse(r.body);
  assert.equal(
    cuerpo.mensaje,
    "Hola Ana 👋 Recibimos tu pedido #1004 por $ 99.700. Te avisaremos cuando salga.",
  );
  assert.equal(cuerpo.telefono, TEL);
  assert.match(r.headers["X-Validata-Firma"], /^[0-9a-f]{64}$/);
});

test("mensajes: Twilio SMS y WhatsApp", () => {
  const base = { accountSid: "AC1", authToken: "tk", desde: "+15550001" };
  const sms = solicitudMensaje(
    conProveedor({ tipo: "twilio", twilio: { ...base, canal: "sms" } }),
    "codigo_verificacion",
    TEL,
    { codigo: "123456", tienda: "X" },
  )!;
  assert.equal(
    sms.url,
    "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json",
  );
  const q = new URLSearchParams(sms.body);
  assert.equal(q.get("To"), TEL);
  assert.equal(
    q.get("Body"),
    "Tu código de verificación de X es 123456. Vence en 10 minutos.",
  );
  assert.equal(
    sms.headers.Authorization,
    `Basic ${Buffer.from("AC1:tk").toString("base64")}`,
  );
  const wa = solicitudMensaje(
    conProveedor({ tipo: "twilio", twilio: { ...base, canal: "whatsapp" } }),
    "codigo_verificacion",
    TEL,
    { codigo: "1" },
  )!;
  assert.equal(new URLSearchParams(wa.body).get("From"), "whatsapp:+15550001");
});

test("mensajes: WhatsApp Cloud con plantilla aprobada manda las variables en orden", () => {
  const c = conProveedor({
    tipo: "whatsapp_cloud",
    whatsappCloud: { phoneNumberId: "123", token: "tk", idioma: "es" },
  });
  c.plantillas.pedido_confirmado.plantillaMeta = "pedido_recibido";
  const r = solicitudMensaje(c, "pedido_confirmado", TEL, {
    nombre: "Ana",
    pedido: "#1004",
  })!;
  const b = JSON.parse(r.body);
  assert.equal(r.url, "https://graph.facebook.com/v21.0/123/messages");
  assert.equal(b.to, "573001234567");
  assert.equal(b.template.name, "pedido_recibido");
  assert.deepEqual(
    b.template.components[0].parameters.map((x: { text: string }) => x.text),
    ["Ana", "#1004", "-"], // {nombre}, {pedido}, {total} vacío
  );
  assert.deepEqual(variablesDelTexto("{a} {b} {a}"), ["a", "b"]);
});

test("Google Sheets: petición con columnas y fila", () => {
  assert.equal(solicitudSheets(MENSAJERIA_POR_DEFECTO, {}), null);
  const c = normalizarMensajeria({
    googleSheets: {
      activo: true,
      url: "https://script.google.com/macros/s/x/exec",
      columnas: ["pedido", "total"],
    },
  });
  assert.deepEqual(
    JSON.parse(solicitudSheets(c, { pedido: "#1", total: 5 })!.body),
    { columnas: ["pedido", "total"], fila: ["#1", "5"] },
  );
});
