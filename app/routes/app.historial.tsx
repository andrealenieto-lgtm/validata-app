import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  DropZone,
  InlineGrid,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { ErrorImportacion, importarHistorial } from "../lib/importar.ts";
import {
  guardarHistorial,
  obtenerTienda,
  resumenHistorial,
} from "../tienda.server";

const MAX_MB = 20;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return resumenHistorial(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const archivo = (await request.formData()).get("archivo");
  if (!(archivo instanceof File))
    return { error: "Selecciona un archivo CSV." };
  if (archivo.size > MAX_MB * 1024 * 1024)
    return { error: `El archivo supera ${MAX_MB} MB.` };

  try {
    const { ajustes } = await obtenerTienda(session.shop);
    const r = importarHistorial(await archivo.text(), ajustes.indicativoPais);
    await guardarHistorial(session.shop, r.filas);
    const { filas, ...resumen } = r;
    return { ok: true as const, importadas: filas.length, ...resumen };
  } catch (e) {
    if (e instanceof ErrorImportacion) return { error: e.message };
    throw e;
  }
};

export default function Historial() {
  const resumen = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [archivo, setArchivo] = useState<File | null>(null);
  const r = fetcher.data;

  const subir = () => {
    if (!archivo) return;
    const fd = new FormData();
    fd.append("archivo", archivo);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <Page backAction={{ content: "Validación", url: "/app/validacion" }}>
      <TitleBar title="Historial de pedidos" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Importar pedidos
                </Text>
                <Text as="p">
                  Sube el export de pedidos de Dropi (o de otra plataforma) en
                  formato CSV. Se usan las columnas de teléfono, estado, fecha y
                  número de orden; el resto se ignora. Si subes un archivo más
                  reciente, los pedidos que ya estaban se actualizan con su
                  nuevo estado.
                </Text>
                <DropZone
                  accept=".csv,text/csv"
                  allowMultiple={false}
                  onDrop={(_todos, aceptados) =>
                    setArchivo(aceptados[0] ?? null)
                  }
                >
                  {archivo ? (
                    <BlockStack gap="100" inlineAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {archivo.name}
                      </Text>
                      <Text as="p" tone="subdued">
                        {(archivo.size / 1024 / 1024).toFixed(1)} MB
                      </Text>
                    </BlockStack>
                  ) : (
                    <DropZone.FileUpload
                      actionHint={`Archivo .csv de hasta ${MAX_MB} MB`}
                    />
                  )}
                </DropZone>
                <Button
                  variant="primary"
                  disabled={!archivo}
                  loading={fetcher.state !== "idle"}
                  onClick={subir}
                >
                  Importar
                </Button>
                <Text as="p" tone="subdued" variant="bodySm">
                  Si tu export es Excel (.xlsx), ábrelo y usa Archivo → Guardar
                  como → CSV UTF-8.
                </Text>
              </BlockStack>
            </Card>

            {r && "error" in r && <Banner tone="critical" title={r.error} />}
            {r && "ok" in r && (
              <Banner
                tone="success"
                title={`Se importaron ${r.importadas.toLocaleString("es-CO")} pedidos`}
              >
                <List>
                  <List.Item>
                    Columnas usadas: teléfono «{r.columnas.telefono}», estado «
                    {r.columnas.estado}»
                    {r.columnas.fecha && <>, fecha «{r.columnas.fecha}»</>}
                    {r.columnas.referencia && (
                      <>, orden «{r.columnas.referencia}»</>
                    )}
                  </List.Item>
                  <List.Item>
                    {r.entregados} entregados · {r.devueltos} devueltos o
                    rechazados · {r.otros} en otro estado
                  </List.Item>
                  {r.sinTelefono + r.sinEstado > 0 && (
                    <List.Item>
                      Se omitieron {r.sinTelefono} filas sin teléfono válido y{" "}
                      {r.sinEstado} sin estado.
                    </List.Item>
                  )}
                </List>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Historial actual
              </Text>
              <InlineGrid columns={2} gap="300">
                <Dato titulo="Pedidos" valor={resumen.pedidos} />
                <Dato titulo="Teléfonos" valor={resumen.telefonos} />
                <Dato titulo="Entregados" valor={resumen.entregados} />
                <Dato titulo="Devueltos" valor={resumen.devueltos} />
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <BlockStack gap="050">
      <Text as="p" tone="subdued" variant="bodySm">
        {titulo}
      </Text>
      <Text as="p" variant="headingLg">
        {valor.toLocaleString("es-CO")}
      </Text>
    </BlockStack>
  );
}
