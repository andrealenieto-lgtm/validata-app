// Fuentes de historial por teléfono: el historial propio de la tienda y bases externas
// (p. ej. una red con +100.000 órdenes). El motor recibe una sola Estadisticas combinada.

import type { Estadisticas } from "./historial.ts";

export interface FuenteHistorial {
  nombre: string;
  /** Devuelve null si la fuente no conoce el teléfono. */
  consultar(telefonoE164: string): Promise<Estadisticas | null>;
}

export interface ResultadoFuentes {
  estadisticas: Estadisticas | null;
  /** Fuentes que respondieron con datos. */
  usadas: string[];
  /** Fuentes que fallaron o no respondieron a tiempo. */
  fallidas: string[];
}

const conLimite = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);

/**
 * Consulta todas las fuentes en paralelo. Una fuente caída o lenta no bloquea el formulario:
 * se decide con lo que haya respondido.
 *
 * No se suman las fuentes, porque los pedidos de la tienda suelen estar también en la base
 * externa y se contarían dos veces. Se toma la fuente con más pedidos terminados (la vista
 * más completa) y la racha de devoluciones más alta que reporte cualquiera.
 */
export async function consultarFuentes(
  telefonoE164: string,
  fuentes: FuenteHistorial[],
  timeoutMs = 1500,
): Promise<ResultadoFuentes> {
  const respuestas = await Promise.allSettled(
    fuentes.map((f) => conLimite(f.consultar(telefonoE164), timeoutMs)),
  );

  const usadas: string[] = [];
  const fallidas: string[] = [];
  const datos: Estadisticas[] = [];
  respuestas.forEach((r, i) => {
    if (r.status === "rejected") fallidas.push(fuentes[i].nombre);
    else if (r.value) {
      usadas.push(fuentes[i].nombre);
      datos.push(r.value);
    }
  });

  if (!datos.length) return { estadisticas: null, usadas, fallidas };

  const mejor = datos.reduce((a, b) => (b.terminados > a.terminados ? b : a));
  return {
    estadisticas: {
      ...mejor,
      devolucionesSeguidas: Math.max(...datos.map((d) => d.devolucionesSeguidas)),
    },
    usadas,
    fallidas,
  };
}

/** Fuente HTTP genérica para una base externa. El contrato de la API se define con el proveedor. */
export function fuenteHttp(opciones: {
  nombre: string;
  url: string;
  apiKey: string;
}): FuenteHistorial {
  return {
    nombre: opciones.nombre,
    async consultar(telefono) {
      const res = await fetch(opciones.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opciones.apiKey}` },
        body: JSON.stringify({ telefono }),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${opciones.nombre}: HTTP ${res.status}`);
      const d = (await res.json()) as { entregas: number; devoluciones: number; devolucionesSeguidas?: number };
      return desdeTotales(d.entregas, d.devoluciones, d.devolucionesSeguidas);
    },
  };
}

/** Estadísticas a partir de totales ya agregados (APIs externas, huella de Dropi). */
export function desdeTotales(entregas: unknown, devoluciones: unknown, devolucionesSeguidas?: unknown): Estadisticas {
  const e = Math.max(0, Number(entregas) || 0);
  const d = Math.max(0, Number(devoluciones) || 0);
  const terminados = e + d;
  return {
    entregas: e,
    devoluciones: d,
    terminados,
    tasaDevolucion: terminados ? (d / terminados) * 100 : 0,
    devolucionesSeguidas: Math.max(0, Number(devolucionesSeguidas) || 0),
  };
}

/**
 * Huella de Dropi guardada por el agente confirmador. Trae totales de toda la red Dropi pero no
 * el orden de los pedidos, así que no aporta devoluciones seguidas (esa regla sigue saliendo del
 * historial propio de la tienda). Una huella más vieja que `maxDias` se ignora.
 */
export function fuenteHuellaDropi(
  buscar: (telefono: string) => Promise<{ entregas: number; devoluciones: number; capturada: Date } | null>,
  maxDias = 180,
  ahora = () => Date.now(),
): FuenteHistorial {
  return {
    nombre: "huella_dropi",
    async consultar(telefono) {
      const h = await buscar(telefono);
      if (!h || ahora() - h.capturada.getTime() > maxDias * 86_400_000) return null;
      return desdeTotales(h.entregas, h.devoluciones);
    },
  };
}
