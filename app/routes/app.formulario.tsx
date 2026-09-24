import { useEffect, useRef, useState } from "react";
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
  ButtonGroup,
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  BLOQUES_FIJOS,
  FORMULARIO_POR_DEFECTO,
  PLANTILLAS,
  type Bloque,
  type ConfigFormulario,
} from "../lib/formulario/esquema.ts";
import { guardarFormulario, obtenerTienda } from "../tienda.server";
import { archivosVistaPrevia } from "../vista-previa.server";
import {
  prepararVistaPrevia,
  type ArchivosVista,
} from "../components/vistaPrevia";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [t, vista] = await Promise.all([
    obtenerTienda(session.shop),
    archivosVistaPrevia(),
  ]);
  return { config: t.formularioConfig, vista };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  let entrada: unknown = null;
  try {
    entrada = JSON.parse(String(form.get("config") ?? "null"));
  } catch {
    return { error: "Configuración inválida" };
  }
  return { config: await guardarFormulario(session.shop, entrada) };
};

const NOMBRES_BLOQUE: Record<Bloque["tipo"], string> = {
  carrito: "Contenido del carrito / Ofertas / Paquetes",
  resumen: "Resumen del pedido",
  envio: "Opciones de envío",
  imagen: "Imagen",
  texto: "Texto",
  campo: "Campo",
  validacion: "Validación de contraentrega",
  upsell: "Upsell de 1 casilla",
  enviar: "Botón de finalizar",
};

const tituloBloque = (b: Bloque) => {
  if (b.tipo === "campo") return b.etiqueta || b.nombre;
  if (b.tipo === "texto") return b.texto.slice(0, 50) || "Texto";
  if (b.tipo === "enviar") return b.texto;
  return NOMBRES_BLOQUE[b.tipo];
};

let contador = 0;
const idNuevo = (prefijo: string) =>
  `${prefijo}_${Date.now().toString(36)}${contador++}`;

