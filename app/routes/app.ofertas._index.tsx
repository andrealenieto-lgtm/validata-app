import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  EmptyState,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import type { OfertaCantidad, Paquete } from "../lib/ofertas.ts";
import {
  eliminarOferta,
  eliminarPaquete,
  guardarOferta,
  guardarPaquete,
  listarOfertas,
  listarPaquetes,
  obtenerOferta,
  obtenerPaquete,
} from "../tienda.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [ofertas, paquetes] = await Promise.all([
    listarOfertas(session.shop),
    listarPaquetes(session.shop),
  ]);
  return { ofertas, paquetes };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");

  if (form.get("tipo") === "paquete") {
    const paquete = await obtenerPaquete(session.shop, id);
    if (!paquete) return { ok: false };
    if (intent === "eliminar") await eliminarPaquete(session.shop, id);
    else if (intent === "activar")
      await guardarPaquete(session.shop, id, {
        ...paquete,
        activo: !paquete.activo,
      });
    else if (intent === "duplicar")
      await guardarPaquete(session.shop, null, {
        ...paquete,
        nombre: `${paquete.nombre} (copia)`,
        activo: false,
      });
    return { ok: true };
  }

  const oferta = await obtenerOferta(session.shop, id);
  if (!oferta) return { ok: false };

  if (intent === "eliminar") await eliminarOferta(session.shop, id);
  else if (intent === "activar")
    await guardarOferta(session.shop, id, {
      ...oferta,
      activa: !oferta.activa,
    });
  else if (intent === "duplicar")
    await guardarOferta(session.shop, null, {
      ...oferta,
      nombre: `${oferta.nombre} (copia)`,
      activa: false,
    });
  return { ok: true };
};

function resumenPaquete(p: Paquete) {
  const d = p.descuento;
  const desc =
    d.tipo === "porcentaje"
      ? `−${d.valor}%`
      : d.tipo === "monto"
        ? `−${d.valor}`
        : `precio ${d.valor}`;
  return `${p.productos.length} productos · ${desc}`;
}

function resumenNiveles(o: OfertaCantidad) {
  return o.niveles
    .map((n) => {
      const d = n.descuento;
      if (!d.valor) return `${n.cantidad}`;
      return d.tipo === "porcentaje"
        ? `${n.cantidad} (−${d.valor}%)`
        : `${n.cantidad} (oferta)`;
    })
    .join(" · ");
}

export default function Ofertas() {
  const { ofertas, paquetes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const enviar = (intent: string, id: string, tipo = "oferta") =>
    fetcher.submit({ intent, id, tipo }, { method: "post" });

  return (
    <Page>
      <TitleBar title="Ofertas y paquetes">
        <button
          variant="primary"
          onClick={() => navigate("/app/ofertas/nueva")}
        >
          Crear oferta
        </button>
        <button onClick={() => navigate("/app/paquetes/nuevo")}>
          Crear paquete
        </button>
      </TitleBar>
      <BlockStack gap="400">
        <Text as="h2" variant="headingLg">
          Ofertas por cantidad
        </Text>
        {ofertas.length === 0 ? (
          <Card>
            <EmptyState
              heading="Crea tu primera oferta por cantidad"
              action={{ content: "Crear oferta", url: "/app/ofertas/nueva" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Muestra barras como “1 unidad · 2 unidades −20% · 3 unidades
                −30%” para que tus clientes compren más en cada pedido.
              </p>
            </EmptyState>
          </Card>
        ) : (
          ofertas.map((o) => (
            <Card key={o.id}>
              <InlineStack align="space-between" blockAlign="center" gap="400">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      {o.nombre}
                    </Text>
                    <Badge tone={o.activa ? "success" : undefined}>
                      {o.activa ? "Activa" : "Pausada"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {o.todosLosProductos
                      ? "Todos los productos"
                      : `${o.productoIds.length} producto${o.productoIds.length === 1 ? "" : "s"}`}{" "}
                    · Niveles: {resumenNiveles(o)}
                  </Text>
                </BlockStack>
                <ButtonGroup>
                  <Button url={`/app/ofertas/${o.id}`}>Editar</Button>
                  <Button onClick={() => enviar("activar", o.id)}>
                    {o.activa ? "Pausar" : "Activar"}
                  </Button>
                  <Button onClick={() => enviar("duplicar", o.id)}>
                    Duplicar
                  </Button>
                  <Button
                    tone="critical"
                    onClick={() => enviar("eliminar", o.id)}
                  >
                    Eliminar
                  </Button>
                </ButtonGroup>
              </InlineStack>
            </Card>
          ))
        )}
        <Text as="h2" variant="headingLg">
          Paquetes (combos)
        </Text>
        {paquetes.length === 0 ? (
          <Card>
            <EmptyState
              heading="Crea tu primer paquete"
              action={{ content: "Crear paquete", url: "/app/paquetes/nuevo" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Ofrece varios productos juntos con descuento (p. ej. limpiador +
                sérum −20%) para aumentar el valor de cada pedido.
              </p>
            </EmptyState>
          </Card>
        ) : (
          paquetes.map((p) => (
            <Card key={p.id}>
              <InlineStack align="space-between" blockAlign="center" gap="400">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      {p.nombre}
                    </Text>
                    <Badge tone={p.activo ? "success" : undefined}>
                      {p.activo ? "Activo" : "Pausado"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {resumenPaquete(p)}
                  </Text>
                </BlockStack>
                <ButtonGroup>
                  <Button url={`/app/paquetes/${p.id}`}>Editar</Button>
                  <Button onClick={() => enviar("activar", p.id, "paquete")}>
                    {p.activo ? "Pausar" : "Activar"}
                  </Button>
                  <Button onClick={() => enviar("duplicar", p.id, "paquete")}>
                    Duplicar
                  </Button>
                  <Button
                    tone="critical"
                    onClick={() => enviar("eliminar", p.id, "paquete")}
                  >
                    Eliminar
                  </Button>
                </ButtonGroup>
              </InlineStack>
            </Card>
          ))
        )}
        <Box paddingBlockEnd="400">
          <Text as="p" tone="subdued" alignment="center">
            Si un producto está en varias ofertas, se usa la específica del
            producto antes que una para todos los productos.
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
