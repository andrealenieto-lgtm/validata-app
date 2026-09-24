import { BlockStack, Card, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

/** Página de una sección cuya lógica ya existe en app/lib pero cuya pantalla aún no está hecha. */
export function Proximamente({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <Page>
      <TitleBar title={titulo} />
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {titulo}
          </Text>
          <Text as="p" tone="subdued">
            {descripcion}
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
