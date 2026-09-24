import { useEffect, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Divider,
  FormLayout,
  Icon,
  InlineStack,
  Link,
  List,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { ChatIcon, DataTableIcon, LocationIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  COLUMNAS_SHEETS,
  EVENTOS,
  SCRIPT_SHEETS,
  VARIABLES,
  normalizarMensajeria,
  ocultarSecretos,
  proveedorListo,
  type ConfigMensajeria,
  type Evento,
  type TipoProveedor,
} from "../lib/mensajeria.ts";
import { normalizarTelefono } from "../lib/reglas/telefono.ts";
import {
  enviarASheets,
  enviarMensaje,
  guardarMensajeria,
  obtenerMensajeria,
} from "../mensajes.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Los tokens nunca viajan al navegador: el panel recibe puntos en su lugar.
  return { cfg: ocultarSecretos(await obtenerMensajeria(session.shop)) };
};

type Respuesta = {
  intent: string;
  ok: boolean;
  mensaje?: string;
  cfg?: ConfigMensajeria;
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<Respuesta> => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  let entrada: Record<string, unknown> = {};
  try {
    entrada = JSON.parse(String(form.get("cfg") ?? "{}"));
  } catch {
    return { intent: "error", ok: false, mensaje: "Configuración inválida" };
  }
  const intent = String(form.get("intent"));

  if (intent === "guardar") {
    const r = await admin.graphql(`#graphql
      query tienda { shop { name } }`);
    const nombre = (await r.json()).data?.shop?.name ?? "";
    const cfg = await guardarMensajeria(shop, {
      ...entrada,
      nombreTienda: nombre,
    });
    return { intent, ok: true, cfg: ocultarSecretos(cfg) };
  }

  // Las pruebas usan lo que está en pantalla (sin guardar), con los secretos ya guardados.
  const cfg = normalizarMensajeria(entrada, await obtenerMensajeria(shop));
  if (intent === "probar_mensaje") {
    const telefono = normalizarTelefono(String(form.get("telefono") ?? ""));
    if (!telefono)
      return {
        intent,
        ok: false,
        mensaje: "Escribe un número de celular válido.",
      };
    const plantilla = cfg.plantillas.pedido_confirmado;
    const r = await enviarMensaje(
      shop,
      "pedido_confirmado",
      telefono,
      {
        nombre: "Prueba",
        pedido: "#1000",
        total: "$ 99.700",
        producto: "Producto de prueba",
      },
      {
        ...cfg,
        plantillas: {
          ...cfg.plantillas,
          pedido_confirmado: { ...plantilla, activa: true },
        },
      },
    );
    return {
      intent,
      ok: r.ok,
      mensaje: r.ok
        ? `Mensaje enviado a ${telefono}.`
        : `No se pudo enviar (${r.estado || "sin respuesta"}): ${r.detalle || "revisa los datos del proveedor"}`,
    };
  }
  if (intent === "probar_sheets") {
    const r = await enviarASheets(
      shop,
      {
        fecha: new Date().toLocaleString("es-CO", {
          timeZone: "America/Bogota",
        }),
        pedido: "#PRUEBA",
        nombre: "Prueba",
        apellido: "Validata",
        telefono: "+573001234567",
        departamento: "CUNDINAMARCA",
        ciudad: "BOGOTA",
        direccion: "Cl 13 # 20-35",
        barrio: "Centro",
        producto: "Producto de prueba",
        cantidad: 1,
        total: "$ 99.700",
        pago: "contraentrega",
        estado: "prueba",
      },
      { ...cfg, googleSheets: { ...cfg.googleSheets, activo: true } },
    );
    return {
      intent,
      ok: r.ok,
      mensaje: r.ok
        ? "Fila de prueba enviada. Revisa tu hoja."
        : `La hoja no respondió bien (${r.estado || "sin respuesta"}). Revisa la URL y que el acceso sea «Cualquier usuario».`,
    };
  }
  return { intent, ok: false, mensaje: "Acción desconocida" };
};

const NOMBRES_EVENTO: Record<Evento, { titulo: string; ayuda: string }> = {
  pedido_confirmado: {
    titulo: "Confirmación de pedido",
    ayuda: "Se envía cuando se crea un pedido contraentrega.",
  },
  pago_previo: {
    titulo: "Enlace de pago previo",
    ayuda:
      "Se envía cuando el cliente elige pago anticipado, con el enlace para pagar.",
  },
  carrito_abandonado: {
    titulo: "Carrito abandonado",
    ayuda:
      "Un solo recordatorio al cliente que dejó su celular y no terminó. No se envía a quien fue redirigido a WhatsApp.",
  },
  codigo_verificacion: {
    titulo: "Código de verificación",
    ayuda: "Se usa cuando está activa la verificación del número.",
  },
};

