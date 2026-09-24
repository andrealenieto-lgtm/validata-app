// Lo común de las vistas previas del panel (Constructor de formularios y Ofertas): ejecutar el
// script del formulario de la tienda y dibujar dentro de un Shadow DOM, para que los estilos
// del panel y los del formulario no se mezclen.

import type { ConfigFormulario } from "../lib/formulario/esquema.ts";
import type { OfertaCantidad } from "../lib/ofertas.ts";

/** Paquete como lo dibuja el formulario de la tienda (ya calculado). */
export interface PaqueteVista {
  id: string;
  titulo: string;
  subtitulo: string;
  etiqueta: string;
  textoPrecioEstandar: string;
  porDefecto: boolean;
  plantilla: "horizontal" | "vertical";
  diseno: OfertaCantidad["diseno"];
  total: number;
  antes: number;
  productos: {
    titulo: string;
    cantidad: number;
    imagen: string | null;
    total: number;
    antes: number;
  }[];
}

/** Archivos del formulario de la tienda que el servidor manda con la página (vista-previa.server.ts). */
export interface ArchivosVista {
  js: string;
  css: string;
  deptos: Record<string, string[]>;
}

declare global {
  interface Window {
    ValidataPreview?: {
      montar: (
        contenedor: HTMLElement,
        f: ConfigFormulario,
        deptos: Record<string, string[]>,
        oferta?: OfertaCantidad | null,
        paquete?: unknown,
        extras?: unknown,
        integ?: unknown,
      ) => void;
      estiloBoton: (boton: HTMLElement, b: ConfigFormulario["boton"]) => void;
      montarPaquete: (
        contenedor: HTMLElement,
        paquete: PaqueteVista,
        producto: { titulo: string; precio: number; comparacion?: number },
      ) => void;
      montarOferta: (
        contenedor: HTMLElement,
        oferta: OfertaCantidad,
        precio?: number,
      ) => void;
    };
  }
}

/**
 * Carga el script (una vez por página) y prepara la caja aislada con los estilos.
 * `extraCss` permite ajustes propios de cada vista previa.
 */
export function prepararVistaPrevia(
  host: HTMLElement,
  vista: ArchivosVista,
  extraCss = "",
): ShadowRoot {
  if (!window.ValidataPreview) {
    const s = document.createElement("script");
    s.textContent = vista.js;
    document.head.append(s);
  }
  if (!window.ValidataPreview)
    throw new Error("El script del formulario no se cargó");
  const raiz = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  raiz.innerHTML = "";
  const estilo = document.createElement("style");
  estilo.textContent = `${vista.css}\n${extraCss}`;
  raiz.append(estilo);
  return raiz;
}
