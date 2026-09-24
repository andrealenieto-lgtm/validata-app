import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useNavigate,
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
  FormLayout,
  InlineGrid,
  InlineStack,
  Page,
  RadioButton,
  RangeSlider,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  normalizarOferta,
  type NivelCantidad,
  type OfertaCantidad,
  type TipoDescuento,
} from "../lib/ofertas.ts";
import { guardarOferta, obtenerOferta } from "../tienda.server";
import { archivosVistaPrevia } from "../vista-previa.server";
import { CampoColor } from "../components/CampoColor";
import {
  prepararVistaPrevia,
  type ArchivosVista,
} from "../components/vistaPrevia";

interface ProductoResumen {
  id: string; // numérico
  titulo: string;
  imagen: string | null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const nueva = params.id === "nueva";
  const oferta = nueva
    ? normalizarOferta({}, "nueva")
    : await obtenerOferta(session.shop, params.id!);
  if (!oferta) throw new Response("Oferta no encontrada", { status: 404 });

  // Títulos e imágenes de los productos elegidos, para mostrarlos en el editor.
  let productos: ProductoResumen[] = [];
  if (oferta.productoIds.length) {
    const r = await admin.graphql(
      `#graphql
      query productos($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Product { id title featuredMedia { preview { image { url } } } } }
      }`,
      {
        variables: {
          ids: oferta.productoIds.map((id) => `gid://shopify/Product/${id}`),
        },
      },
    );
    const nodos = ((await r.json()).data?.nodes ?? []) as {
      id?: string;
      title?: string;
      featuredMedia?: { preview?: { image?: { url?: string } } };
    }[];
    productos = nodos
      .filter((n) => n?.id)
      .map((n) => ({
        id: n.id!.replace(/\D/g, ""),
        titulo: n.title ?? "",
        imagen: n.featuredMedia?.preview?.image?.url ?? null,
      }));
  }
  return { oferta, nueva, productos, vista: await archivosVistaPrevia() };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  let entrada: unknown = null;
  try {
    entrada = JSON.parse(String(form.get("oferta") ?? "null"));
  } catch {
    return { error: "Oferta inválida" };
  }
  const oferta = await guardarOferta(
    session.shop,
    params.id === "nueva" ? null : params.id!,
    entrada,
  );
  return { oferta };
};

let contador = 0;
const idNivel = () => `n${Date.now().toString(36)}${contador++}`;

