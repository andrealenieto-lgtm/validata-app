import { useEffect, useMemo, useRef, useState } from "react";
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
  RangeSlider,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  PAQUETE_POR_DEFECTO,
  normalizarPaquete,
  paqueteValido,
  precioPaquete,
  type Paquete,
  type TipoDescuento,
} from "../lib/ofertas.ts";
import { guardarPaquete, obtenerPaquete } from "../tienda.server";
import { productosDelPaquete } from "../paquetes.server";
import { archivosVistaPrevia } from "../vista-previa.server";
import { CampoColor } from "../components/CampoColor";
import {
  prepararVistaPrevia,
  type ArchivosVista,
  type PaqueteVista,
} from "../components/vistaPrevia";

/** Lo que el editor necesita de cada producto para mostrarlo y calcular la vista previa. */
interface InfoProducto {
  titulo: string;
  imagen: string | null;
  precio: number;
  /** false si no se puede vender (sin stock, archivado o en borrador). */
  disponible: boolean;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const nuevo = params.id === "nuevo";
  const paquete = nuevo
    ? normalizarPaquete(PAQUETE_POR_DEFECTO, "nuevo")
    : await obtenerPaquete(session.shop, params.id!);
  if (!paquete) throw new Response("Paquete no encontrado", { status: 404 });

  const info: Record<string, InfoProducto> = {};
  if (paquete.productos.length) {
    const datos = await productosDelPaquete(admin, paquete);
    for (const d of Object.values(datos))
      info[d.productoId] = {
        titulo: d.titulo,
        imagen: d.imagen,
        precio: d.precio,
        disponible: d.disponible,
      };
  }
  return { paquete, nuevo, info, vista: await archivosVistaPrevia() };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  let entrada: unknown = null;
  try {
    entrada = JSON.parse(String(form.get("paquete") ?? "null"));
  } catch {
    return { error: "Paquete inválido" };
  }
  const paquete = await guardarPaquete(
    session.shop,
    params.id === "nuevo" ? null : params.id!,
    entrada,
  );
  return { paquete };
};

