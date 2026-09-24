// Configuración del formulario que edita el "Constructor de formularios".
// Se guarda como JSON por tienda y la usan tanto la vista previa del panel como
// el script de la tienda (extensions/formulario-cod/assets/formulario.js).

export type TipoFormulario = "emergente" | "incrustado";
export type Icono = "persona" | "telefono" | "ubicacion" | "correo" | "ninguno";
export type Animacion = "ninguna" | "sacudir" | "pulso" | "rebote";

export interface EstiloBoton {
  texto: string;
  subtitulo: string;
  /** Color sólido o linear-gradient(...). */
  fondo: string;
  colorTexto: string;
  tamanoTexto: number;
  negrita: boolean;
  cursiva: boolean;
  colorBorde: string;
  anchoBorde: number;
  radio: number;
  sombra: number;
  animacion: Animacion;
}

export type TipoCampo =
  | "texto"
  | "telefono"
  | "correo"
  | "departamento"
  | "ciudad"
  | "opciones"
  | "casilla";

export type Bloque =
  | { id: string; tipo: "carrito"; oculto?: boolean }
  | { id: string; tipo: "resumen"; oculto?: boolean }
  | { id: string; tipo: "envio"; oculto?: boolean }
  | { id: string; tipo: "imagen"; oculto?: boolean; url: string; alt?: string }
  | { id: string; tipo: "texto"; oculto?: boolean; texto: string }
  | {
      id: string;
      tipo: "campo";
      oculto?: boolean;
      /** Clave con la que llega el dato al crear el pedido. */
      nombre: string;
      tipoCampo: TipoCampo;
      etiqueta: string;
      placeholder?: string;
      requerido: boolean;
      icono?: Icono;
      /** Para "opciones": selección única o múltiple. */
      opciones?: string[];
      multiple?: boolean;
    }
  /** Recuadro que muestra el resultado de la validación por teléfono. */
  | { id: string; tipo: "validacion"; oculto?: boolean; textoInicial: string }
  | {
      id: string;
      tipo: "upsell";
      oculto?: boolean;
      productoId?: string;
      texto: string;
    }
  | { id: string; tipo: "enviar"; oculto?: boolean; texto: string };

export interface ConfigFormulario {
  tipo: TipoFormulario;
  paises: string[];
  boton: EstiloBoton;
  formulario: {
    colorTexto: string;
    tamanoTexto: number;
    negrita: boolean;
    cursiva: boolean;
    alineacionEtiquetas: "arriba" | "izquierda";
    fondo: string;
    colorBorde: string;
    anchoBorde: number;
    radio: number;
    sombra: number;
  };
  campos: {
    colorTexto: string;
    fondo: string;
    colorIcono: string;
    fondoIcono: string;
    colorBorde: string;
    radio: number;
  };
  preferencias: {
    ocultarEtiquetas: boolean;
    mostrarIconos: boolean;
    desactivarAutocompletar: boolean;
    pantallaCompletaMovil: boolean;
    ocultarCerrar: boolean;
    botonFijo: {
      activo: boolean;
      posicion: "inferior" | "superior";
      siempreVisible: boolean;
      escritorio: boolean;
    };
  };
  /** Botón que envía el formulario ("Finalizar mi pedido"). */
  botonEnviar: { fondo: string; colorTexto: string; radio: number };
  mensajes: { requerido: string; invalido: string; agotado: string };
  bloques: Bloque[];
}

const campo = (
  nombre: string,
  tipoCampo: TipoCampo,
  etiqueta: string,
  extra: Partial<Extract<Bloque, { tipo: "campo" }>> = {},
): Bloque => ({
  id: nombre,
  tipo: "campo",
  nombre,
  tipoCampo,
  etiqueta,
  requerido: true,
  ...extra,
});

