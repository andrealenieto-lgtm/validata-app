// Importa el historial de pedidos desde un CSV (export de Dropi u otra plataforma).
// Detecta solas las columnas de teléfono, estado, fecha y número de orden por su nombre.

import { createHash } from "node:crypto";
import { clasificarEstado } from "./reglas/historial.ts";
import { normalizarTelefono } from "./reglas/telefono.ts";

export interface FilaImportada {
  telefono: string; // E.164
  estado: string;
  fecha: Date | null;
  referencia: string;
}

export interface ResultadoImportacion {
  filas: FilaImportada[];
  columnas: { telefono: string; estado: string; fecha: string | null; referencia: string | null };
  totalFilas: number;
  sinTelefono: number;
  sinEstado: number;
  entregados: number;
  devueltos: number;
  otros: number;
}

export class ErrorImportacion extends Error {}

/** CSV con comillas, separador , ; o tabulador y BOM de Excel. */
export function parsearCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primera = t.slice(0, t.indexOf("\n") >>> 0 || t.length);
  const sep = [";", "\t", ","].reduce((a, b) => (primera.split(b).length > primera.split(a).length ? b : a), ",");

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim())) filas.push(fila);
  return filas;
}

const clave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// En orden de preferencia: la primera columna que coincida gana.
const ALIAS = {
  telefono: ["telefono", "celular", "telefono cliente", "telefono del cliente", "phone", "movil", "tel", "whatsapp"],
  estado: ["estado", "estatus", "estado dropi", "status", "estado de la orden", "estado del pedido", "estado guia"],
  fecha: ["fecha", "fecha de creacion", "fecha creacion", "created at", "fecha orden", "fecha del pedido"],
  referencia: ["id", "numero orden", "numero de orden", "orden", "order", "order id", "pedido", "numero guia", "guia"],
};

function buscarColumna(encabezados: string[], alias: string[]): number {
  const claves = encabezados.map(clave);
  for (const a of alias) {
    const i = claves.indexOf(a);
    if (i !== -1) return i;
  }
  // Coincidencia parcial ("TELÉFONO CLIENTE 1", "ESTATUS ACTUAL") como último recurso.
  for (const a of alias.filter((x) => x.length > 3)) {
    const i = claves.findIndex((c) => c.startsWith(a));
    if (i !== -1) return i;
  }
  return -1;
}

/** Acepta 2026-07-11, 11/07/2026, 11-07-2026 10:22 (día primero, como en Colombia). */
export function parsearFecha(v: string): Date | null {
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fechaValida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return fechaValida(+m[3], +m[2], +m[1]);
  return null;
}

function fechaValida(a: number, mes: number, d: number): Date | null {
  const f = new Date(Date.UTC(a, mes - 1, d, 12));
  return f.getUTCMonth() === mes - 1 && f.getUTCDate() === d ? f : null;
}

export function importarHistorial(texto: string, indicativoPais = "57"): ResultadoImportacion {
  const [encabezados, ...datos] = parsearCsv(texto);
  if (!encabezados || !datos.length) throw new ErrorImportacion("El archivo está vacío.");

  const iTel = buscarColumna(encabezados, ALIAS.telefono);
  const iEst = buscarColumna(encabezados, ALIAS.estado);
  if (iTel === -1) throw new ErrorImportacion("No encontré la columna de teléfono.");
  if (iEst === -1) throw new ErrorImportacion("No encontré la columna de estado.");
  const iFec = buscarColumna(encabezados, ALIAS.fecha);
  const iRef = buscarColumna(encabezados, ALIAS.referencia);

  const r: ResultadoImportacion = {
    filas: [],
    columnas: {
      telefono: encabezados[iTel],
      estado: encabezados[iEst],
      fecha: iFec === -1 ? null : encabezados[iFec],
      referencia: iRef === -1 ? null : encabezados[iRef],
    },
    totalFilas: datos.length,
    sinTelefono: 0,
    sinEstado: 0,
    entregados: 0,
    devueltos: 0,
    otros: 0,
  };

  for (const f of datos) {
    const telefono = normalizarTelefono(f[iTel] ?? "", indicativoPais);
    const estado = (f[iEst] ?? "").trim();
    if (!telefono) {
      r.sinTelefono++;
      continue;
    }
    if (!estado) {
      r.sinEstado++;
      continue;
    }
    const tipo = clasificarEstado(estado);
    if (tipo === "entregado") r.entregados++;
    else if (tipo === "devuelto") r.devueltos++;
    else r.otros++;

    // Sin número de orden, la referencia es un hash de la fila: reimportar el mismo archivo no duplica.
    const ref = iRef !== -1 ? (f[iRef] ?? "").trim() : "";
    r.filas.push({
      telefono,
      estado,
      fecha: iFec === -1 ? null : parsearFecha(f[iFec] ?? ""),
      referencia: ref || createHash("sha1").update(f.join("\u0001")).digest("hex").slice(0, 20),
    });
  }
  return r;
}
