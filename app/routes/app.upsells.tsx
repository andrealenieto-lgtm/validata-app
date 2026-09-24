import { useEffect, useMemo, useRef, useState } from "react";
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
  FormLayout,
  InlineGrid,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  CLICK_POR_DEFECTO,
  DOWNSELL_POR_DEFECTO,
  MAX_OFERTAS_UPSELL,
  TICK_POR_DEFECTO,
  precioOfertaUpsell,
  type Alcance,
  type ConfigUpsells,
  type Downsell,
  type Upsell1Click,
  type Upsell1Tick,
} from "../lib/upsells.ts";
import {
  guardarUpsells,
  obtenerTienda,
  obtenerUpsells,
} from "../tienda.server";
import { archivosVistaPrevia } from "../vista-previa.server";
import { CampoColor } from "../components/CampoColor";
import {
  prepararVistaPrevia,
  type ArchivosVista,
} from "../components/vistaPrevia";
import type { ConfigFormulario } from "../lib/formulario/esquema.ts";

interface InfoProducto {
  titulo: string;
  imagen: string | null;
  precio: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [cfg, tienda, vista] = await Promise.all([
    obtenerUpsells(session.shop),
    obtenerTienda(session.shop),
    archivosVistaPrevia(),
  ]);

  // Nombre, foto y precio de los productos ofrecidos en los upsells de 1 clic.
  const ids = [
    ...new Set(cfg.clicks.flatMap((c) => c.ofertas.map((o) => o.productoId))),
  ];
  const info: Record<string, InfoProducto> = {};
  if (ids.length) {
    const r = await admin.graphql(
      `#graphql
      query productos($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title featuredMedia { preview { image { url } } } variants(first: 1) { nodes { price } } }
        }
      }`,
      { variables: { ids: ids.map((id) => `gid://shopify/Product/${id}`) } },
    );
    type Nodo = {
      id?: string;
      title?: string;
      featuredMedia?: { preview?: { image?: { url?: string } } };
      variants?: { nodes: { price: string }[] };
    };
    for (const n of ((await r.json()).data?.nodes ?? []) as (Nodo | null)[]) {
      if (!n?.id) continue;
      info[n.id.replace(/\D/g, "")] = {
        titulo: n.title ?? "",
        imagen: n.featuredMedia?.preview?.image?.url ?? null,
        precio: Number(n.variants?.nodes[0]?.price ?? 0),
      };
    }
  }
  return { cfg, info, formulario: tienda.formularioConfig, vista };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  let entrada: unknown = null;
  try {
    entrada = JSON.parse(String(form.get("upsells") ?? "null"));
  } catch {
    return { error: "Configuración inválida" };
  }
  return { cfg: await guardarUpsells(session.shop, entrada) };
};

let contador = 0;
const idNuevo = (p: string) => `${p}${Date.now().toString(36)}${contador++}`;

type Seccion = "ticks" | "clicks" | "downsells";

