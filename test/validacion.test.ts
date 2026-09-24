import { test } from "node:test";
import assert from "node:assert/strict";

import { AJUSTES_POR_DEFECTO } from "../app/lib/reglas/ajustes.ts";
import { fuenteHuellaDropi, type FuenteHistorial } from "../app/lib/reglas/fuentes.ts";
import type { Estadisticas } from "../app/lib/reglas/historial.ts";
import { conCache, fuenteTienda, limitador, validarTelefono } from "../app/lib/reglas/validacion.ts";

const A = {
  ...AJUSTES_POR_DEFECTO,
  whatsapp: { ...AJUSTES_POR_DEFECTO.whatsapp, numero: "573009998877", mensaje: "Hola, soy {nombre}" },
};

const stats = (entregas: number, devoluciones: number, racha = 0): Estadisticas => ({
  entregas,
  devoluciones,
  terminados: entregas + devoluciones,
  tasaDevolucion: entregas + devoluciones ? (devoluciones / (entregas + devoluciones)) * 100 : 0,
  devolucionesSeguidas: racha,
});

/** Simula la base de 99 envíos con algunos teléfonos conocidos. */
function red(datos: Record<string, Estadisticas>): FuenteHistorial & { llamadas: number } {
  const f = {
    nombre: "99envios",
    llamadas: 0,
    async consultar(t: string) {
      f.llamadas++;
      return datos[t] ?? null;
    },
  };
  return f;
}

const base = {
  ajustes: A,
  modoHuella: "detalle_verificado" as const,
  telefonoVerificado: false,
  total: 100000,
  datos: { nombre: "Ana" },
};

const RED = red({
  "+573001111111": stats(12, 1), // 8% devolución
  "+573002222222": stats(4, 3), // 43% → pago previo
  "+573003333333": stats(2, 6, 3), // racha de 3 → WhatsApp
});

test("teléfono inválido", async () => {
  const r = await validarTelefono({ ...base, telefono: "123", fuentes: [RED] });
  assert.deepEqual(r.publico, { ok: false, error: "telefono_invalido" });
});

test("buen historial: contraentrega y huella sin números hasta verificar", async () => {
  const r = await validarTelefono({ ...base, telefono: "300 111 1111", fuentes: [RED] });
  assert.ok(r.publico.ok);
  assert.equal(r.publico.accion, "contraentrega");
  assert.equal(r.publico.huella?.nivel, "con_devoluciones"); // tiene 1 devolución
  assert.equal(r.publico.huella?.detalle, undefined);
  assert.equal(r.publico.puedeVerificar, true);
  assert.equal(r.publico.pagos, null);
});

test("verificado: muestra pedidos, entregas, devoluciones y efectividad", async () => {
  const r = await validarTelefono({ ...base, telefonoVerificado: true, telefono: "3001111111", fuentes: [RED] });
  assert.ok(r.publico.ok);
  assert.deepEqual(r.publico.huella?.detalle, { pedidos: 13, entregas: 12, devoluciones: 1, efectividad: 92 });
  assert.equal(r.publico.puedeVerificar, false);
});

test("muchas devoluciones: pago previo con anticipado y abono", async () => {
  const r = await validarTelefono({ ...base, telefono: "3002222222", fuentes: [RED] });
  assert.ok(r.publico.ok);
  assert.equal(r.publico.accion, "pago_previo");
  assert.deepEqual(r.publico.pagos, { anticipado: 95000, abono: { monto: 30000, saldoContraentrega: 70000 } });
  assert.equal(r.motivo, "tasa_cod"); // interno, no va en `publico`

  // Sin WhatsApp configurado no hay a dónde enviar el abono: solo pago anticipado.
  const sinWa = await validarTelefono({
    ...base,
    ajustes: { ...A, whatsapp: { ...A.whatsapp, numero: "" } },
    telefono: "3002222222",
    fuentes: [RED],
  });
  assert.ok(sinWa.publico.ok);
  assert.deepEqual(sinWa.publico.pagos, { anticipado: 95000, abono: null });
  assert.ok(!("motivo" in r.publico));
});

