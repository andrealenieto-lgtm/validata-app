import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import type { Ajustes } from "../lib/reglas/ajustes.ts";
import {
  validarTelefono,
  type RespuestaValidacion,
} from "../lib/reglas/validacion.ts";
import {
  fuentesPara,
  guardarValidacion,
  obtenerTienda,
} from "../tienda.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = await obtenerTienda(session.shop);
  return {
    ajustes: t.ajustes,
    modoHuella: t.modoHuella,
    redConectada: !!process.env.RED_HISTORIAL_URL,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "probar") {
    const t = await obtenerTienda(session.shop);
    const r = await validarTelefono({
      telefono: String(form.get("telefono") ?? ""),
      ajustes: t.ajustes,
      fuentes: fuentesPara(session.shop, t.ajustes),
      modoHuella: t.modoHuella,
      // El comerciante ve siempre el detalle en el probador.
      telefonoVerificado: true,
      total: Number(form.get("total")) || 100000,
      datos: { nombre: "Cliente de prueba" },
    });
    return {
      prueba: r.publico,
      motivo: r.motivo,
      fuentes: r.fuentesUsadas,
      fallidas: r.fuentesFallidas,
    };
  }

  const ajustes = JSON.parse(
    String(form.get("ajustes") ?? "{}"),
  ) as Partial<Ajustes>;
  await guardarValidacion(
    session.shop,
    ajustes,
    String(form.get("modoHuella")),
  );
  return { guardado: true };
};

const MOTIVOS: Record<string, string> = {
  cliente_nuevo: "Sin historial: aplica la regla de cliente nuevo",
  devoluciones_seguidas: "Superó las devoluciones seguidas",
  devoluciones_sin_entrega: "Tiene devoluciones y ninguna entrega",
  tasa_whatsapp: "Superó el % de devolución para WhatsApp",
  tasa_cod: "Superó el % de devolución para contraentrega",
  historial_bueno: "Historial dentro de los límites",
  historial_insuficiente: "Pocos pedidos para juzgar por porcentaje",
};

const ACCIONES: Record<
  string,
  { texto: string; tono: "success" | "warning" | "critical" }
> = {
  contraentrega: { texto: "Contraentrega", tono: "success" },
  pago_previo: { texto: "Pago previo", tono: "warning" },
  whatsapp: { texto: "WhatsApp", tono: "critical" },
};