export default function ConstructorFormularios() {
  const inicial = useLoaderData<typeof loader>();
  const [f, setF] = useState<ConfigFormulario>(inicial.config);
  const [abierto, setAbierto] = useState<string | null>(null);
  const guardar = useFetcher<typeof action>();
  const [ultimoGuardado, setUltimoGuardado] = useState(() =>
    JSON.stringify(inicial.config),
  );
  const sinGuardar = JSON.stringify(f) !== ultimoGuardado;

  useEffect(() => {
    if (guardar.data && "config" in guardar.data && guardar.data.config) {
      setF(guardar.data.config);
      setUltimoGuardado(JSON.stringify(guardar.data.config));
    }
  }, [guardar.data]);

  const plantillaActual = PLANTILLAS.find(
    (p) =>
      JSON.stringify(p.estilos) ===
      JSON.stringify({
        formulario: f.formulario,
        campos: f.campos,
        botonEnviar: f.botonEnviar,
      }),
  )?.id;

  const sec =
    <
      K extends
        | "boton"
        | "formulario"
        | "campos"
        | "botonEnviar"
        | "mensajes"
        | "preferencias",
    >(
      k: K,
    ) =>
    <P extends keyof ConfigFormulario[K]>(p: P, v: ConfigFormulario[K][P]) =>
      setF((x) => ({ ...x, [k]: { ...x[k], [p]: v } }));
  const boton = sec("boton");
  const formulario = sec("formulario");
  const campos = sec("campos");
  const botonEnviar = sec("botonEnviar");
  const mensajes = sec("mensajes");
  const pref = sec("preferencias");

  const cambiarBloque = (id: string, cambio: Partial<Bloque>) =>
    setF((x) => ({
      ...x,
      bloques: x.bloques.map((b) =>
        b.id === id ? ({ ...b, ...cambio } as Bloque) : b,
      ),
    }));
  const mover = (i: number, d: -1 | 1) =>
    setF((x) => {
      const j = i + d;
      if (j < 0 || j >= x.bloques.length) return x;
      const bloques = [...x.bloques];
      [bloques[i], bloques[j]] = [bloques[j], bloques[i]];
      return { ...x, bloques };
    });
  const quitar = (id: string) =>
    setF((x) => ({ ...x, bloques: x.bloques.filter((b) => b.id !== id) }));
  const agregar = (b: Bloque) => {
    setF((x) => {
      // Antes del botón de finalizar.
      const i = x.bloques.findIndex((y) => y.tipo === "enviar");
      const bloques = [...x.bloques];
      bloques.splice(i === -1 ? bloques.length : i, 0, b);
      return { ...x, bloques };
    });
    setAbierto(b.id);
  };

  return (
    <Page fullWidth>
      <TitleBar title="Constructor de formularios">
        <button
          variant="primary"
          disabled={guardar.state !== "idle"}
          onClick={() =>
            guardar.submit({ config: JSON.stringify(f) }, { method: "post" })
          }
        >
          Guardar
        </button>
      </TitleBar>
      <InlineGrid columns={{ xs: 1, md: "3fr 2fr", lg: "2fr 1fr" }} gap="400">
        <div>
          <BlockStack gap="400">
            {sinGuardar ? (
              <Banner tone="warning" title="Tienes cambios sin guardar">
                La vista previa ya los muestra; tu tienda cambiará cuando des
                clic en Guardar.
              </Banner>
            ) : (
              guardar.data &&
              "config" in guardar.data && (
                <Banner
                  tone="success"
                  title="Formulario guardado. Ya se ve así en tu tienda."
                />
              )
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Tipo de formulario
                </Text>
                <ChoiceList
                  title="Tipo de formulario"
                  titleHidden
                  choices={[
                    {
                      label: "Formulario emergente",
                      value: "emergente",
                      helpText:
                        "Se abre cuando el cliente toca el botón de compra de la app.",
                    },
                    {
                      label: "Formulario incrustado",
                      value: "incrustado",
                      helpText:
                        "Se muestra directamente en la página del producto, sin botón.",
                    },
                  ]}
                  selected={[f.tipo]}
                  onChange={([v]) =>
                    setF((x) => ({ ...x, tipo: v as ConfigFormulario["tipo"] }))
                  }
                />
              </BlockStack>
            </Card>

            {f.tipo === "emergente" && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Botón de compra
                  </Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Texto del botón"
                        value={f.boton.texto}
                        onChange={(v) => boton("texto", v)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Subtítulo del botón"
                        value={f.boton.subtitulo}
                        onChange={(v) => boton("subtitulo", v)}
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <Color
                        label="Color de fondo"
                        value={f.boton.fondo}
                        onChange={(v) => boton("fondo", v)}
                      />
                      <Color
                        label="Color del texto"
                        value={f.boton.colorTexto}
                        onChange={(v) => boton("colorTexto", v)}
                      />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <Select
                        label="Animación"
                        options={[
                          { label: "Ninguna", value: "ninguna" },
                          { label: "Sacudir", value: "sacudir" },
                          { label: "Pulso", value: "pulso" },
                          { label: "Rebote", value: "rebote" },
                        ]}
                        value={f.boton.animacion}
                        onChange={(v) =>
                          boton(
                            "animacion",
                            v as ConfigFormulario["boton"]["animacion"],
                          )
                        }
                      />
                      <TextField
                        label="Tamaño del texto"
                        type="number"
                        suffix="px"
                        value={String(f.boton.tamanoTexto)}
                        onChange={(v) => boton("tamanoTexto", Number(v))}
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                    <InlineStack gap="400">
                      <Checkbox
                        label="Negrita"
                        checked={f.boton.negrita}
                        onChange={(v) => boton("negrita", v)}
                      />
                      <Checkbox
                        label="Cursiva"
                        checked={f.boton.cursiva}
                        onChange={(v) => boton("cursiva", v)}
                      />
                    </InlineStack>
                    <FormLayout.Group>
                      <Color
                        label="Color del borde"
                        value={f.boton.colorBorde}
                        onChange={(v) => {
                          boton("colorBorde", v);
                          // Con ancho 0 el color no se vería: se le da un borde visible.
                          if (f.boton.anchoBorde === 0) boton("anchoBorde", 2);
                        }}
                      />
                      <RangeSlider
                        label="Ancho del borde"
                        min={0}
                        max={8}
                        value={f.boton.anchoBorde}
                        onChange={(v) => boton("anchoBorde", Number(v))}
                        output
                      />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <RangeSlider
                        label="Esquinas redondeadas"
                        min={0}
                        max={40}
                        value={Math.min(40, f.boton.radio)}
                        onChange={(v) => boton("radio", Number(v))}
                        output
                      />
                      <RangeSlider
                        label="Sombra"
                        min={0}
                        max={10}
                        value={f.boton.sombra}
                        onChange={(v) => boton("sombra", Number(v))}
                        output
                      />
                    </FormLayout.Group>
                  </FormLayout>
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Formulario
                </Text>
                <Text as="p" tone="subdued">
                  Ordena, oculta y edita los bloques. Los marcados como fijos
                  son necesarios para crear y validar el pedido.
                </Text>
                <BlockStack gap="200">
                  {f.bloques.map((b, i) => {
                    const fijo = BLOQUES_FIJOS.includes(b.id);
                    return (
                      <Box
                        key={b.id}
                        padding="300"
                        borderWidth="025"
                        borderColor="border"
                        borderRadius="200"
                        background={
                          b.oculto ? "bg-surface-secondary" : "bg-surface"
                        }
                      >
                        <BlockStack gap="300">
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                            wrap={false}
                            gap="200"
                          >
                            <InlineStack gap="200" blockAlign="center">
                              <Text
                                as="span"
                                fontWeight="semibold"
                                tone={b.oculto ? "subdued" : undefined}
                              >
                                {tituloBloque(b)}
                              </Text>
                              {fijo && <Badge>Fijo</Badge>}
                              {b.oculto && (
                                <Badge tone="attention">Oculto</Badge>
                              )}
                              {b.tipo === "campo" && b.requerido && !fijo && (
                                <Badge tone="info">Obligatorio</Badge>
                              )}
                            </InlineStack>
                            <ButtonGroup variant="segmented">
                              <Button
                                size="slim"
                                onClick={() => mover(i, -1)}
                                disabled={i === 0}
                                accessibilityLabel="Subir"
                              >
                                ↑
                              </Button>
                              <Button
                                size="slim"
                                onClick={() => mover(i, 1)}
                                disabled={i === f.bloques.length - 1}
                                accessibilityLabel="Bajar"
                              >
                                ↓
                              </Button>
                              <Button
                                size="slim"
                                onClick={() =>
                                  setAbierto(abierto === b.id ? null : b.id)
                                }
                              >
                                Editar
                              </Button>
                              {!fijo && (
                                <Button
                                  size="slim"
                                  onClick={() =>
                                    cambiarBloque(b.id, { oculto: !b.oculto })
                                  }
                                >
                                  {b.oculto ? "Mostrar" : "Ocultar"}
                                </Button>
                              )}
                              {!fijo && (
                                <Button
                                  size="slim"
                                  tone="critical"
                                  onClick={() => quitar(b.id)}
                                >
                                  Eliminar
                                </Button>
                              )}
                            </ButtonGroup>
                          </InlineStack>
                          {abierto === b.id && (
                            <EditorBloque
                              b={b}
                              fijo={fijo}
                              cambiar={(c) => cambiarBloque(b.id, c)}
                            />
                          )}
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
                <InlineStack gap="200">
                  <Button
                    onClick={() =>
                      agregar({
                        id: idNuevo("campo"),
                        tipo: "campo",
                        nombre: idNuevo("extra"),
                        tipoCampo: "texto",
                        etiqueta: "Nuevo campo",
                        placeholder: "",
                        requerido: false,
                        icono: "ninguno",
                      })
                    }
                  >
                    + Campo de texto
                  </Button>
                  <Button
                    onClick={() =>
                      agregar({
                        id: idNuevo("opciones"),
                        tipo: "campo",
                        nombre: idNuevo("extra"),
                        tipoCampo: "opciones",
                        etiqueta: "Elige una opción",
                        requerido: false,
                        icono: "ninguno",
                        opciones: ["Opción 1", "Opción 2"],
                      })
                    }
                  >
                    + Opciones
                  </Button>
                  <Button
                    onClick={() =>
                      agregar({
                        id: idNuevo("texto"),
                        tipo: "texto",
                        texto: "Nuevo texto",
                      })
                    }
                  >
                    + Texto
                  </Button>
                  <Button
                    onClick={() =>
                      agregar({
                        id: idNuevo("imagen"),
                        tipo: "imagen",
                        url: "",
                        alt: "",
                      })
                    }
                  >
                    + Imagen
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Plantillas
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() =>
                      setF((x) => ({
                        ...x,
                        formulario: FORMULARIO_POR_DEFECTO.formulario,
                        campos: FORMULARIO_POR_DEFECTO.campos,
                        botonEnviar: FORMULARIO_POR_DEFECTO.botonEnviar,
                      }))
                    }
                  >
                    Restaurar valores predeterminados
                  </Button>
                </InlineStack>
                <InlineGrid columns={{ xs: 2, md: 3 }} gap="300">
                  {PLANTILLAS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setF((x) => ({ ...x, ...p.estilos }))}
                      style={{
                        cursor: "pointer",
                        border:
                          plantillaActual === p.id
                            ? "3px solid #005bd3"
                            : "1px solid #d0d0d0",
                        borderRadius: 12,
                        padding: 12,
                        background: p.estilos.formulario.fondo,
                        color: p.estilos.formulario.colorTexto,
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          height: 10,
                          borderRadius: 4,
                          background: p.estilos.campos.fondoIcono,
                          marginBottom: 6,
                        }}
                      />
                      <div
                        style={{
                          height: 10,
                          borderRadius: 4,
                          background: p.estilos.campos.fondoIcono,
                          marginBottom: 10,
                        }}
                      />
                      <div
                        style={{
                          height: 16,
                          borderRadius: 8,
                          background: p.estilos.botonEnviar.fondo,
                          marginBottom: 8,
                        }}
                      />
                      <span style={{ fontSize: 13 }}>{p.nombre}</span>
                    </button>
                  ))}
                </InlineGrid>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Estilo del formulario
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <Color
                      label="Color del texto"
                      value={f.formulario.colorTexto}
                      onChange={(v) => formulario("colorTexto", v)}
                    />
                    <Color
                      label="Color de fondo"
                      value={f.formulario.fondo}
                      onChange={(v) => formulario("fondo", v)}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Tamaño del texto"
                      type="number"
                      suffix="px"
                      value={String(f.formulario.tamanoTexto)}
                      onChange={(v) => formulario("tamanoTexto", Number(v))}
                      autoComplete="off"
                    />
                    <Select
                      label="Alineación de etiquetas"
                      options={[
                        { label: "Arriba del campo", value: "arriba" },
                        { label: "A la izquierda", value: "izquierda" },
                      ]}
                      value={f.formulario.alineacionEtiquetas}
                      onChange={(v) =>
                        formulario(
                          "alineacionEtiquetas",
                          v as "arriba" | "izquierda",
                        )
                      }
                    />
                  </FormLayout.Group>
                  <InlineStack gap="400">
                    <Checkbox
                      label="Negrita"
                      checked={f.formulario.negrita}
                      onChange={(v) => formulario("negrita", v)}
                    />
                    <Checkbox
                      label="Cursiva"
                      checked={f.formulario.cursiva}
                      onChange={(v) => formulario("cursiva", v)}
                    />
                  </InlineStack>
                  <FormLayout.Group>
                    <Color
                      label="Color del borde"
                      value={f.formulario.colorBorde}
                      onChange={(v) => {
                        formulario("colorBorde", v);
                        if (f.formulario.anchoBorde === 0)
                          formulario("anchoBorde", 2);
                      }}
                    />
                    <RangeSlider
                      label="Ancho del borde"
                      min={0}
                      max={8}
                      value={f.formulario.anchoBorde}
                      onChange={(v) => formulario("anchoBorde", Number(v))}
                      output
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <RangeSlider
                      label="Esquinas redondeadas"
                      min={0}
                      max={40}
                      value={f.formulario.radio}
                      onChange={(v) => formulario("radio", Number(v))}
                      output
                    />
                    <RangeSlider
                      label="Sombra"
                      min={0}
                      max={10}
                      value={f.formulario.sombra}
                      onChange={(v) => formulario("sombra", Number(v))}
                      output
                    />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Estilo de campo
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <Color
                      label="Color del texto"
                      value={f.campos.colorTexto}
                      onChange={(v) => campos("colorTexto", v)}
                    />
                    <Color
                      label="Color de fondo"
                      value={f.campos.fondo}
                      onChange={(v) => campos("fondo", v)}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <Color
                      label="Color del ícono"
                      value={f.campos.colorIcono}
                      onChange={(v) => campos("colorIcono", v)}
                    />
                    <Color
                      label="Fondo del ícono"
                      value={f.campos.fondoIcono}
                      onChange={(v) => campos("fondoIcono", v)}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <Color
                      label="Color del borde"
                      value={f.campos.colorBorde}
                      onChange={(v) => campos("colorBorde", v)}
                    />
                    <RangeSlider
                      label="Esquinas redondeadas"
                      min={0}
                      max={30}
                      value={f.campos.radio}
                      onChange={(v) => campos("radio", Number(v))}
                      output
                    />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Botón de finalizar
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <Color
                      label="Color de fondo"
                      value={f.botonEnviar.fondo}
                      onChange={(v) => botonEnviar("fondo", v)}
                    />
                    <Color
                      label="Color del texto"
                      value={f.botonEnviar.colorTexto}
                      onChange={(v) => botonEnviar("colorTexto", v)}
                    />
                  </FormLayout.Group>
                  <RangeSlider
                    label="Esquinas redondeadas"
                    min={0}
                    max={40}
                    value={Math.min(40, f.botonEnviar.radio)}
                    onChange={(v) =>
                      botonEnviar("radio", Number(v) >= 40 ? 999 : Number(v))
                    }
                    output
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Preferencias
                </Text>
                <Checkbox
                  label="Ocultar etiqueta de campos"
                  checked={f.preferencias.ocultarEtiquetas}
                  onChange={(v) => pref("ocultarEtiquetas", v)}
                />
                <Checkbox
                  label="Mostrar el ícono del campo"
                  checked={f.preferencias.mostrarIconos}
                  onChange={(v) => pref("mostrarIconos", v)}
                />
                <Checkbox
                  label="Desactivar autocompletar"
                  checked={f.preferencias.desactivarAutocompletar}
                  onChange={(v) => pref("desactivarAutocompletar", v)}
                />
                <Checkbox
                  label="Pantalla completa en celulares"
                  checked={f.preferencias.pantallaCompletaMovil}
                  onChange={(v) => pref("pantallaCompletaMovil", v)}
                />
                <Checkbox
                  label="Ocultar botón de cerrar"
                  checked={f.preferencias.ocultarCerrar}
                  onChange={(v) => pref("ocultarCerrar", v)}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Mensajes de error del formulario
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Mensaje de campo requerido"
                      value={f.mensajes.requerido}
                      onChange={(v) => mensajes("requerido", v)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Mensaje de campo inválido"
                      value={f.mensajes.invalido}
                      onChange={(v) => mensajes("invalido", v)}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Etiqueta agotado"
                    value={f.mensajes.agotado}
                    onChange={(v) => mensajes("agotado", v)}
                    autoComplete="off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>
          </BlockStack>
        </div>

        <div style={{ minWidth: 0 }}>
          {/* Fija al desplazarse: se ve el cambio aunque estés editando abajo. */}
          <div style={{ position: "sticky", top: 16 }}>
            <Vista f={f} vista={inicial.vista} />
          </div>
        </div>
      </InlineGrid>
    </Page>
  );
}

function EditorBloque({
  b,
  fijo,
  cambiar,
}: {
  b: Bloque;
  fijo: boolean;
  cambiar: (c: Partial<Bloque>) => void;
}) {
  if (b.tipo === "campo") {
    return (
      <FormLayout>
        <FormLayout.Group>
          <TextField
            label="Etiqueta"
            value={b.etiqueta}
            onChange={(v) => cambiar({ etiqueta: v })}
            autoComplete="off"
          />
          {b.tipoCampo !== "opciones" &&
            b.tipoCampo !== "departamento" &&
            b.tipoCampo !== "ciudad" && (
              <TextField
                label="Texto de ejemplo (placeholder)"
                value={b.placeholder ?? ""}
                onChange={(v) => cambiar({ placeholder: v })}
                autoComplete="off"
              />
            )}
        </FormLayout.Group>
        {b.tipoCampo === "opciones" && (
          <TextField
            label="Opciones"
            helpText="Una por línea."
            multiline={3}
            value={(b.opciones ?? []).join("\n")}
            onChange={(v) => cambiar({ opciones: v.split("\n") })}
            autoComplete="off"
          />
        )}
        <FormLayout.Group>
          <Select
            label="Ícono"
            options={[
              { label: "Ninguno", value: "ninguno" },
              { label: "Persona", value: "persona" },
              { label: "Teléfono", value: "telefono" },
              { label: "Ubicación", value: "ubicacion" },
            ]}
            value={b.icono ?? "ninguno"}
            onChange={(v) => cambiar({ icono: v as typeof b.icono })}
          />
          <Checkbox
            label="Obligatorio"
            checked={b.requerido}
            disabled={fijo}
            helpText={fijo ? "Necesario para crear el pedido." : undefined}
            onChange={(v) => cambiar({ requerido: v })}
          />
        </FormLayout.Group>
      </FormLayout>
    );
  }
  if (b.tipo === "texto") {
    return (
      <TextField
        label="Texto"
        multiline={3}
        value={b.texto}
        onChange={(v) => cambiar({ texto: v })}
        autoComplete="off"
      />
    );
  }
  if (b.tipo === "imagen") {
    return (
      <TextField
        label="URL de la imagen"
        helpText="Debe empezar por https://. Puedes subirla en Contenido → Archivos de Shopify y copiar su enlace."
        value={b.url}
        onChange={(v) => cambiar({ url: v })}
        autoComplete="off"
      />
    );
  }
  if (b.tipo === "validacion") {
    return (
      <TextField
        label="Texto antes de validar el teléfono"
        multiline={3}
        value={b.textoInicial}
        onChange={(v) => cambiar({ textoInicial: v })}
        autoComplete="off"
      />
    );
  }
  if (b.tipo === "enviar") {
    return (
      <TextField
        label="Texto del botón"
        value={b.texto}
        onChange={(v) => cambiar({ texto: v })}
        autoComplete="off"
      />
    );
  }
  return (
    <Text as="p" tone="subdued">
      Este bloque no tiene opciones aquí.{" "}
      {b.tipo === "carrito" &&
        "Las ofertas y paquetes se configuran en su sección."}
    </Text>
  );
}

/** Campo de color: selector nativo para colores sólidos y texto libre para degradados. */
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      autoComplete="off"
      prefix={
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: 0,
            background: "none",
            cursor: "pointer",
          }}
        />
      }
    />
  );
}

/**
 * Vista previa con el mismo script y CSS del formulario de la tienda. El script se ejecuta
 * desde el propio bundle (sin descargas aparte) y el formulario se dibuja en un Shadow DOM,
 * para que los estilos del panel y los del formulario no se mezclen.
 */
function Vista({ f, vista }: { f: ConfigFormulario; vista: ArchivosVista }) {
  const anfitrion = useRef<HTMLDivElement>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raiz = prepararVistaPrevia(
        anfitrion.current!,
        vista,
        "#b{margin-bottom:12px}",
      );
      const boton = document.createElement("button");
      boton.type = "button";
      boton.id = "b";
      boton.className = "vd-boton";
      const texto = document.createElement("span");
      texto.className = "vd-boton-texto";
      boton.append(texto);
      const contenedor = document.createElement("div");
      contenedor.id = "c";
      raiz.append(boton, contenedor);
      setListo(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // Los archivos llegan una sola vez con la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listo) return;
    const t = setTimeout(() => {
      try {
        const raiz = anfitrion.current!.shadowRoot!;
        const boton = raiz.getElementById("b")!;
        boton.hidden = f.tipo !== "emergente";
        if (!boton.hidden) window.ValidataPreview!.estiloBoton(boton, f.boton);
        window.ValidataPreview!.montar(
          raiz.getElementById("c")!,
          f,
          vista.deptos,
        );
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, f]);

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
        Prueba el teléfono: termina en 0 para ver pago previo, en 9 para
        WhatsApp, o cualquier otro para contraentrega.
      </Text>
    </BlockStack>
  );
}

/** Si la página falla, se muestra el motivo en lugar de quedar en blanco o volver al inicio. */
export function ErrorBoundary() {
  const error = useRouteError();
  const mensaje = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return (
    <Page>
      <Banner
        tone="critical"
        title="El Constructor de formularios no pudo abrir"
      >
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
          {mensaje.slice(0, 1500)}
        </pre>
      </Banner>
    </Page>
  );
}