test("racha de devoluciones: WhatsApp con mensaje prellenado", async () => {
  const r = await validarTelefono({ ...base, telefono: "3003333333", fuentes: [RED] });
  assert.ok(r.publico.ok);
  assert.equal(r.publico.accion, "whatsapp");
  assert.equal(r.publico.huella?.nivel, "alto_riesgo");
  assert.equal(r.publico.whatsapp, "https://wa.me/573009998877?text=Hola%2C%20soy%20Ana");
});

test("número desconocido o red caída: cliente nuevo, no se frenan ventas", async () => {
  const caida: FuenteHistorial = { nombre: "99envios", consultar: () => Promise.reject(new Error("503")) };
  const r = await validarTelefono({ ...base, telefono: "3009999999", fuentes: [caida] });
  assert.ok(r.publico.ok);
  assert.equal(r.publico.accion, "contraentrega");
  assert.equal(r.publico.huella?.nivel, "nuevo");
  assert.deepEqual(r.fuentesFallidas, ["99envios"]);
});

test("modos de huella: oculta y nivel nunca muestran números", async () => {
  const oculta = await validarTelefono({ ...base, modoHuella: "oculta", telefonoVerificado: true, telefono: "3002222222", fuentes: [RED] });
  assert.ok(oculta.publico.ok);
  assert.equal(oculta.publico.huella, null);
  const nivel = await validarTelefono({ ...base, modoHuella: "nivel", telefonoVerificado: true, telefono: "3002222222", fuentes: [RED] });
  assert.ok(nivel.publico.ok);
  assert.equal(nivel.publico.huella?.detalle, undefined);
  assert.equal(nivel.publico.puedeVerificar, false);
});

test("historial de la tienda + red: usa la vista más completa", async () => {
  const tienda = fuenteTienda(async () => [{ estado: "ENTREGADO" }, { estado: "DEVOLUCION" }], 0);
  const r = await validarTelefono({ ...base, telefono: "3002222222", fuentes: [tienda, RED] });
  assert.equal(r.estadisticas?.terminados, 7);
  assert.deepEqual(r.fuentesUsadas, ["tienda", "99envios"]);
});

test("caché: la red se consulta una vez por número mientras dure", async () => {
  let t = 0;
  const r = red({ "+573001111111": stats(1, 0) });
  const f = conCache(r, 60_000, () => t);
  await f.consultar("+573001111111");
  await f.consultar("+573001111111");
  assert.equal(r.llamadas, 1);
  t = 61_000;
  await f.consultar("+573001111111");
  assert.equal(r.llamadas, 2);
});

test("límite de consultas por IP", () => {
  let t = 0;
  const permitir = limitador(3, 60_000, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => permitir("1.2.3.4")), [true, true, true, false]);
  assert.equal(permitir("5.6.7.8"), true);
  t = 60_001;
  assert.equal(permitir("1.2.3.4"), true);
});

test("huella de Dropi: totales de la red, se ignora si es muy vieja", async () => {
  const ahora = Date.parse("2026-09-24T00:00:00Z");
  const f = fuenteHuellaDropi(
    async (t) =>
      t === "+573008682633"
        ? { entregas: 4, devoluciones: 6, capturada: new Date("2026-07-29T20:12:47Z") }
        : t === "+573000000001"
          ? { entregas: 9, devoluciones: 0, capturada: new Date("2025-01-01T00:00:00Z") }
          : null,
    180,
    () => ahora,
  );
  assert.deepEqual(await f.consultar("+573008682633"), {
    entregas: 4,
    devoluciones: 6,
    terminados: 10,
    tasaDevolucion: 60,
    devolucionesSeguidas: 0,
  });
  assert.equal(await f.consultar("+573000000001"), null);
  assert.equal(await f.consultar("+573009999999"), null);

  // Con los ajustes por defecto, 60% de devolución y 10 pedidos → pago previo.
  const r = await validarTelefono({ ...base, telefono: "3008682633", fuentes: [f] });
  assert.ok(r.publico.ok);
  assert.equal(r.publico.accion, "pago_previo");
  assert.deepEqual(r.fuentesUsadas, ["huella_dropi"]);
});