export default function Validacion() {
  const inicial = useLoaderData<typeof loader>();
  const [a, setA] = useState<Ajustes>(inicial.ajustes);
  const [modoHuella, setModoHuella] = useState<string>(inicial.modoHuella);
  const [telefono, setTelefono] = useState("");
  const guardar = useFetcher<typeof action>();
  const probar = useFetcher<typeof action>();

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const set = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) =>
    setA((x) => ({ ...x, [k]: v }));
  const guardando = guardar.state !== "idle";
  const prueba = probar.data && "prueba" in probar.data ? probar.data : null;

  return (
    <Page>
      <TitleBar title="Validación de clientes">
        <button
          variant="primary"
          disabled={guardando}
          onClick={() =>
            guardar.submit(
              { ajustes: JSON.stringify(a), modoHuella },
              { method: "post" },
            )
          }
        >
          Guardar
        </button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {guardar.data && "guardado" in guardar.data && (
              <Banner tone="success" title="Ajustes guardados" />
            )}
            {!inicial.redConectada && (
              <Banner
                tone="info"
                title="Validando solo con el historial de tu tienda"
              >
                La red de historial externa se activará cuando esté listo el
                convenio.
              </Banner>
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Cuándo se quita la contraentrega
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Pedidos mínimos para evaluar por porcentaje"
                      type="number"
                      value={String(a.minPedidos)}
                      onChange={(v) => set("minPedidos", num(v))}
                      helpText="Con menos pedidos terminados no se juzga por porcentaje."
                      autoComplete="off"
                    />
                    <TextField
                      label="Solo cuentan pedidos de los últimos"
                      type="number"
                      suffix="meses"
                      value={String(a.mesesAntiguedad)}
                      onChange={(v) => set("mesesAntiguedad", num(v))}
                      helpText="0 = todo el historial."
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="% de devolución que quita la contraentrega"
                      type="number"
                      suffix="%"
                      value={String(a.maxDevolucionCOD)}
                      onChange={(v) => set("maxDevolucionCOD", num(v))}
                      helpText="Por encima de este % se pide pago previo."
                      autoComplete="off"
                    />
                    <TextField
                      label="% de devolución que envía a WhatsApp"
                      type="number"
                      suffix="%"
                      value={String(a.maxDevolucionWhatsapp)}
                      onChange={(v) => set("maxDevolucionWhatsapp", num(v))}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Devoluciones seguidas que envían a WhatsApp"
                      type="number"
                      value={String(a.devolucionesSeguidas)}
                      onChange={(v) => set("devolucionesSeguidas", num(v))}
                      helpText="0 = desactivado."
                      autoComplete="off"
                    />
                    <TextField
                      label="Devoluciones sin ninguna entrega que piden pago previo"
                      type="number"
                      value={String(a.devolucionesSinEntrega)}
                      onChange={(v) => set("devolucionesSinEntrega", num(v))}
                      helpText="0 = desactivado."
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <Select
                    label="Cliente nuevo (sin historial)"
                    options={[
                      { label: "Contraentrega", value: "contraentrega" },
                      { label: "Pago previo", value: "pago_previo" },
                    ]}
                    value={a.clienteNuevo}
                    onChange={(v) =>
                      set("clienteNuevo", v as Ajustes["clienteNuevo"])
                    }
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Pago previo
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <Select
                      label="Tipo de abono"
                      options={[
                        { label: "Porcentaje del pedido", value: "porcentaje" },
                        { label: "Monto fijo", value: "monto" },
                      ]}
                      value={a.abono.tipo}
                      onChange={(v) =>
                        set("abono", {
                          ...a.abono,
                          tipo: v as Ajustes["abono"]["tipo"],
                        })
                      }
                    />
                    <TextField
                      label="Valor del abono"
                      type="number"
                      suffix={a.abono.tipo === "porcentaje" ? "%" : undefined}
                      value={String(a.abono.valor)}
                      onChange={(v) =>
                        set("abono", { ...a.abono, valor: num(v) })
                      }
                      helpText="El abono se acuerda por WhatsApp (la app no lo cobra). 0 = no ofrecerlo."
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Descuento por pagar todo por adelantado"
                    type="number"
                    suffix="%"
                    value={String(a.descuentoAnticipado)}
                    onChange={(v) => set("descuentoAnticipado", num(v))}
                    autoComplete="off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  WhatsApp
                </Text>
                <FormLayout>
                  <TextField
                    label="Número de WhatsApp de la tienda"
                    value={a.whatsapp.numero}
                    onChange={(v) =>
                      set("whatsapp", { ...a.whatsapp, numero: v })
                    }
                    placeholder="573001234567"
                    helpText="Con indicativo del país, sin + ni espacios."
                    autoComplete="off"
                  />
                  <TextField
                    label="Mensaje prellenado"
                    value={a.whatsapp.mensaje}
                    onChange={(v) =>
                      set("whatsapp", { ...a.whatsapp, mensaje: v })
                    }
                    helpText="Puedes usar {nombre}, {producto} y {total}."
                    multiline={2}
                    autoComplete="off"
                  />
                  <TextField
                    label="Mensaje cuando el cliente elige abonar"
                    value={a.whatsapp.mensajeAbono}
                    onChange={(v) =>
                      set("whatsapp", { ...a.whatsapp, mensajeAbono: v })
                    }
                    helpText="El abono se cierra por WhatsApp. Variables: {nombre}, {producto}, {cantidad}, {total}, {abono}, {saldo}, {telefono}, {direccion}, {ciudad}, {departamento}."
                    multiline={3}
                    autoComplete="off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Huella del cliente en el formulario
                </Text>
                <Select
                  label="Qué ve el cliente de su historial"
                  options={[
                    { label: "Solo el resultado", value: "oculta" },
                    { label: "Nivel (sin números)", value: "nivel" },
                    {
                      label: "Detalle, tras verificar su número con código",
                      value: "detalle_verificado",
                    },
                  ]}
                  value={modoHuella}
                  onChange={setModoHuella}
                  helpText="Los números de entregas y devoluciones solo se muestran después de verificar el teléfono, para que nadie consulte el historial de otra persona."
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Historial de la tienda
                </Text>
                <Text as="p" tone="subdued">
                  Importa tus pedidos de Dropi para validar con tu propio
                  historial.
                </Text>
                <InlineStack>
                  <Button url="/app/historial">Importar pedidos</Button>
                </InlineStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Probar un teléfono
                </Text>
                <Text as="p" tone="subdued">
                  Usa los ajustes guardados. Guarda antes de probar un cambio.
                </Text>
                <TextField
                  label="Teléfono"
                  value={telefono}
                  onChange={setTelefono}
                  placeholder="300 123 4567"
                  autoComplete="off"
                />
                <Button
                  loading={probar.state !== "idle"}
                  onClick={() =>
                    probar.submit(
                      { intent: "probar", telefono },
                      { method: "post" },
                    )
                  }
                >
                  Consultar
                </Button>
                {prueba && (
                  <ResultadoPrueba
                    r={prueba.prueba}
                    motivo={prueba.motivo}
                    fuentes={prueba.fuentes}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function ResultadoPrueba({
  r,
  motivo,
  fuentes,
}: {
  r: RespuestaValidacion;
  motivo: string | null;
  fuentes: string[];
}) {
  if (!r.ok)
    return <Banner tone="critical" title="Número de teléfono inválido" />;
  const accion = ACCIONES[r.accion];
  return (
    <Box paddingBlockStart="200">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center">
          <Badge tone={accion.tono}>{accion.texto}</Badge>
          <Text as="span" variant="bodySm" tone="subdued">
            {r.telefono}
          </Text>
        </InlineStack>
        {motivo && <Text as="p">{MOTIVOS[motivo] ?? motivo}</Text>}
        {r.huella?.detalle && (
          <Text as="p">
            {r.huella.detalle.pedidos} pedidos · {r.huella.detalle.entregas}{" "}
            entregas · {r.huella.detalle.devoluciones} devoluciones ·{" "}
            {r.huella.detalle.efectividad}% efectividad
          </Text>
        )}
        <Text as="p" variant="bodySm" tone="subdued">
          Fuentes: {fuentes.length ? fuentes.join(", ") : "sin historial"}
        </Text>
      </BlockStack>
    </Box>
  );
}