/** Formulario por defecto: el mismo orden que usan hoy tus tiendas en EasySell. */
export const FORMULARIO_POR_DEFECTO: ConfigFormulario = {
  tipo: "emergente",
  paises: ["CO"],
  boton: {
    texto: "Pedir ahora Pagar en Casa",
    subtitulo: "🚚 Envío gratis a toda Colombia",
    fondo: "linear-gradient(90deg, #6ee7b7, #10b981)",
    colorTexto: "#ffffff",
    tamanoTexto: 16,
    negrita: true,
    cursiva: false,
    colorBorde: "#6ee7b7",
    anchoBorde: 0,
    radio: 12,
    sombra: 2,
    animacion: "sacudir",
  },
  formulario: {
    colorTexto: "#111111",
    tamanoTexto: 16,
    negrita: false,
    cursiva: false,
    alineacionEtiquetas: "arriba",
    fondo: "#ffffff",
    colorBorde: "#111111",
    anchoBorde: 0,
    radio: 16,
    sombra: 3,
  },
  campos: {
    colorTexto: "#111111",
    fondo: "#ffffff",
    colorIcono: "#111111",
    fondoIcono: "#eeeeee",
    colorBorde: "#111111",
    radio: 0,
  },
  preferencias: {
    ocultarEtiquetas: false,
    mostrarIconos: true,
    desactivarAutocompletar: false,
    pantallaCompletaMovil: false,
    ocultarCerrar: false,
    botonFijo: {
      activo: true,
      posicion: "inferior",
      siempreVisible: false,
      escritorio: false,
    },
  },
  botonEnviar: {
    fondo: "linear-gradient(90deg, #60a5fa, #2563eb)",
    colorTexto: "#ffffff",
    radio: 999,
  },
  mensajes: {
    requerido: "Este campo es obligatorio",
    invalido: "Revisa este dato",
    agotado: "Agotado",
  },
  bloques: [
    { id: "carrito", tipo: "carrito" },
    { id: "resumen", tipo: "resumen" },
    { id: "envio", tipo: "envio", oculto: true },
    {
      id: "intro",
      tipo: "texto",
      texto: "Favor ingresar tus datos para realizar el pedido",
    },
    campo("nombre", "texto", "Nombres", {
      placeholder: "Nombres",
      icono: "persona",
    }),
    campo("apellido", "texto", "Apellidos", {
      placeholder: "Apellidos",
      icono: "persona",
    }),
    campo(
      "telefono",
      "telefono",
      "Número de WhatsApp (notificaciones de envío)",
      {
        placeholder: "WhatsApp (ingresa tu celular)",
        icono: "telefono",
      },
    ),
    {
      id: "validacion",
      tipo: "validacion",
      textoInicial:
        "Los pedidos contraentrega están sujetos a validación del historial de entregas. Ingresa tu número para verificar.",
    },
    campo("direccion", "texto", "Dirección completa", {
      placeholder: "Ej: Cl 13 # 20-35",
      icono: "ubicacion",
    }),
    campo("direccion2", "texto", "Conjunto / Torre / Apto / Casa / Piso", {
      placeholder: "Conjunto / Torre / Apartamento / Casa",
      icono: "ubicacion",
    }),
    campo("barrio", "texto", "Barrio", {
      placeholder: "Nombre del barrio. Ej: Modelia",
    }),
    campo("departamento", "departamento", "Departamento"),
    campo("ciudad", "ciudad", "Ciudad"),
    campo("horario", "opciones", "Horario para recibir", {
      opciones: ["Entre 8 am y 12 pm", "Entre 12 pm y 6 pm"],
    }),
    {
      id: "upsell",
      tipo: "upsell",
      texto: "Agrega otra unidad con descuento",
      oculto: true,
    },
    {
      id: "enviar",
      tipo: "enviar",
      texto: "FINALIZAR MI PEDIDO CON ENVÍO GRATIS",
    },
  ],
};

// ─── Campos fijos ────────────────────────────────────────────────────────────

/**
 * Bloques sin los que el pedido no se puede crear o validar. El constructor no deja borrarlos
 * ni ocultarlos, y normalizarFormulario los repone si faltan.
 */
export const BLOQUES_FIJOS = [
  "nombre",
  "telefono",
  "direccion",
  "departamento",
  "ciudad",
  "validacion",
  "enviar",
];