export default function Upsells() {
  const inicial = useLoaderData<typeof loader>();
  const [cfg, setCfg] = useState<ConfigUpsells>(inicial.cfg);
  const [info, setInfo] = useState<Record<string, InfoProducto>>(inicial.info);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [guardadoJson, setGuardadoJson] = useState(() =>
    JSON.stringify(inicial.cfg),
  );
  const guardar = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    const d = guardar.data;
    if (d && "cfg" in d && d.cfg) {
      setCfg(d.cfg);
      setGuardadoJson(JSON.stringify(d.cfg));
    }
  }, [guardar.data]);
  const sinGuardar = JSON.stringify(cfg) !== guardadoJson;

  function cambiar<S extends Seccion>(
    seccion: S,
    id: string,
    cambio: Partial<ConfigUpsells[S][number]>,
  ) {
    setCfg((c) => ({
      ...c,
      [seccion]: (c[seccion] as { id: string }[]).map((x) =>
        x.id === id ? { ...x, ...cambio } : x,
      ),
    }));
  }
  function quitar(seccion: Seccion, id: string) {
    setCfg((c) => ({
      ...c,
      [seccion]: (c[seccion] as { id: string }[]).filter((x) => x.id !== id),
    }));
  }
  function agregar(seccion: Seccion) {
    const id = idNuevo(
      seccion === "ticks" ? "t" : seccion === "clicks" ? "c" : "d",
    );
    const nuevo =
      seccion === "ticks"
        ? { ...TICK_POR_DEFECTO, id }
        : seccion === "clicks"
          ? { ...CLICK_POR_DEFECTO, id }
          : { ...DOWNSELL_POR_DEFECTO, id };
    setCfg((c) => ({ ...c, [seccion]: [...c[seccion], nuevo] }));
    setAbierto(id);
  }

  async function elegirAlcance(
    tipo: "productos" | "colecciones",
    actual: Alcance,
    alCambiar: (a: Alcance) => void,
  ) {
    const recurso = tipo === "productos" ? "Product" : "Collection";
    const r = await shopify.resourcePicker({
      type: tipo === "productos" ? "product" : "collection",
      multiple: true,
      selectionIds:
        actual.tipo === tipo
          ? actual.ids.map((id) => ({ id: `gid://shopify/${recurso}/${id}` }))
          : [],
    });
    if (!r) return;
    alCambiar({
      tipo,
      ids: (r as unknown as { id: string }[]).map((x) =>
        x.id.replace(/\D/g, ""),
      ),
    });
  }

  async function agregarOfertaUpsell(u: Upsell1Click) {
    const r = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    const p = (
      r as unknown as
        | {
            id: string;
            title: string;
            images?: { originalSrc?: string }[];
            variants?: { price?: string }[];
          }[]
        | undefined
    )?.[0];
    if (!p) return;
    const productoId = p.id.replace(/\D/g, "");
    setInfo((x) => ({
      ...x,
      [productoId]: {
        titulo: p.title,
        imagen: p.images?.[0]?.originalSrc ?? null,
        precio: Number(p.variants?.[0]?.price ?? 0),
      },
    }));
    cambiar("clicks", u.id, {
      ofertas: [
        ...u.ofertas,
        {
          id: idNuevo("o"),
          productoId,
          descuento: { tipo: "porcentaje", valor: 10 },
          selectorCantidad: false,
          seleccionVariantes: false,
          temporizadorMin: 10,
        },
      ],
    });
  }

  const Alcance = ({
    alcance,
    alCambiar,
  }: {
    alcance: Alcance;
    alCambiar: (a: Alcance) => void;
  }) => (
    <BlockStack gap="200">
      <ChoiceList
        title="¿En qué productos se muestra?"
        choices={[
          { label: "Todos los productos", value: "todos" },
          { label: "Productos específicos", value: "productos" },
          { label: "Colecciones específicas", value: "colecciones" },
        ]}
        selected={[alcance.tipo]}
        onChange={([v]) => {
          if (v === "todos") alCambiar({ tipo: "todos" });
          else
            elegirAlcance(v as "productos" | "colecciones", alcance, alCambiar);
        }}
      />
      {alcance.tipo !== "todos" && (
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" tone="subdued">
            {alcance.ids.length}{" "}
            {alcance.tipo === "productos" ? "producto(s)" : "colección(es)"}{" "}
            seleccionado(s)
          </Text>
          <Button
            variant="plain"
            onClick={() =>
              elegirAlcance(
                alcance.tipo as "productos" | "colecciones",
                alcance,
                alCambiar,
              )
            }
          >
            Cambiar
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );

  const Fila = ({
    seccion,
    id,
    nombre,
    activo,
    detalle,
  }: {
    seccion: Seccion;
    id: string;
    nombre: string;
    activo: boolean;
    detalle: string;
  }) => (
    <InlineStack align="space-between" blockAlign="center" gap="200">
      <BlockStack gap="050">
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" fontWeight="semibold">
            {nombre}
          </Text>
          <Badge tone={activo ? "success" : undefined}>
            {activo ? "Activo" : "Pausado"}
          </Badge>
        </InlineStack>
        <Text as="span" tone="subdued" variant="bodySm">
          {detalle}
        </Text>
      </BlockStack>
      <InlineStack gap="200">
        <Button onClick={() => setAbierto(abierto === id ? null : id)}>
          {abierto === id ? "Cerrar" : "Editar"}
        </Button>
        <Button tone="critical" onClick={() => quitar(seccion, id)}>
          Eliminar
        </Button>
      </InlineStack>
    </InlineStack>
  );

  const editorTick = (t: Upsell1Tick) => (
    <FormLayout>
      <FormLayout.Group>
        <TextField
          label="Nombre interno"
          value={t.nombre}
          onChange={(v) => cambiar("ticks", t.id, { nombre: v })}
          autoComplete="off"
        />
        <Checkbox
          label="Activo"
          checked={t.activo}
          onChange={(v) => cambiar("ticks", t.id, { activo: v })}
        />
      </FormLayout.Group>
      <FormLayout.Group>
        <TextField
          label="Título de la oferta"
          value={t.titulo}
          onChange={(v) => cambiar("ticks", t.id, { titulo: v })}
          autoComplete="off"
        />
        <TextField
          label="Precio"
          type="number"
          min={0}
          value={String(t.precio)}
          onChange={(v) => cambiar("ticks", t.id, { precio: Number(v) || 0 })}
          autoComplete="off"
        />
      </FormLayout.Group>
      <TextField
        label="Texto"
        helpText="Puedes usar {{title}} y {{price}}."
        multiline={2}
        value={t.texto}
        onChange={(v) => cambiar("ticks", t.id, { texto: v })}
        autoComplete="off"
      />
      <Checkbox
        label="Requiere envío"
        checked={t.requiereEnvio}
        onChange={(v) => cambiar("ticks", t.id, { requiereEnvio: v })}
      />
      <Alcance
        alcance={t.alcance}
        alCambiar={(a) => cambiar("ticks", t.id, { alcance: a })}
      />
      <FormLayout.Group>
        <CampoColor
          label="Color de marca"
          value={t.colores.marca}
          onChange={(v) =>
            cambiar("ticks", t.id, { colores: { ...t.colores, marca: v } })
          }
        />
        <CampoColor
          label="Fondo"
          value={t.colores.fondo}
          onChange={(v) =>
            cambiar("ticks", t.id, { colores: { ...t.colores, fondo: v } })
          }
        />
      </FormLayout.Group>
      <FormLayout.Group>
        <CampoColor
          label="Borde"
          value={t.colores.borde}
          onChange={(v) =>
            cambiar("ticks", t.id, { colores: { ...t.colores, borde: v } })
          }
        />
        <Select
          label="Estilo del borde"
          options={[
            { label: "Punteado (dashed)", value: "dashed" },
            { label: "Puntos (dotted)", value: "dotted" },
            { label: "Sólido", value: "solid" },
          ]}
          value={t.colores.estiloBorde}
          onChange={(v) =>
            cambiar("ticks", t.id, {
              colores: {
                ...t.colores,
                estiloBorde: v as Upsell1Tick["colores"]["estiloBorde"],
              },
            })
          }
        />
      </FormLayout.Group>
    </FormLayout>
  );

  const editorClick = (u: Upsell1Click) => (
    <FormLayout>
      <FormLayout.Group>
        <TextField
          label="Nombre interno"
          value={u.nombre}
          onChange={(v) => cambiar("clicks", u.id, { nombre: v })}
          autoComplete="off"
        />
        <Checkbox
          label="Activo"
          checked={u.activo}
          onChange={(v) => cambiar("clicks", u.id, { activo: v })}
        />
      </FormLayout.Group>
      <Text as="p" tone="subdued">
        Se muestra cuando el cliente da clic en finalizar, antes de crear el
        pedido. Si acepta, el producto se agrega al mismo pedido.
      </Text>
      <Text as="h3" variant="headingSm">
        1. Si el cliente compra uno de estos productos
      </Text>
      <Alcance
        alcance={u.disparador}
        alCambiar={(a) => cambiar("clicks", u.id, { disparador: a })}
      />
      <Text as="h3" variant="headingSm">
        2. Ofrécele (en orden; si rechaza, pasa a la siguiente)
      </Text>
      {u.ofertas.map((o, i) => {
        const p = info[o.productoId];
        return (
          <Box
            key={o.id}
            padding="300"
            borderWidth="025"
            borderColor="border"
            borderRadius="200"
          >
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Thumbnail source={p?.imagen ?? ""} alt="" size="small" />
                  <Text as="span">
                    Oferta {i + 1}: {p?.titulo ?? `Producto ${o.productoId}`}
                  </Text>
                </InlineStack>
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={() =>
                    cambiar("clicks", u.id, {
                      ofertas: u.ofertas.filter((x) => x.id !== o.id),
                    })
                  }
                >
                  Quitar
                </Button>
              </InlineStack>
              <FormLayout.Group condensed>
                <Select
                  label="Descuento"
                  options={[
                    { label: "Porcentaje", value: "porcentaje" },
                    { label: "Monto fijo", value: "monto" },
                  ]}
                  value={o.descuento.tipo}
                  onChange={(v) =>
                    cambiar("clicks", u.id, {
                      ofertas: u.ofertas.map((x) =>
                        x.id === o.id
                          ? {
                              ...x,
                              descuento: {
                                ...x.descuento,
                                tipo: v as "porcentaje" | "monto",
                              },
                            }
                          : x,
                      ),
                    })
                  }
                />
                <TextField
                  label="Valor"
                  type="number"
                  min={0}
                  value={String(o.descuento.valor)}
                  onChange={(v) =>
                    cambiar("clicks", u.id, {
                      ofertas: u.ofertas.map((x) =>
                        x.id === o.id
                          ? {
                              ...x,
                              descuento: {
                                ...x.descuento,
                                valor: Number(v) || 0,
                              },
                            }
                          : x,
                      ),
                    })
                  }
                  autoComplete="off"
                />
                <TextField
                  label="Temporizador"
                  type="number"
                  min={0}
                  suffix="min"
                  helpText="0 = sin temporizador"
                  value={String(o.temporizadorMin)}
                  onChange={(v) =>
                    cambiar("clicks", u.id, {
                      ofertas: u.ofertas.map((x) =>
                        x.id === o.id
                          ? { ...x, temporizadorMin: Number(v) || 0 }
                          : x,
                      ),
                    })
                  }
                  autoComplete="off"
                />
              </FormLayout.Group>
            </BlockStack>
          </Box>
        );
      })}
      <InlineStack>
        <Button
          disabled={u.ofertas.length >= MAX_OFERTAS_UPSELL}
          onClick={() => agregarOfertaUpsell(u)}
        >
          + Agregar oferta
        </Button>
      </InlineStack>
      <Text as="h3" variant="headingSm">
        Textos
      </Text>
      <FormLayout.Group>
        <TextField
          label="Encabezado"
          value={u.textos.encabezado}
          onChange={(v) =>
            cambiar("clicks", u.id, { textos: { ...u.textos, encabezado: v } })
          }
          autoComplete="off"
        />
        <TextField
          label="Subtítulo"
          value={u.textos.subtitulo}
          onChange={(v) =>
            cambiar("clicks", u.id, { textos: { ...u.textos, subtitulo: v } })
          }
          autoComplete="off"
        />
      </FormLayout.Group>
      <TextField
        label="Temporizador"
        helpText="Usa {time} para el tiempo que queda."
        value={u.textos.temporizador}
        onChange={(v) =>
          cambiar("clicks", u.id, { textos: { ...u.textos, temporizador: v } })
        }
        autoComplete="off"
      />
      <FormLayout.Group>
        <TextField
          label="Botón de aceptar"
          value={u.textos.aceptar}
          onChange={(v) =>
            cambiar("clicks", u.id, { textos: { ...u.textos, aceptar: v } })
          }
          autoComplete="off"
        />
        <TextField
          label="Botón de rechazar"
          value={u.textos.rechazar}
          onChange={(v) =>
            cambiar("clicks", u.id, { textos: { ...u.textos, rechazar: v } })
          }
          autoComplete="off"
        />
      </FormLayout.Group>
      <FormLayout.Group>
        <CampoColor
          label="Color del botón"
          value={u.colores.principal}
          onChange={(v) =>
            cambiar("clicks", u.id, { colores: { ...u.colores, principal: v } })
          }
        />
        <CampoColor
          label="Fondo"
          value={u.colores.fondo}
          onChange={(v) =>
            cambiar("clicks", u.id, { colores: { ...u.colores, fondo: v } })
          }
        />
      </FormLayout.Group>
    </FormLayout>
  );

  const editorDownsell = (d: Downsell) => (
    <FormLayout>
      <FormLayout.Group>
        <TextField
          label="Nombre interno"
          value={d.nombre}
          onChange={(v) => cambiar("downsells", d.id, { nombre: v })}
          autoComplete="off"
        />
        <Checkbox
          label="Activo"
          checked={d.activo}
          onChange={(v) => cambiar("downsells", d.id, { activo: v })}
        />
      </FormLayout.Group>
      <Alcance
        alcance={d.alcance}
        alCambiar={(a) => cambiar("downsells", d.id, { alcance: a })}
      />
      <Select
        label="¿Cuántas veces debe cerrarse el formulario antes de mostrarlo?"
        options={["1", "2", "3", "4"]}
        value={String(d.cierresNecesarios)}
        onChange={(v) =>
          cambiar("downsells", d.id, { cierresNecesarios: Number(v) })
        }
      />
      <FormLayout.Group>
        <Select
          label="Descuento"
          options={[
            { label: "Porcentaje", value: "porcentaje" },
            { label: "Monto fijo", value: "monto" },
          ]}
          value={d.descuento.tipo}
          onChange={(v) =>
            cambiar("downsells", d.id, {
              descuento: { ...d.descuento, tipo: v as "porcentaje" | "monto" },
            })
          }
        />
        <TextField
          label="Valor"
          type="number"
          min={0}
          value={String(d.descuento.valor)}
          onChange={(v) =>
            cambiar("downsells", d.id, {
              descuento: { ...d.descuento, valor: Number(v) || 0 },
            })
          }
          autoComplete="off"
        />
      </FormLayout.Group>
      <FormLayout.Group>
        <TextField
          label="Título"
          value={d.textos.titulo}
          onChange={(v) =>
            cambiar("downsells", d.id, { textos: { ...d.textos, titulo: v } })
          }
          autoComplete="off"
        />
        <TextField
          label="Insignia"
          value={d.textos.insignia}
          onChange={(v) =>
            cambiar("downsells", d.id, { textos: { ...d.textos, insignia: v } })
          }
          autoComplete="off"
        />
      </FormLayout.Group>
      <TextField
        label="Subtítulo"
        value={d.textos.subtitulo}
        onChange={(v) =>
          cambiar("downsells", d.id, { textos: { ...d.textos, subtitulo: v } })
        }
        autoComplete="off"
      />
      <TextField
        label="Descripción"
        value={d.textos.descripcion}
        onChange={(v) =>
          cambiar("downsells", d.id, {
            textos: { ...d.textos, descripcion: v },
          })
        }
        autoComplete="off"
      />
      <FormLayout.Group>
        <TextField
          label="Botón de completar pedido"
          helpText="Usa {discount} para mostrar el descuento."
          value={d.textos.aceptar}
          onChange={(v) =>
            cambiar("downsells", d.id, { textos: { ...d.textos, aceptar: v } })
          }
          autoComplete="off"
        />
        <TextField
          label="Botón de no, gracias"
          value={d.textos.rechazar}
          onChange={(v) =>
            cambiar("downsells", d.id, { textos: { ...d.textos, rechazar: v } })
          }
          autoComplete="off"
        />
      </FormLayout.Group>
      <FormLayout.Group>
        <CampoColor
          label="Fondo"
          value={d.colores.fondo}
          onChange={(v) =>
            cambiar("downsells", d.id, { colores: { ...d.colores, fondo: v } })
          }
        />
        <CampoColor
          label="Color del botón"
          value={d.colores.boton}
          onChange={(v) =>
            cambiar("downsells", d.id, { colores: { ...d.colores, boton: v } })
          }
        />
      </FormLayout.Group>
    </FormLayout>
  );

  const alcanceTexto = (a: Alcance) =>
    a.tipo === "todos"
      ? "Todos los productos"
      : `${a.ids.length} ${a.tipo === "productos" ? "producto(s)" : "colección(es)"}`;

  return (
    <Page fullWidth>
      <TitleBar title="Upsells y downsells">
        <button
          variant="primary"
          disabled={guardar.state !== "idle" || !sinGuardar}
          onClick={() =>
            guardar.submit({ upsells: JSON.stringify(cfg) }, { method: "post" })
          }
        >
          Guardar
        </button>
      </TitleBar>
      <InlineGrid columns={{ xs: 1, md: "3fr 2fr", lg: "2fr 1fr" }} gap="400">
        <BlockStack gap="400">
          {sinGuardar ? (
            <Banner tone="warning" title="Tienes cambios sin guardar">
              La vista previa ya los muestra; tu tienda cambiará cuando des clic
              en Guardar.
            </Banner>
          ) : (
            guardar.data &&
            "cfg" in guardar.data && (
              <Banner
                tone="success"
                title="Guardado. Ya se ve así en tu tienda."
              />
            )
          )}

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                1-Tick Upsell / Incremento de pedido
              </Text>
              <Text as="p" tone="subdued">
                Una casilla dentro del formulario que agrega algo más al pedido:
                envío prioritario, garantía extendida, envoltura de regalo…
              </Text>
              {cfg.ticks.map((t) => (
                <Box
                  key={t.id}
                  padding="300"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <Fila
                      seccion="ticks"
                      id={t.id}
                      nombre={t.nombre}
                      activo={t.activo}
                      detalle={`${t.titulo} · ${t.precio} · ${alcanceTexto(t.alcance)}`}
                    />
                    {abierto === t.id && editorTick(t)}
                  </BlockStack>
                </Box>
              ))}
              <InlineStack>
                <Button onClick={() => agregar("ticks")}>
                  + Crear 1-Tick Upsell
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                1-Click Upsell (antes de confirmar)
              </Text>
              <Text as="p" tone="subdued">
                Ofertas que aparecen al dar clic en finalizar. Hasta{" "}
                {MAX_OFERTAS_UPSELL} ofertas: si el cliente rechaza una, se
                muestra la siguiente.
              </Text>
              {cfg.clicks.map((u) => (
                <Box
                  key={u.id}
                  padding="300"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <Fila
                      seccion="clicks"
                      id={u.id}
                      nombre={u.nombre}
                      activo={u.activo}
                      detalle={`${u.ofertas.length} oferta(s) · ${alcanceTexto(u.disparador)}`}
                    />
                    {abierto === u.id && editorClick(u)}
                  </BlockStack>
                </Box>
              ))}
              <InlineStack>
                <Button onClick={() => agregar("clicks")}>
                  + Crear 1-Click Upsell
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Downsells
              </Text>
              <Text as="p" tone="subdued">
                Un descuento que aparece cuando el cliente cierra el formulario,
                para recuperar la venta.
              </Text>
              {cfg.downsells.map((d) => (
                <Box
                  key={d.id}
                  padding="300"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <Fila
                      seccion="downsells"
                      id={d.id}
                      nombre={d.nombre}
                      activo={d.activo}
                      detalle={`${d.descuento.tipo === "porcentaje" ? `${d.descuento.valor}%` : d.descuento.valor} · al cerrar ${d.cierresNecesarios} vez/veces · ${alcanceTexto(d.alcance)}`}
                    />
                    {abierto === d.id && editorDownsell(d)}
                  </BlockStack>
                </Box>
              ))}
              <InlineStack>
                <Button onClick={() => agregar("downsells")}>
                  + Crear downsell
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>

        <div style={{ minWidth: 0 }}>
          <div style={{ position: "sticky", top: 16 }}>
            <Vista
              cfg={cfg}
              info={info}
              formulario={inicial.formulario}
              vista={inicial.vista}
            />
          </div>
        </div>
      </InlineGrid>
    </Page>
  );
}

/** Vista previa del formulario con las casillas, el upsell y el downsell activos. */
function Vista({
  cfg,
  info,
  formulario,
  vista,
}: {
  cfg: ConfigUpsells;
  info: Record<string, InfoProducto>;
  formulario: ConfigFormulario;
  vista: ArchivosVista;
}) {
  const anfitrion = useRef<HTMLDivElement>(null);
  const [raiz, setRaiz] = useState<ShadowRoot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mismo formato que manda el servidor a la tienda (proxy.config), con todo lo activo.
  const extras = useMemo(() => {
    const click = cfg.clicks.find((c) => c.activo && c.ofertas.length);
    const downsell = cfg.downsells.find((d) => d.activo);
    return {
      ticks: cfg.ticks.filter((t) => t.activo),
      upsell: click && {
        id: click.id,
        textos: click.textos,
        colores: click.colores,
        ofertas: click.ofertas
          .filter((o) => info[o.productoId])
          .map((o) => {
            const p = precioOfertaUpsell(o, {
              precio: info[o.productoId].precio,
            });
            return {
              id: o.id,
              titulo: info[o.productoId].titulo,
              imagen: info[o.productoId].imagen,
              antes: p.antes,
              total: p.total,
              descuento: o.descuento,
              temporizadorMin: o.temporizadorMin,
            };
          }),
      },
      downsell: downsell && { ...downsell, cierresNecesarios: 1 },
    };
  }, [cfg, info]);

  useEffect(() => {
    try {
      setRaiz(
        prepararVistaPrevia(anfitrion.current!, vista, "#c{position:relative}"),
      );
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
        let c = raiz.getElementById("c");
        if (!c) {
          c = document.createElement("div");
          c.id = "c";
          raiz.append(c);
        }
        try {
          sessionStorage.removeItem("vd_downsell_x");
          sessionStorage.removeItem("vd_cierres_x");
        } catch {
          /* sin almacenamiento */
        }
        window.ValidataPreview!.montar(
          c,
          formulario,
          vista.deptos,
          null,
          null,
          extras,
        );
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 120);
    return () => clearTimeout(t);
  }, [raiz, extras, formulario, vista.deptos]);

  return (
    <BlockStack gap="300">
      <Text as="h2" variant="headingMd" alignment="center">
        Vista previa en vivo
      </Text>
      {error && (
        <Banner tone="critical" title={`Error en la vista previa: ${error}`} />
      )}
      <div
        style={{
          background: "#1f2937",
          borderRadius: 36,
          padding: 12,
          maxHeight: "75vh",
          overflow: "auto",
        }}
      >
        <div ref={anfitrion} style={{ borderRadius: 26, overflow: "hidden" }} />
      </div>
      <Text as="p" tone="subdued" variant="bodySm">
        Toca la × del formulario para ver el downsell. Completa los campos y da
        clic en finalizar para ver el upsell.
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
      <Banner tone="critical" title="No se pudo abrir Upsells y downsells">
        <p>{mensaje}</p>
      </Banner>
    </Page>
  );
}