export default function EditorOferta() {
  const inicial = useLoaderData<typeof loader>();
  const [o, setO] = useState<OfertaCantidad>(inicial.oferta);
  const [productos, setProductos] = useState<ProductoResumen[]>(
    inicial.productos,
  );
  const [guardadoJson, setGuardadoJson] = useState(() =>
    JSON.stringify(inicial.oferta),
  );
  const guardar = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  useEffect(() => {
    const d = guardar.data;
    if (d && "oferta" in d && d.oferta) {
      setO(d.oferta);
      setGuardadoJson(JSON.stringify(d.oferta));
      // Recién creada: se pasa a la dirección con su id para que "Guardar" siga editándola.
      if (inicial.nueva)
        navigate(`/app/ofertas/${d.oferta.id}`, { replace: true });
    }
  }, [guardar.data, inicial.nueva, navigate]);

  const sinGuardar = inicial.nueva || JSON.stringify(o) !== guardadoJson;
  const set = <K extends keyof OfertaCantidad>(k: K, v: OfertaCantidad[K]) =>
    setO((x) => ({ ...x, [k]: v }));
  const diseno = <K extends keyof OfertaCantidad["diseno"]>(
    k: K,
    v: OfertaCantidad["diseno"][K],
  ) => setO((x) => ({ ...x, diseno: { ...x.diseno, [k]: v } }));
  const nivel = (id: string, cambio: Partial<NivelCantidad>) =>
    setO((x) => ({
      ...x,
      niveles: x.niveles.map((n) => (n.id === id ? { ...n, ...cambio } : n)),
    }));
  const porDefecto = (id: string) =>
    setO((x) => ({
      ...x,
      niveles: x.niveles.map((n) => ({ ...n, porDefecto: n.id === id })),
    }));

  async function elegirProductos() {
    const r = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: productos.map((p) => ({
        id: `gid://shopify/Product/${p.id}`,
      })),
    });
    if (!r) return;
    const elegidos = (
      r as unknown as {
        id: string;
        title: string;
        images?: { originalSrc?: string }[];
      }[]
    ).map((p) => ({
      id: p.id.replace(/\D/g, ""),
      titulo: p.title,
      imagen: p.images?.[0]?.originalSrc ?? null,
    }));
    setProductos(elegidos);
    set(
      "productoIds",
      elegidos.map((p) => p.id),
    );
  }

  const faltanProductos = !o.todosLosProductos && o.productoIds.length === 0;

  return (
    <Page fullWidth>
      <TitleBar title={inicial.nueva ? "Nueva oferta" : o.nombre}>
        <button
          variant="primary"
          disabled={guardar.state !== "idle" || faltanProductos}
          onClick={() =>
            guardar.submit({ oferta: JSON.stringify(o) }, { method: "post" })
          }
        >
          Guardar
        </button>
      </TitleBar>
      <InlineGrid columns={{ xs: 1, md: "3fr 2fr", lg: "2fr 1fr" }} gap="400">
        <BlockStack gap="400">
          {sinGuardar ? (
            <Banner tone="warning" title="Tienes cambios sin guardar">
              {faltanProductos
                ? "Elige los productos de la oferta (o márcala para todos los productos) para poder guardar."
                : "La vista previa ya los muestra; tu tienda cambiará cuando des clic en Guardar."}
            </Banner>
          ) : (
            guardar.data &&
            "oferta" in guardar.data && (
              <Banner
                tone="success"
                title="Oferta guardada. Ya se ve así en tu tienda."
              />
            )
          )}

          <Card>
            <FormLayout>
              <TextField
                label="Nombre de la oferta"
                value={o.nombre}
                onChange={(v) => set("nombre", v)}
                autoComplete="off"
              />
              <Checkbox
                label="Oferta activa"
                checked={o.activa}
                onChange={(v) => set("activa", v)}
              />
            </FormLayout>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Productos
              </Text>
              <ChoiceList
                title="Productos"
                titleHidden
                choices={[
                  { label: "Productos específicos", value: "especificos" },
                  { label: "Todos los productos", value: "todos" },
                ]}
                selected={[o.todosLosProductos ? "todos" : "especificos"]}
                onChange={([v]) => set("todosLosProductos", v === "todos")}
              />
              {!o.todosLosProductos && (
                <BlockStack gap="200">
                  <InlineStack>
                    <Button onClick={elegirProductos}>
                      {productos.length
                        ? "Cambiar productos"
                        : "Seleccionar productos"}
                    </Button>
                  </InlineStack>
                  {productos.map((p) => (
                    <InlineStack
                      key={p.id}
                      gap="300"
                      blockAlign="center"
                      align="space-between"
                    >
                      <InlineStack gap="300" blockAlign="center">
                        <Thumbnail
                          source={p.imagen ?? ""}
                          alt=""
                          size="small"
                        />
                        <Text as="span">{p.titulo}</Text>
                      </InlineStack>
                      <Button
                        variant="plain"
                        tone="critical"
                        onClick={() => {
                          setProductos((x) => x.filter((y) => y.id !== p.id));
                          set(
                            "productoIds",
                            o.productoIds.filter((id) => id !== p.id),
                          );
                        }}
                      >
                        Quitar
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Niveles
              </Text>
              <Text as="p" tone="subdued">
                En el subtítulo puedes escribir {"{descuento}"} para mostrar el
                % que ahorra (p. ej. “Ahorra {"{descuento}"}”).
              </Text>
              {o.niveles.map((n) => (
                <Box
                  key={n.id}
                  padding="300"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {n.titulo || `${n.cantidad} unidades`}
                        </Text>
                        {n.etiqueta && (
                          <Badge tone="success">{n.etiqueta}</Badge>
                        )}
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="center">
                        <RadioButton
                          label="Elegido por defecto"
                          checked={n.porDefecto}
                          id={`defecto-${n.id}`}
                          name="porDefecto"
                          onChange={() => porDefecto(n.id)}
                        />
                        <Button
                          variant="plain"
                          tone="critical"
                          disabled={o.niveles.length <= 1}
                          onClick={() =>
                            set(
                              "niveles",
                              o.niveles.filter((x) => x.id !== n.id),
                            )
                          }
                        >
                          Eliminar
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    <FormLayout>
                      <FormLayout.Group condensed>
                        <TextField
                          label="Cantidad"
                          type="number"
                          min={1}
                          max={20}
                          value={String(n.cantidad)}
                          onChange={(v) =>
                            nivel(n.id, { cantidad: Number(v) || 1 })
                          }
                          autoComplete="off"
                        />
                        <Select
                          label="Descuento"
                          options={[
                            { label: "Porcentaje", value: "porcentaje" },
                            { label: "Monto fijo", value: "monto" },
                            { label: "Precio final", value: "precioFijo" },
                          ]}
                          value={n.descuento.tipo}
                          onChange={(v) =>
                            nivel(n.id, {
                              descuento: {
                                ...n.descuento,
                                tipo: v as TipoDescuento,
                              },
                            })
                          }
                        />
                        <TextField
                          label={
                            n.descuento.tipo === "porcentaje" ? "%" : "Valor"
                          }
                          type="number"
                          min={0}
                          value={String(n.descuento.valor)}
                          onChange={(v) =>
                            nivel(n.id, {
                              descuento: {
                                ...n.descuento,
                                valor: Number(v) || 0,
                              },
                            })
                          }
                          autoComplete="off"
                        />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <TextField
                          label="Título"
                          value={n.titulo}
                          onChange={(v) => nivel(n.id, { titulo: v })}
                          autoComplete="off"
                        />
                        <TextField
                          label="Subtítulo"
                          value={n.subtitulo}
                          onChange={(v) => nivel(n.id, { subtitulo: v })}
                          autoComplete="off"
                        />
                        <TextField
                          label="Insignia"
                          placeholder="Más popular"
                          value={n.etiqueta}
                          onChange={(v) => nivel(n.id, { etiqueta: v })}
                          autoComplete="off"
                        />
                      </FormLayout.Group>
                    </FormLayout>
                  </BlockStack>
                </Box>
              ))}
              <InlineStack>
                <Button
                  disabled={o.niveles.length >= 6}
                  onClick={() => {
                    const cantidad =
                      Math.max(0, ...o.niveles.map((n) => n.cantidad)) + 1;
                    set("niveles", [
                      ...o.niveles,
                      {
                        id: idNivel(),
                        cantidad,
                        titulo: `${cantidad} unidades`,
                        subtitulo: "Ahorra {descuento}",
                        etiqueta: "",
                        descuento: { tipo: "porcentaje", valor: 0 },
                        porDefecto: false,
                      },
                    ]);
                  }}
                >
                  + Agregar nivel
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Diseño
              </Text>
              <ChoiceList
                title="Plantilla"
                choices={[
                  { label: "Barras (una fila por nivel)", value: "barras" },
                  {
                    label: "Tarjetas (niveles lado a lado)",
                    value: "tarjetas",
                  },
                ]}
                selected={[o.diseno.plantilla]}
                onChange={([v]) =>
                  diseno("plantilla", v as "barras" | "tarjetas")
                }
              />
              <FormLayout>
                <TextField
                  label="Encabezado"
                  value={o.diseno.encabezado}
                  onChange={(v) => diseno("encabezado", v)}
                  autoComplete="off"
                />
                <FormLayout.Group>
                  <CampoColor
                    label="Color principal"
                    value={o.diseno.colorPrincipal}
                    onChange={(v) => diseno("colorPrincipal", v)}
                  />
                  <CampoColor
                    label="Color del texto"
                    value={o.diseno.colorTexto}
                    onChange={(v) => diseno("colorTexto", v)}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <CampoColor
                    label="Fondo"
                    value={o.diseno.colorFondo}
                    onChange={(v) => diseno("colorFondo", v)}
                  />
                  <CampoColor
                    label="Fondo del nivel elegido"
                    value={o.diseno.colorFondoSeleccionado}
                    onChange={(v) => diseno("colorFondoSeleccionado", v)}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <CampoColor
                    label="Fondo de la insignia"
                    value={o.diseno.colorEtiqueta}
                    onChange={(v) => diseno("colorEtiqueta", v)}
                  />
                  <CampoColor
                    label="Texto de la insignia"
                    value={o.diseno.colorTextoEtiqueta}
                    onChange={(v) => diseno("colorTextoEtiqueta", v)}
                  />
                </FormLayout.Group>
                <RangeSlider
                  label="Esquinas redondeadas"
                  min={0}
                  max={30}
                  value={o.diseno.radio}
                  onChange={(v) => diseno("radio", Number(v))}
                  output
                />
              </FormLayout>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Dónde mostrar la oferta
              </Text>
              <Checkbox
                label="Dentro del formulario contraentrega"
                checked={o.ubicacion.formulario}
                onChange={(v) =>
                  set("ubicacion", { ...o.ubicacion, formulario: v })
                }
              />
              <Checkbox
                label="Encima del botón de compra (en la página del producto)"
                checked={o.ubicacion.encimaBoton}
                onChange={(v) =>
                  set("ubicacion", { ...o.ubicacion, encimaBoton: v })
                }
              />
              <Text as="h2" variant="headingMd">
                Opciones
              </Text>
              <Checkbox
                label="Mostrar precio por unidad (“$ 79.760 c/u”)"
                checked={o.opciones.mostrarPrecioUnitario}
                onChange={(v) =>
                  set("opciones", { ...o.opciones, mostrarPrecioUnitario: v })
                }
              />
              <Checkbox
                label="Usar el precio de comparación de Shopify como precio tachado"
                checked={o.opciones.usarPrecioComparacion}
                onChange={(v) =>
                  set("opciones", { ...o.opciones, usarPrecioComparacion: v })
                }
              />
            </BlockStack>
          </Card>
        </BlockStack>

        <div style={{ minWidth: 0 }}>
          <div style={{ position: "sticky", top: 16 }}>
            <VistaOferta oferta={o} vista={inicial.vista} />
          </div>
        </div>
      </InlineGrid>
    </Page>
  );
}

/** Vista previa de las barras con un producto de ejemplo de $ 99.700. */
function VistaOferta({
  oferta,
  vista,
}: {
  oferta: OfertaCantidad;
  vista: ArchivosVista;
}) {
  const anfitrion = useRef<HTMLDivElement>(null);
  const [raiz, setRaiz] = useState<ShadowRoot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setRaiz(prepararVistaPrevia(anfitrion.current!, vista));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // Los archivos llegan una sola vez con la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!raiz) return;
    const t = setTimeout(() => {
      try {
        let c = raiz.getElementById("o");
        if (!c) {
          c = document.createElement("div");
          c.id = "o";
          raiz.append(c);
        }
        window.ValidataPreview!.montarOferta(c, oferta);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 100);
    return () => clearTimeout(t);
  }, [raiz, oferta]);

  return (
    <BlockStack gap="300">
      <Text as="h2" variant="headingMd" alignment="center">
        Vista previa en vivo
      </Text>
      {error && (
        <Banner tone="critical" title={`Error en la vista previa: ${error}`} />
      )}
      <Box
        background="bg-surface"
        padding="400"
        borderRadius="300"
        shadow="200"
      >
        <div ref={anfitrion} />
      </Box>
      <Text as="p" tone="subdued" variant="bodySm">
        Producto de ejemplo de $ 99.700. En tu tienda se usa el precio real de
        cada producto.
      </Text>
    </BlockStack>
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
    <Page backAction={{ content: "Ofertas", url: "/app/ofertas" }}>
      <Banner tone="critical" title="No se pudo abrir la oferta">
        <p>{mensaje}</p>
      </Banner>
    </Page>
  );
}