/** Campos que el servidor ya conoce; los que agrega el comerciante van con prefijo "extra_". */
export const CAMPOS_CONOCIDOS = [
  "nombre",
  "apellido",
  "telefono",
  "direccion",
  "direccion2",
  "barrio",
  "departamento",
  "ciudad",
  "horario",
];

// ─── Plantillas de color ─────────────────────────────────────────────────────

type Estilos = Pick<ConfigFormulario, "formulario" | "campos" | "botonEnviar">;
const plantilla = (
  fondo: string,
  texto: string,
  borde: string,
  fondoCampo: string,
  fondoIcono: string,
  boton: string,
): Estilos => ({
  formulario: {
    ...FORMULARIO_POR_DEFECTO.formulario,
    fondo,
    colorTexto: texto,
    colorBorde: borde,
  },
  campos: {
    ...FORMULARIO_POR_DEFECTO.campos,
    colorTexto: texto,
    fondo: fondoCampo,
    colorIcono: texto,
    fondoIcono,
    colorBorde: borde,
  },
  botonEnviar: { ...FORMULARIO_POR_DEFECTO.botonEnviar, fondo: boton },
});

export const PLANTILLAS: { id: string; nombre: string; estilos: Estilos }[] = [
  {
    id: "clean",
    nombre: "Clean",
    estilos: plantilla(
      "#ffffff",
      "#111111",
      "#111111",
      "#ffffff",
      "#eeeeee",
      "linear-gradient(90deg, #60a5fa, #2563eb)",
    ),
  },
  {
    id: "sunset",
    nombre: "Sunset Glow",
    estilos: plantilla(
      "#fff7ed",
      "#431407",
      "#fdba74",
      "#ffffff",
      "#ffedd5",
      "linear-gradient(90deg, #fb923c, #ea580c)",
    ),
  },
  {
    id: "ocean",
    nombre: "Ocean Breeze",
    estilos: plantilla(
      "#f0fdfa",
      "#134e4a",
      "#99f6e4",
      "#ffffff",
      "#ccfbf1",
      "linear-gradient(90deg, #2dd4bf, #0284c7)",
    ),
  },
  {
    id: "midnight",
    nombre: "Midnight Luxe",
    estilos: plantilla(
      "#0f172a",
      "#f8fafc",
      "#334155",
      "#1e293b",
      "#334155",
      "linear-gradient(90deg, #8b5cf6, #3b82f6)",
    ),
  },
  {
    id: "rose",
    nombre: "Rose Petal",
    estilos: plantilla(
      "#fff1f2",
      "#4c0519",
      "#fda4af",
      "#ffffff",
      "#ffe4e6",
      "linear-gradient(90deg, #f472b6, #e11d48)",
    ),
  },
  {
    id: "forest",
    nombre: "Forest Mint",
    estilos: plantilla(
      "#f0fdf4",
      "#14532d",
      "#86efac",
      "#ffffff",
      "#dcfce7",
      "linear-gradient(90deg, #4ade80, #16a34a)",
    ),
  },
];

// ─── Normalización ───────────────────────────────────────────────────────────
// Todo lo que guarda el constructor pasa por aquí antes de llegar a la tienda: los colores
// terminan en estilos CSS y los textos en la página del cliente.

const COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|(linear|radial)-gradient\((?:[\w\s.,%#-]|\([\d\s.,%]+\))+\))$/i;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const color = (v: unknown, def: string) =>
  typeof v === "string" && v.length <= 200 && COLOR.test(v.trim())
    ? v.trim()
    : def;
const texto = (v: unknown, def: string, max = 200) =>
  typeof v === "string" ? v.slice(0, max) : def;
const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
const uno = <T extends string>(
  v: unknown,
  opciones: readonly T[],
  def: T,
): T => (opciones.includes(v as T) ? (v as T) : def);

const TIPOS_CAMPO: TipoCampo[] = [
  "texto",
  "telefono",
  "correo",
  "departamento",
  "ciudad",
  "opciones",
  "casilla",
];
const ICONOS: Icono[] = [
  "persona",
  "telefono",
  "ubicacion",
  "correo",
  "ninguno",
];

function normalizarBloque(v: unknown): Bloque | null {
  const b = obj(v);
  const id =
    typeof b.id === "string" && /^[\w-]{1,40}$/.test(b.id) ? b.id : null;
  if (!id) return null;
  const oculto = BLOQUES_FIJOS.includes(id) ? false : bool(b.oculto, false);
  switch (b.tipo) {
    case "carrito":
    case "resumen":
    case "envio":
      return { id, tipo: b.tipo, oculto };
    case "imagen": {
      const url = texto(b.url, "", 500);
      return {
        id,
        tipo: "imagen",
        oculto,
        url: /^https:\/\//.test(url) ? url : "",
        alt: texto(b.alt, "", 120),
      };
    }
    case "texto":
      return { id, tipo: "texto", oculto, texto: texto(b.texto, "", 500) };
    case "validacion":
      return {
        id,
        tipo: "validacion",
        oculto,
        textoInicial: texto(b.textoInicial, "", 400),
      };
    case "upsell":
      return { id, tipo: "upsell", oculto, texto: texto(b.texto, "", 200) };
    case "enviar":
      return {
        id,
        tipo: "enviar",
        oculto,
        texto: texto(b.texto, "Finalizar pedido", 80) || "Finalizar pedido",
      };
    case "campo": {
      const nombre = typeof b.nombre === "string" ? b.nombre : "";
      // Solo nombres que el servidor conoce o campos propios con prefijo extra_.
      if (
        !CAMPOS_CONOCIDOS.includes(nombre) &&
        !/^extra_\w{1,30}$/.test(nombre)
      )
        return null;
      const tipoCampo = uno(b.tipoCampo, TIPOS_CAMPO, "texto");
      return {
        id,
        tipo: "campo",
        oculto,
        nombre,
        tipoCampo,
        etiqueta: texto(b.etiqueta, nombre, 120),
        placeholder: texto(b.placeholder, "", 120),
        requerido: BLOQUES_FIJOS.includes(id) ? true : bool(b.requerido, false),
        icono: uno(b.icono, ICONOS, "ninguno"),
        ...(tipoCampo === "opciones"
          ? {
              opciones: (Array.isArray(b.opciones) ? b.opciones : [])
                .filter(
                  (o): o is string => typeof o === "string" && o.trim() !== "",
                )
                .slice(0, 10)
                .map((o) => o.slice(0, 80)),
            }
          : {}),
      };
    }
    default:
      return null;
  }
}

export function normalizarFormulario(entrada: unknown): ConfigFormulario {
  const d = FORMULARIO_POR_DEFECTO;
  const e = obj(entrada);
  const bt = obj(e.boton);
  const fo = obj(e.formulario);
  const ca = obj(e.campos);
  const pr = obj(e.preferencias);
  const bf = obj(pr.botonFijo);
  const be = obj(e.botonEnviar);
  const me = obj(e.mensajes);

  const vistos = new Set<string>();
  const bloques = (Array.isArray(e.bloques) ? e.bloques : d.bloques)
    .slice(0, 40)
    .map(normalizarBloque)
    .filter((b): b is Bloque => !!b && !vistos.has(b.id) && !!vistos.add(b.id));
  // Repone los bloques fijos que falten, en su posición por defecto relativa.
  for (const id of BLOQUES_FIJOS) {
    if (vistos.has(id)) continue;
    const original = d.bloques.find((b) => b.id === id)!;
    const antes = d.bloques
      .slice(0, d.bloques.indexOf(original))
      .map((b) => b.id);
    const pos =
      Math.max(-1, ...antes.map((a) => bloques.findIndex((b) => b.id === a))) +
      1;
    bloques.splice(pos, 0, original);
    vistos.add(id);
  }

  return {
    tipo: uno(e.tipo, ["emergente", "incrustado"] as const, d.tipo),
    paises: ["CO"],
    boton: {
      texto: texto(bt.texto, d.boton.texto, 80),
      subtitulo: texto(bt.subtitulo, d.boton.subtitulo, 120),
      fondo: color(bt.fondo, d.boton.fondo),
      colorTexto: color(bt.colorTexto, d.boton.colorTexto),
      tamanoTexto: num(bt.tamanoTexto, 10, 32, d.boton.tamanoTexto),
      negrita: bool(bt.negrita, d.boton.negrita),
      cursiva: bool(bt.cursiva, d.boton.cursiva),
      colorBorde: color(bt.colorBorde, d.boton.colorBorde),
      anchoBorde: num(bt.anchoBorde, 0, 8, d.boton.anchoBorde),
      radio: num(bt.radio, 0, 999, d.boton.radio),
      sombra: num(bt.sombra, 0, 10, d.boton.sombra),
      animacion: uno(
        bt.animacion,
        ["ninguna", "sacudir", "pulso", "rebote"] as const,
        d.boton.animacion,
      ),
    },
    formulario: {
      colorTexto: color(fo.colorTexto, d.formulario.colorTexto),
      tamanoTexto: num(fo.tamanoTexto, 12, 24, d.formulario.tamanoTexto),
      negrita: bool(fo.negrita, d.formulario.negrita),
      cursiva: bool(fo.cursiva, d.formulario.cursiva),
      alineacionEtiquetas: uno(
        fo.alineacionEtiquetas,
        ["arriba", "izquierda"] as const,
        d.formulario.alineacionEtiquetas,
      ),
      fondo: color(fo.fondo, d.formulario.fondo),
      colorBorde: color(fo.colorBorde, d.formulario.colorBorde),
      anchoBorde: num(fo.anchoBorde, 0, 8, d.formulario.anchoBorde),
      radio: num(fo.radio, 0, 40, d.formulario.radio),
      sombra: num(fo.sombra, 0, 10, d.formulario.sombra),
    },
    campos: {
      colorTexto: color(ca.colorTexto, d.campos.colorTexto),
      fondo: color(ca.fondo, d.campos.fondo),
      colorIcono: color(ca.colorIcono, d.campos.colorIcono),
      fondoIcono: color(ca.fondoIcono, d.campos.fondoIcono),
      colorBorde: color(ca.colorBorde, d.campos.colorBorde),
      radio: num(ca.radio, 0, 30, d.campos.radio),
    },
    preferencias: {
      ocultarEtiquetas: bool(
        pr.ocultarEtiquetas,
        d.preferencias.ocultarEtiquetas,
      ),
      mostrarIconos: bool(pr.mostrarIconos, d.preferencias.mostrarIconos),
      desactivarAutocompletar: bool(
        pr.desactivarAutocompletar,
        d.preferencias.desactivarAutocompletar,
      ),
      pantallaCompletaMovil: bool(
        pr.pantallaCompletaMovil,
        d.preferencias.pantallaCompletaMovil,
      ),
      ocultarCerrar: bool(pr.ocultarCerrar, d.preferencias.ocultarCerrar),
      botonFijo: {
        activo: bool(bf.activo, d.preferencias.botonFijo.activo),
        posicion: uno(
          bf.posicion,
          ["inferior", "superior"] as const,
          d.preferencias.botonFijo.posicion,
        ),
        siempreVisible: bool(
          bf.siempreVisible,
          d.preferencias.botonFijo.siempreVisible,
        ),
        escritorio: bool(bf.escritorio, d.preferencias.botonFijo.escritorio),
      },
    },
    botonEnviar: {
      fondo: color(be.fondo, d.botonEnviar.fondo),
      colorTexto: color(be.colorTexto, d.botonEnviar.colorTexto),
      radio: num(be.radio, 0, 999, d.botonEnviar.radio),
    },
    mensajes: {
      requerido:
        texto(me.requerido, d.mensajes.requerido, 120) || d.mensajes.requerido,
      invalido:
        texto(me.invalido, d.mensajes.invalido, 120) || d.mensajes.invalido,
      agotado: texto(me.agotado, d.mensajes.agotado, 60) || d.mensajes.agotado,
    },
    bloques,
  };
}
