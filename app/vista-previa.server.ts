// Archivos del formulario de la tienda para la vista previa del Constructor.
// Se leen del disco en el servidor y viajan con los datos de la página: `shopify app dev`
// reserva las rutas /extensions/* del túnel, así que el navegador no puede pedirlos directo.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CARPETA = resolve(process.cwd(), "extensions/formulario-cod/assets");

let cache: Promise<{
  js: string;
  css: string;
  deptos: Record<string, string[]>;
}> | null = null;

export function archivosVistaPrevia() {
  // En desarrollo se relee siempre para ver los cambios del script sin reiniciar.
  if (!cache || process.env.NODE_ENV !== "production") {
    cache = Promise.all([
      readFile(resolve(CARPETA, "formulario.js"), "utf8"),
      readFile(resolve(CARPETA, "formulario.css"), "utf8"),
      readFile(resolve(CARPETA, "colombia.json"), "utf8"),
    ]).then(([js, css, deptos]) => ({ js, css, deptos: JSON.parse(deptos) }));
  }
  return cache;
}