export default function EditorPaquete() {
  const inicial = useLoaderData<typeof loader>();
  const [p, setP] = useState<Paquete>(inicial.paquete);
  const [info, setInfo] = useState<Record<string, InfoProducto>>(inicial.info);
  const [guardadoJson, setGuardadoJson] = useState(() =>
    JSON.stringify(inicial.paquete),
  );
  const guardar = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  useEffect(() => {
    const d = guardar.data;
    if (d && "paquete" in d && d.paquete) {
      setP(d.paquete);
      setGuardadoJson(JSON.stringify(d.paquete));
      if (inicial.nuevo)
        navigate(`/app/paquetes/${d.paquete.id}`, { replace: true });
    }
  }, [guardar.data, inicial.nuevo, navigate]);

  const set = <K extends keyof Paquete>(k: K, v: Paquete[K]) =>
    setP((x) => ({ ...x, [k]: v }));
  const diseno = <K extends keyof Paquete["diseno"]>(
    k: K,
    v: Paquete["diseno"][K],
  ) => setP((x) => ({ ...x, diseno: { ...x.diseno, [k]: v } }));
  const sinGuardar = inicial.nuevo || JSON.stringify(p) !== guardadoJson;
  const valido = paqueteValido(p);
  const noDisponibles = p.productos.filter(
    (x) => info[x.productoId]?.disponible === false,
  );

  async function elegirProductos() {
    const r = await shopify.resourcePicker({
      type: "product",
      multiple: 5,
      selectionIds: p.productos.map((x) => ({
        id: `gid://shopify/Product/${x.productoId}`,
      })),
    });
    if (!r) return;
    const elegidos = r as unknown as {
      id: string;
      title: string;
      images?: { originalSrc?: string }[];
      variants?: { price?: string }[];
    }[];
    const nuevaInfo = { ...info };
    for (const e of elegidos)
      nuevaInfo[e.id.replace(/\D/g, "")] = {
        titulo: e.title,
        imagen: e.images?.[0]?.originalSrc ?? null,
        precio: Number(e.variants?.[0]?.price ?? 0),
        // Se confirma al guardar y recargar (el selector no trae la disponibilidad).
        disponible: info[e.id.replace(/\D/g, "")]?.disponible ?? true,
      };
    setInfo(nuevaInfo);
    set(
      "productos",
      elegidos.slice(0, 5).map((e) => {
        const id = e.id.replace(/\D/g, "");
        return {
          productoId: id,
          cantidad: p.productos.find((x) => x.productoId === id)?.cantidad ?? 1,
        };
      }),
    );
  }

  return (
    <Page fullWidth>
      <TitleBar title={inicial.nuevo ? "Nuevo paquete" : p.nombre}>
        <button
          variant="primary"
          disabled={guardar.state !== "idle" || !valido}
          onClick={() =>
            guardar.submit({ paquete: JSON.stringify(p) }, { method: "post" })
          }
        >
          Guardar
        </button>
      </TitleBar>
      <InlineGrid columns={{ xs: 1, md: "3fr 2fr", lg: "2fr 1fr" }} gap="400">
        <BlockStack gap="400">
          {sinGuardar ? (
            <Banner tone="warning" title="Tienes cambios sin guardar">
              {valido
                ? "La vista previa ya los muestra; tu tienda cambiará cuando des clic en Guardar."
                : "Elige al menos 2 productos para poder guardar el paquete."}
            </Banner>
          ) : (
            guardar.data &&
            "paquete" in guardar.data && (
              <Banner
                tone="success"
                title="Paquete guardado. Ya se ofrece en la página de cada producto del paquete."
              />
            )
          )}

          {noDisponibles.length > 0 && (
            <Banner
              tone="critical"
              title="Este paquete no se está mostrando en tu tienda"
            >
              {noDisponibles.map((x) => info[x.productoId]?.titulo).join(", ")}{" "}
              {noDisponibles.length === 1
                ? "no está disponible"
                : "no están disponibles"}{" "}
              para la venta (sin stock, archivado o en borrador). El paquete
              solo se ofrece si todos sus productos se pueden vender: quítalo o
              actívalo en Shopify.
            </Banner>
          )}

          <Card>
            <FormLayout>
              <TextField
                label="Nombre del paquete"
                value={p.nombre}
                onChange={(v) => set("nombre", v)}
                autoComplete="off"
              />
              <Checkbox
                label="Paquete activo"
                checked={p.activo}
                onChange={(v) => set("activo", v)}
              />
            </FormLayout>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Productos en este paquete ({p.productos.length} de 5)
              </Text>
              <Text as="p" tone="subdued">
                El paquete aparece en la página de cualquiera de estos
                productos.
              </Text>
              <InlineStack>
                <Button onClick={elegirProductos}>
                  {p.productos.length
                    ? "Cambiar productos"
                    : "Seleccionar productos"}
                </Button>
              </InlineStack>
              {p.productos.map((x, i) => {
                const d = info[x.productoId];
                return (
                  <InlineStack
                    key={x.productoId}
                    gap="300"
                    blockAlign="center"
                    align="space-between"
                    wrap={false}
                  >
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail source={d?.imagen ?? ""} alt="" size="small" />
                      {d?.disponible === false && (
                        <Badge tone="critical">No disponible</Badge>
                      )}
                      <Text as="span">
                        {d?.titulo ?? `Producto ${x.productoId}`}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <div style={{ width: 90 }}>
                        <TextField
                          label="Cantidad"
                          labelHidden
                          type="number"
                          min={1}
                          max={10}
                          value={String(x.cantidad)}
                          onChange={(v) =>
                            set(
                              "productos",
                              p.productos.map((y, j) =>
                                j === i
                                  ? {
                                      ...y,
                                      cantidad: Math.max(1, Number(v) || 1),
                                    }
                                  : y,
                              ),
                            )
                          }
                          autoComplete="off"
                        />
                      </div>
                      <Button
                        variant="plain"
                        tone="critical"
                        onClick={() =>
                          set(
                            "productos",
                            p.productos.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Quitar
                      </Button>
                    </InlineStack>
                  </InlineStack>
                );
              })}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Descuento y textos
              </Text>
              <FormLayout>
                <FormLayout.Group>
                  <Select
                    label="Tipo de descuento"
                    options={[
                      { label: "Porcentaje", value: "porcentaje" },
                      { label: "Monto fijo", value: "monto" },
                      {
                        label: "Precio final del paquete",
                        value: "precioFijo",
                      },
                    ]}
                    value={p.descuento.tipo}
                    onChange={(v) =>
                      set("descuento", {
                        ...p.descuento,
                        tipo: v as TipoDescuento,
                      })
                    }
                  />
                  <TextField
                    label="Valor del descuento"
                    type="number"
                    min={0}
                    suffix={p.descuento.tipo === "porcentaje" ? "%" : undefined}
                    value={String(p.descuento.valor)}
                    onChange={(v) =>
                      set("descuento", {
                        ...p.descuento,
                        valor: Number(v) || 0,
                      })
                    }
                    autoComplete="off"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Título"
                    value={p.titulo}
                    onChange={(v) => set("titulo", v)}
                    autoComplete="off"
                  />
                  <TextField
                    label="Subtítulo"
                    helpText="Puedes usar {descuento}."
                    value={p.subtitulo}
                    onChange={(v) => set("subtitulo", v)}
                    autoComplete="off"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Insignia"
                    value={p.etiqueta}
                    onChange={(v) => set("etiqueta", v)}
                    autoComplete="off"
                  />
                  <TextField
                    label="Texto de la opción sin paquete"
                    value={p.textoPrecioEstandar}
                    onChange={(v) => set("textoPrecioEstandar", v)}
                    autoComplete="off"
                  />
                </FormLayout.Group>
                <Checkbox
                  label="Seleccionar el paquete por defecto"
                  checked={p.porDefecto}
                  onChange={(v) => set("porDefecto", v)}
                />
              </FormLayout>
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
                  {
                    label: "Horizontal (productos en fila)",
                    value: "horizontal",
                  },
                  {
                    label: "Vertical (productos en columna)",
                    value: "vertical",
                  },
                ]}
                selected={[p.plantilla]}
                onChange={([v]) =>
                  set("plantilla", v as "horizontal" | "vertical")
                }
              />
              <FormLayout>
                <FormLayout.Group>
                  <CampoColor
                    label="Color principal"
                    value={p.diseno.colorPrincipal}
                    onChange={(v) => diseno("colorPrincipal", v)}
                  />
                  <CampoColor
                    label="Color del texto"
                    value={p.diseno.colorTexto}
                    onChange={(v) => diseno("colorTexto", v)}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <CampoColor
                    label="Fondo"
                    value={p.diseno.colorFondo}
                    onChange={(v) => diseno("colorFondo", v)}
                  />
                  <CampoColor
                    label="Fondo de la opción elegida"
                    value={p.diseno.colorFondoSeleccionado}
                    onChange={(v) => diseno("colorFondoSeleccionado", v)}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <CampoColor
                    label="Fondo de la insignia"
                    value={p.diseno.colorEtiqueta}
                    onChange={(v) => diseno("colorEtiqueta", v)}
                  />
                  <CampoColor
                    label="Texto de la insignia"
                    value={p.diseno.colorTextoEtiqueta}
                    onChange={(v) => diseno("colorTextoEtiqueta", v)}
                  />
                </FormLayout.Group>
                <RangeSlider
                  label="Esquinas redondeadas"
                  min={0}
                  max={30}
                  value={p.diseno.radio}
                  onChange={(v) => diseno("radio", Number(v))}
                  output
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </BlockStack>

        <div style={{ minWidth: 0 }}>
          <div style={{ position: "sticky", top: 16 }}>
            <VistaPaquete paquete={p} info={info} vista={inicial.vista} />
          </div>
        </div>
      </InlineGrid>
    </Page>
  );
}

