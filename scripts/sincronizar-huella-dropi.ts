// Copia a Validata la huella de Dropi que el agente confirmador guardó en su base SQLite.
// Solo lee (modo read-only); nunca modifica la base del confirmador.
//
// Uso:
//   npm run huella -- --shop prueba-dj5ottiu.myshopify.com [--db ruta/a/dropi_agent.db]

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import prismaPkg from "@prisma/client";

import { normalizarTelefono } from "../app/lib/reglas/telefono.ts";

const { values } = parseArgs({
  options: {
    shop: { type: "string" },
    db: { type: "string", default: resolve(import.meta.dirname, "../../files/data/dropi_agent.db") },
  },
});

if (!values.shop?.endsWith(".myshopify.com")) {
  console.error("Falta --shop (ej. --shop prueba-dj5ottiu.myshopify.com)");
  process.exit(1);
}
const db = values.db!;
if (!existsSync(db)) {
  console.error(`No existe la base del confirmador: ${db}`);
  process.exit(1);
}

// La huella más reciente de cada teléfono.
const consulta = `
  SELECT c.telefono, c.huella_entregados AS entregas, c.huella_devueltos AS devoluciones,
         c.fecha_procesado AS capturada
  FROM confirmaciones c
  JOIN (SELECT telefono, MAX(fecha_procesado) AS f FROM confirmaciones
        WHERE huella_despachados IS NOT NULL GROUP BY telefono) u
    ON u.telefono = c.telefono AND u.f = c.fecha_procesado`;

const salida = execFileSync("sqlite3", ["-json", `file:${db}?mode=ro`, consulta], { encoding: "utf8" });
const filas = (salida.trim() ? JSON.parse(salida) : []) as {
  telefono: string;
  entregas: number | null;
  devoluciones: number | null;
  capturada: string;
}[];

const prisma = new prismaPkg.PrismaClient();
let guardadas = 0;
let invalidas = 0;
for (const f of filas) {
  const telefono = normalizarTelefono(f.telefono);
  const capturada = new Date(f.capturada);
  if (!telefono || Number.isNaN(capturada.getTime())) {
    invalidas++;
    continue;
  }
  const datos = { entregas: f.entregas ?? 0, devoluciones: f.devoluciones ?? 0, capturada };
  await prisma.huellaDropi.upsert({
    where: { shop_telefono: { shop: values.shop, telefono } },
    create: { shop: values.shop, telefono, ...datos },
    update: datos,
  });
  guardadas++;
}
await prisma.$disconnect();

console.log(`Huellas sincronizadas: ${guardadas} teléfonos para ${values.shop}` + (invalidas ? ` (${invalidas} omitidos)` : ""));