const PAISES = [
  { label: "Colombia", value: "CO" },
  { label: "México", value: "MX" },
  { label: "Ecuador", value: "EC" },
  { label: "Perú", value: "PE" },
  { label: "Chile", value: "CL" },
  { label: "Guatemala", value: "GT" },
  { label: "Panamá", value: "PA" },
];

type Seccion = "mensajes" | "sheets" | "autocompletado";
type Proveedor = ConfigMensajeria["proveedor"];

export default function Integraciones() {
  const inicial = useLoaderData<typeof loader>();
  const [cfg, setCfg] = useState<ConfigMensajeria>(inicial.cfg);
  const [guardadoJson, setGuardadoJson] = useState(() =>
    JSON.stringify(inicial.cfg),
  );
  const [abierta, setAbierta] = useState<Seccion | null>(null);
  const [telPrueba, setTelPrueba] = useState("");
  const guardar = useFetcher<typeof action>();
  const prueba = useFetcher<typeof action>();

  useEffect(() => {
    const d = guardar.data;
    if (d?.intent === "guardar" && d.cfg) {
      setCfg(d.cfg);
      setGuardadoJson(JSON.stringify(d.cfg));
    }
  }, [guardar.data]);
  const sinGuardar = JSON.stringify(cfg) !== guardadoJson;
  const enviarGuardar = () =>
    guardar.submit(
      { intent: "guardar", cfg: JSON.stringify(cfg) },
      { method: "post" },
    );

  const p = cfg.proveedor;
  const listo = proveedorListo(p);
  const cambiar = (c: Partial<ConfigMensajeria>) =>
    setCfg((x) => ({ ...x, ...c }));
  function cambiarProveedor<K extends Exclude<keyof Proveedor, "tipo">>(
    k: K,
    v: Partial<Proveedor[K]>,
  ) {
    setCfg((x) => ({
      ...x,
      proveedor: { ...x.proveedor, [k]: { ...x.proveedor[k], ...v } },
    }));
  }
  const cambiarPlantilla = (
    ev: Evento,
    c: Partial<ConfigMensajeria["plantillas"][Evento]>,
  ) =>
    setCfg((x) => ({
      ...x,
      plantillas: { ...x.plantillas, [ev]: { ...x.plantillas[ev], ...c } },
    }));
  const probar = (intent: string, extra: Record<string, string> = {}) =>
    prueba.submit(
      { intent, cfg: JSON.stringify(cfg), ...extra },
      { method: "post" },
    );
  const probando = (intent: string) =>
    prueba.state !== "idle" && prueba.formData?.get("intent") === intent;
  const resultado = (intent: string) =>
    prueba.state === "idle" && prueba.data?.intent === intent ? (
      <Banner tone={prueba.data.ok ? "success" : "critical"}>
        {prueba.data.mensaje}
      </Banner>
    ) : null;

  const tarjeta = (
    seccion: Seccion,
    icono: typeof ChatIcon,
    titulo: string,
    descripcion: string,
    estado: { activo: boolean; texto: string },
    contenido: ReactNode,
  ) => (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Box>
            <Icon source={icono} />
          </Box>
          <Text as="h2" variant="headingMd">
            {titulo}
          </Text>
          <Badge tone={estado.activo ? "success" : undefined}>
            {estado.texto}
          </Badge>
        </InlineStack>
        <Text as="p" tone="subdued">
          {descripcion}
        </Text>
        <InlineStack>
          <Button
            variant={abierta === seccion ? "secondary" : "primary"}
            onClick={() => setAbierta(abierta === seccion ? null : seccion)}
          >
            {abierta === seccion ? "Cerrar" : "Configurar"}
          </Button>
        </InlineStack>
        {abierta === seccion && (
          <>
            <Divider />
            {contenido}
          </>
        )}
      </BlockStack>
    </Card>
  );

  const nombreProveedor: Record<TipoProveedor, string> = {
    ninguno: "Sin conectar",
    whatsapp_cloud: "WhatsApp Cloud API",
    twilio: p.twilio.canal === "whatsapp" ? "Twilio WhatsApp" : "Twilio SMS",
    webhook: "Webhook",
  };

  const editorMensajes = (
    <BlockStack gap="500">
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          1. ¿Por dónde salen los mensajes?
        </Text>
        <Select
          label="Proveedor"
          options={[
            { label: "Sin conectar", value: "ninguno" },
            {
              label: "WhatsApp Business (Cloud API de Meta)",
              value: "whatsapp_cloud",
            },
            { label: "Twilio (SMS o WhatsApp)", value: "twilio" },
            { label: "Webhook (tu bot, Make, n8n o Zapier)", value: "webhook" },
          ]}
          value={p.tipo}
          onChange={(v) =>
            setCfg((x) => ({
              ...x,
              proveedor: { ...x.proveedor, tipo: v as TipoProveedor },
            }))
          }
        />
        {p.tipo === "whatsapp_cloud" && (
          <>
            <Banner tone="info">
              <p>
                En Meta for Developers → tu app → WhatsApp → Configuración de la
                API copia el identificador del número y un token permanente (de
                un usuario del sistema). WhatsApp solo deja iniciar
                conversaciones con plantillas aprobadas: crea cada plantilla en
                el administrador de WhatsApp y escribe su nombre abajo. Las
                variables del texto ({"{nombre}"}, {"{pedido}"}…) se envían en
                orden como {"{{1}}"}, {"{{2}}"}…
              </p>
            </Banner>
            <FormLayout>
              <FormLayout.Group>
                <TextField
                  label="Identificador del número de teléfono"
                  value={p.whatsappCloud.phoneNumberId}
                  onChange={(v) =>
                    cambiarProveedor("whatsappCloud", { phoneNumberId: v })
                  }
                  autoComplete="off"
                />
                <TextField
                  label="Idioma de las plantillas"
                  helpText="Ej: es, es_MX, es_CO"
                  value={p.whatsappCloud.idioma}
                  onChange={(v) =>
                    cambiarProveedor("whatsappCloud", { idioma: v })
                  }
                  autoComplete="off"
                />
              </FormLayout.Group>
              <TextField
                label="Token de acceso"
                type="password"
                value={p.whatsappCloud.token}
                onChange={(v) =>
                  cambiarProveedor("whatsappCloud", { token: v })
                }
                helpText="Se guarda en el servidor y no se vuelve a mostrar."
                autoComplete="off"
              />
            </FormLayout>
          </>
        )}
        {p.tipo === "twilio" && (
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Account SID"
                value={p.twilio.accountSid}
                onChange={(v) => cambiarProveedor("twilio", { accountSid: v })}
                autoComplete="off"
              />
              <TextField
                label="Auth token"
                type="password"
                value={p.twilio.authToken}
                onChange={(v) => cambiarProveedor("twilio", { authToken: v })}
                helpText="Se guarda en el servidor y no se vuelve a mostrar."
                autoComplete="off"
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Número que envía"
                placeholder="+15551234567"
                value={p.twilio.desde}
                onChange={(v) => cambiarProveedor("twilio", { desde: v })}
                autoComplete="off"
              />
              <Select
                label="Canal"
                options={[
                  { label: "SMS", value: "sms" },
                  { label: "WhatsApp", value: "whatsapp" },
                ]}
                value={p.twilio.canal}
                onChange={(v) =>
                  cambiarProveedor("twilio", {
                    canal: v as "sms" | "whatsapp",
                  })
                }
              />
            </FormLayout.Group>
          </FormLayout>
        )}
        {p.tipo === "webhook" && (
          <>
            <Text as="p" tone="subdued">
              La app envía un POST con {"{ evento, telefono, mensaje, datos }"}{" "}
              a esta URL y tu sistema lo reenvía por WhatsApp. Si pones un
              secreto, cada envío lleva la cabecera X-Validata-Firma
              (HMAC-SHA256 del cuerpo) para que compruebes que viene de la app.
            </Text>
            <FormLayout>
              <TextField
                label="URL del webhook"
                placeholder="https://hook.make.com/…"
                value={p.webhook.url}
                onChange={(v) => cambiarProveedor("webhook", { url: v })}
                helpText="Solo https y direcciones públicas."
                autoComplete="off"
              />
              <TextField
                label="Secreto para firmar (opcional)"
                type="password"
                value={p.webhook.secreto}
                onChange={(v) => cambiarProveedor("webhook", { secreto: v })}
                autoComplete="off"
              />
            </FormLayout>
          </>
        )}
        {p.tipo !== "ninguno" && (
          <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="end">
              <Box minWidth="220px">
                <TextField
                  label="Enviar mensaje de prueba a"
                  placeholder="3001234567"
                  value={telPrueba}
                  onChange={setTelPrueba}
                  autoComplete="off"
                />
              </Box>
              <Button
                disabled={!listo}
                loading={probando("probar_mensaje")}
                onClick={() =>
                  probar("probar_mensaje", { telefono: telPrueba })
                }
              >
                Enviar prueba
              </Button>
            </InlineStack>
            {resultado("probar_mensaje")}
          </BlockStack>
        )}
      </BlockStack>

      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          2. Mensajes
        </Text>
        {EVENTOS.map((ev) => {
          const pl = cfg.plantillas[ev];
          const forzado =
            ev === "codigo_verificacion" && cfg.verificacion.activa;
          return (
            <Box
              key={ev}
              padding="300"
              borderWidth="025"
              borderColor="border"
              borderRadius="200"
            >
              <BlockStack gap="200">
                <Checkbox
                  label={NOMBRES_EVENTO[ev].titulo}
                  helpText={NOMBRES_EVENTO[ev].ayuda}
                  checked={forzado || pl.activa}
                  disabled={forzado}
                  onChange={(v) => cambiarPlantilla(ev, { activa: v })}
                />
                <TextField
                  label="Texto"
                  labelHidden
                  multiline={2}
                  value={pl.texto}
                  onChange={(v) => cambiarPlantilla(ev, { texto: v })}
                  helpText={`Variables: ${VARIABLES[ev].map((x) => `{${x}}`).join(" ")}`}
                  autoComplete="off"
                />
                {p.tipo === "whatsapp_cloud" && (
                  <TextField
                    label="Nombre de la plantilla aprobada en Meta"
                    placeholder="pedido_recibido"
                    value={pl.plantillaMeta}
                    onChange={(v) => cambiarPlantilla(ev, { plantillaMeta: v })}
                    helpText="Sin plantilla, WhatsApp solo entrega el mensaje si el cliente te escribió en las últimas 24 horas."
                    autoComplete="off"
                  />
                )}
                {ev === "carrito_abandonado" && pl.activa && (
                  <Select
                    label="Enviar después de"
                    options={[
                      { label: "15 minutos", value: "15" },
                      { label: "30 minutos", value: "30" },
                      { label: "1 hora", value: "60" },
                      { label: "2 horas", value: "120" },
                      { label: "6 horas", value: "360" },
                    ]}
                    value={String(cfg.carritoAbandonado.minutosEspera)}
                    onChange={(v) =>
                      cambiar({
                        carritoAbandonado: { minutosEspera: Number(v) },
                      })
                    }
                  />
                )}
              </BlockStack>
            </Box>
          );
        })}
      </BlockStack>

      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          3. Verificación del número
        </Text>
        <Checkbox
          label="Pedir un código por mensaje antes de crear pedidos contraentrega"
          helpText="Frena números falsos y pedidos de broma. Si el proveedor no logra enviar el código, el cliente puede seguir igual (para no perder la venta) y queda registrado."
          checked={cfg.verificacion.activa}
          disabled={!listo}
          onChange={(v) => cambiar({ verificacion: { activa: v } })}
        />
        {!listo && (
          <Text as="p" tone="subdued" variant="bodySm">
            Conecta un proveedor para activarla.
          </Text>
        )}
      </BlockStack>
    </BlockStack>
  );

  const g = cfg.googleSheets;
  const editorSheets = (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          Cómo conectarla (una sola vez)
        </Text>
        <List type="number">
          <List.Item>
            Crea una hoja en{" "}
            <Link url="https://sheets.new" target="_blank">
              Google Sheets
            </Link>
            .
          </List.Item>
          <List.Item>
            En la hoja: Extensiones → Apps Script. Borra lo que haya y pega este
            código:
          </List.Item>
        </List>
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
            {SCRIPT_SHEETS}
          </pre>
        </Box>
        <InlineStack>
          <Button onClick={() => navigator.clipboard?.writeText(SCRIPT_SHEETS)}>
            Copiar código
          </Button>
        </InlineStack>
        <ol start={3} style={{ margin: 0, paddingInlineStart: 20 }}>
          <li>
            Implementar → Nueva implementación → tipo «Aplicación web». Ejecutar
            como: «Yo». Quién tiene acceso: «Cualquier usuario». Autoriza los
            permisos.
          </li>
          <li>
            Copia la URL de la aplicación web (termina en /exec) y pégala aquí:
          </li>
        </ol>
      </BlockStack>
      <FormLayout>
        <TextField
          label="URL de la aplicación web"
          placeholder="https://script.google.com/macros/s/…/exec"
          value={g.url}
          onChange={(v) => cambiar({ googleSheets: { ...g, url: v } })}
          autoComplete="off"
        />
        <Checkbox
          label="Enviar cada pedido a la hoja"
          checked={g.activo}
          onChange={(v) => cambiar({ googleSheets: { ...g, activo: v } })}
        />
        <ChoiceList
          title="Columnas (en este orden)"
          allowMultiple
          choices={COLUMNAS_SHEETS.map((c) => ({ label: c, value: c }))}
          selected={g.columnas}
          onChange={(v) =>
            cambiar({
              googleSheets: {
                ...g,
                columnas: COLUMNAS_SHEETS.filter((c) => v.includes(c)),
              },
            })
          }
        />
      </FormLayout>
      <Text as="p" tone="subdued" variant="bodySm">
        Van los pedidos contraentrega y los de pago anticipado (estado
        «esperando pago»). Los que se van a WhatsApp no, porque no son ventas.
      </Text>
      <InlineStack>
        <Button
          disabled={!g.url}
          loading={probando("probar_sheets")}
          onClick={() => probar("probar_sheets")}
        >
          Enviar fila de prueba
        </Button>
      </InlineStack>
      {resultado("probar_sheets")}
    </BlockStack>
  );

  const a = cfg.autocompletadoGoogle;
  const editorAutocompletado = (
    <BlockStack gap="400">
      <Banner tone="info">
        <p>
          En{" "}
          <Link
            url="https://console.cloud.google.com/google/maps-apis"
            target="_blank"
          >
            Google Cloud
          </Link>{" "}
          activa «Maps JavaScript API» y «Places API (New)», y crea una clave de
          API. Restríngela a «Sitios web» con el dominio de tu tienda (por
          ejemplo *.mitienda.com/*): la clave queda visible en la tienda, así
          que la restricción es lo que evita que otros la usen.
        </p>
      </Banner>
      <FormLayout>
        <TextField
          label="Clave de API de Google Maps"
          value={a.apiKey}
          onChange={(v) =>
            cambiar({ autocompletadoGoogle: { ...a, apiKey: v } })
          }
          autoComplete="off"
        />
        <Checkbox
          label="Sugerir direcciones mientras el cliente escribe"
          helpText="Al elegir una dirección se llenan también el departamento, la ciudad y el barrio cuando Google los tiene."
          checked={a.activo}
          disabled={!a.apiKey}
          onChange={(v) =>
            cambiar({ autocompletadoGoogle: { ...a, activo: v } })
          }
        />
        <ChoiceList
          title="Países"
          allowMultiple
          choices={PAISES}
          selected={a.paises}
          onChange={(v) =>
            cambiar({
              autocompletadoGoogle: { ...a, paises: v.length ? v : ["CO"] },
            })
          }
        />
      </FormLayout>
    </BlockStack>
  );

  return (
    <Page>
      <TitleBar title="Integraciones y mensajería">
        <button
          variant="primary"
          disabled={guardar.state !== "idle" || !sinGuardar}
          onClick={enviarGuardar}
        >
          Guardar
        </button>
      </TitleBar>
      <BlockStack gap="400">
        {sinGuardar ? (
          <Banner tone="warning" title="Tienes cambios sin guardar">
            <InlineStack>
              <Button
                loading={guardar.state !== "idle"}
                onClick={enviarGuardar}
              >
                Guardar
              </Button>
            </InlineStack>
          </Banner>
        ) : (
          guardar.data?.intent === "guardar" && (
            <Banner tone="success" title="Guardado." />
          )
        )}

        {tarjeta(
          "mensajes",
          ChatIcon,
          "Mensajes SMS y WhatsApp",
          "Envía confirmaciones de pedido, enlaces de pago, recordatorios de carrito abandonado y verifica el celular de tus clientes con un código.",
          {
            activo: listo,
            texto: listo ? nombreProveedor[p.tipo] : "Sin conectar",
          },
          editorMensajes,
        )}
        {tarjeta(
          "sheets",
          DataTableIcon,
          "Google Sheets",
          "Guarda cada pedido en una hoja de cálculo, con las columnas que elijas.",
          {
            activo: g.activo && !!g.url,
            texto: g.activo && g.url ? "Conectada" : "Sin conectar",
          },
          editorSheets,
        )}
        {tarjeta(
          "autocompletado",
          LocationIcon,
          "Autocompletado de direcciones de Google",
          "Sugiere direcciones mientras el cliente escribe para que lleguen completas y bien escritas.",
          {
            activo: a.activo && !!a.apiKey,
            texto: a.activo && a.apiKey ? "Activo" : "Inactivo",
          },
          editorAutocompletado,
        )}
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const mensaje = isRouteErrorResponse(error)
    ? `${error.status} ${error.data ?? error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <Page>
      <Banner
        tone="critical"
        title="No se pudo abrir Integraciones y mensajería"
      >
        <p>{mensaje}</p>
      </Banner>
    </Page>
  );
}