/** Vista previa con los precios reales de los productos elegidos. */
function VistaPaquete({
  paquete,
  info,
  vista,
}: {
  paquete: Paquete;
  info: Record<string, InfoProducto>;
  vista: ArchivosVista;
}) {
  const anfitrion = useRef<HTMLDivElement>(null);
  const [raiz, setRaiz] = useState<ShadowRoot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mismo cálculo que hace el servidor al cobrar (precioPaquete).
  const datos = useMemo(() => {
    if (
      !paqueteValido(paquete) ||
      paquete.productos.some((x) => !info[x.productoId])
    )
      return null;
    const precio = precioPaquete(
      paquete,
      Object.fromEntries(
        paquete.productos.map((x) => [
          x.productoId,
          { precio: info[x.productoId].precio },
        ]),
      ),
    );
    const vistaPaquete: PaqueteVista = {
      id: paquete.id,
      titulo: paquete.titulo,
      subtitulo: paquete.subtitulo,
      etiqueta: paquete.etiqueta,
      textoPrecioEstandar: paquete.textoPrecioEstandar,
      porDefecto: paquete.porDefecto,
      plantilla: paquete.plantilla,
      diseno: paquete.diseno,
      total: precio.total,
      antes: precio.antes,
      productos: precio.lineas.map((l) => ({
        titulo: info[l.productoId].titulo,
        cantidad: l.cantidad,
        imagen: info[l.productoId].imagen,
        total: l.total,
        antes: l.antes,
      })),
    };
    const primero = info[paquete.productos[0].productoId];
    return {
      vistaPaquete,
      producto: { titulo: primero.titulo, precio: primero.precio },
    };
  }, [paquete, info]);

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
    let c = raiz.getElementById("p");
    if (!c) {
      c = document.createElement("div");
      c.id = "p";
      raiz.append(c);
    }
    if (!datos) {
      c.replaceChildren();
      return;
    }
    try {
      window.ValidataPreview!.montarPaquete(
        c,
        datos.vistaPaquete,
        datos.producto,
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [raiz, datos]);

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
        {!datos && (
          <Text as="p" tone="subdued" alignment="center">
            Selecciona al menos 2 productos para ver el paquete.
          </Text>
        )}
        <div ref={anfitrion} />
      </Box>
      <Text as="p" tone="subdued" variant="bodySm">
        Así se ve en la página del primer producto del paquete. En cada producto
        la opción “precio estándar” muestra ese producto.
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
    <Page>
      <Banner tone="critical" title="No se pudo abrir el paquete">
        <p>{mensaje}</p>
      </Banner>
    </Page>
  );
}
