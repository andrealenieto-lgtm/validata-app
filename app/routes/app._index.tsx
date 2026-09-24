import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [historial, validaciones] = await Promise.all([
    prisma.historialPedido.count({ where: { shop: session.shop } }),
    prisma.evento.count({ where: { shop: session.shop, tipo: "validacion" } }),
  ]);
  return { historial, validaciones, redConectada: !!process.env.RED_HISTORIAL_URL };
};

export default function Inicio() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page>
      <TitleBar title="Validata" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingLg">
                Contraentrega solo para clientes que reciben
              </Text>
              <Text as="p">
                Validata revisa el historial de entregas y devoluciones de cada teléfono antes de aceptar un
                pedido contraentrega. Los clientes con muchas devoluciones pagan por adelantado o confirman
                por WhatsApp, y tú dejas de pagar fletes y CPA por pedidos que no se entregan.
              </Text>
              <InlineStack>
                <Button variant="primary" url="/app/validacion">
                  Configurar la validación
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Estado
              </Text>
              <InlineStack gap="200">
                <Text as="span">Red de historial</Text>
                <Badge tone={d.redConectada ? "success" : "attention"}>
                  {d.redConectada ? "Conectada" : "Pendiente"}
                </Badge>
              </InlineStack>
              <Text as="p">Pedidos en el historial de la tienda: {d.historial}</Text>
              <Text as="p">Teléfonos validados: {d.validaciones}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
