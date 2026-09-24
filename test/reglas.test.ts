import { test } from "node:test";
import assert from "node:assert/strict";

import { AJUSTES_POR_DEFECTO, normalizarAjustes } from "../app/lib/reglas/ajustes.ts";
import { calcularEstadisticas, clasificarEstado } from "../app/lib/reglas/historial.ts";
import { calcularPagos, enlaceWhatsapp, evaluar } from "../app/lib/reglas/motor.ts";
import { normalizarTelefono } from "../app/lib/reglas/telefono.ts";
import { consultarFuentes, type FuenteHistorial } from "../app/lib/reglas/fuentes.ts";

const A = AJUSTES_POR_DEFECTO;
const hist = (...estados: string[]) => calcularEstadisticas(estados.map((estado) => ({ estado })));

test("normaliza teléfonos colombianos", () => {
  for (const t of ["3001234567", "300 123 4567", "+57 300-123-4567", "573001234567", "0057 3001234567"]) {
    assert.equal(normalizarTelefono(t), "+573001234567", t);
  }
  assert.equal(normalizarTelefono("123"), null);
  assert.equal(normalizarTelefono(""), null);
});

test("clasifica estados de Dropi", () => {
  assert.equal(clasificarEstado("ENTREGADO"), "entregado");
  assert.equal(clasificarEstado("Devolución"), "devuelto");
  assert.equal(clasificarEstado("RECHAZADO"), "devuelto");
  assert.equal(clasificarEstado("CANCELADO"), "otro");
  assert.equal(clasificarEstado("EN REPARTO"), "otro");
});

test("cuenta devoluciones seguidas desde el pedido más reciente", () => {
  // Orden de entrada: más viejo → más nuevo.
  const e = hist("ENTREGADO", "DEVOLUCION", "CANCELADO", "DEVOLUCION");
  assert.equal(e.devolucionesSeguidas, 2);
  assert.equal(e.terminados, 3);
  assert.equal(Math.round(e.tasaDevolucion), 67);
});

test("ignora pedidos más viejos que la antigüedad máxima", () => {
  const e = calcularEstadisticas(
    [
      { estado: "DEVOLUCION", fecha: "2024-01-01" },
      { estado: "ENTREGADO", fecha: "2026-09-01" },
    ],
    12,
    new Date("2026-09-23"),
  );
  assert.equal(e.devoluciones, 0);
  assert.equal(e.entregas, 1);
});

test("cliente nuevo usa el ajuste de la tienda", () => {
  assert.equal(evaluar(hist(), A).accion, "contraentrega");
  assert.equal(evaluar(hist(), { ...A, clienteNuevo: "pago_previo" }).accion, "pago_previo");
});

test("ejemplo del panel: 6 pedidos, 4 entregas, 2 devoluciones (33%)", () => {
  const e = hist("DEVOLUCION", "ENTREGADO", "ENTREGADO", "DEVOLUCION", "ENTREGADO", "ENTREGADO");
  assert.equal(evaluar(e, { ...A, maxDevolucionCOD: 35 }).accion, "contraentrega");
  assert.equal(evaluar(e, { ...A, maxDevolucionCOD: 25 }).accion, "pago_previo");
});

test("tasa alta con historial suficiente va a WhatsApp", () => {
  const e = hist("ENTREGADO", "DEVOLUCION", "DEVOLUCION", "DEVOLUCION", "ENTREGADO", "DEVOLUCION"); // 67%
  assert.deepEqual(evaluar(e, A), { accion: "whatsapp", motivo: "tasa_whatsapp" });
});

test("pocos pedidos: no se juzga por porcentaje", () => {
  const e = hist("ENTREGADO", "DEVOLUCION"); // 50%, pero solo 2 terminados
  assert.deepEqual(evaluar(e, A), { accion: "contraentrega", motivo: "historial_insuficiente" });
});

test("devoluciones sin ninguna entrega quitan la contraentrega aunque sean pocas", () => {
  assert.deepEqual(evaluar(hist("DEVOLUCION", "DEVOLUCION"), A), {
    accion: "pago_previo",
    motivo: "devoluciones_sin_entrega",
  });
});

test("racha de devoluciones va a WhatsApp", () => {
  const e = hist("ENTREGADO", "ENTREGADO", "DEVOLUCION", "DEVOLUCION", "DEVOLUCION");
  assert.equal(evaluar(e, A).motivo, "devoluciones_seguidas");
  // Sin la regla de racha, 60% no supera el corte de WhatsApp (60) pero sí el de contraentrega (35).
  assert.equal(evaluar(e, { ...A, devolucionesSeguidas: 0 }).accion, "pago_previo");
});

test("normalizarAjustes corrige rangos y cortes cruzados", () => {
  const a = normalizarAjustes({ maxDevolucionCOD: 50, maxDevolucionWhatsapp: 20, minPedidos: -3 });
  assert.equal(a.maxDevolucionWhatsapp, 50);
  assert.equal(a.minPedidos, 1);
  assert.deepEqual(normalizarAjustes(null), A);
});

test("calcula anticipado con descuento y abono", () => {
  assert.deepEqual(calcularPagos(100000, A), {
    anticipado: 95000,
    abono: { monto: 30000, saldoContraentrega: 70000 },
  });
  assert.equal(calcularPagos(100000, { ...A, abono: { tipo: "monto", valor: 0 } }).abono, null);
  assert.equal(calcularPagos(15000, { ...A, abono: { tipo: "monto", valor: 20000 } }).abono, null);
});

test("enlace de WhatsApp con plantilla", () => {
  const url = enlaceWhatsapp({ ...A, whatsapp: { ...A.whatsapp, numero: "573001234567", mensaje: "Hola {nombre}" } }, { nombre: "Ana" });
  assert.equal(url, "https://wa.me/573001234567?text=Hola%20Ana");
  assert.equal(enlaceWhatsapp(A, {}), null);
});

test("fuentes: usa la más completa y sobrevive a una caída", async () => {
  const fija = (nombre: string, entregas: number, devoluciones: number, racha = 0): FuenteHistorial => ({
    nombre,
    consultar: async () => ({
      entregas,
      devoluciones,
      terminados: entregas + devoluciones,
      tasaDevolucion: (devoluciones / (entregas + devoluciones)) * 100,
      devolucionesSeguidas: racha,
    }),
  });
  const caida: FuenteHistorial = { nombre: "caida", consultar: () => Promise.reject(new Error("x")) };
  const lenta: FuenteHistorial = { nombre: "lenta", consultar: () => new Promise(() => {}) };

  const r = await consultarFuentes("+573001234567", [fija("tienda", 1, 1, 1), fija("red", 3, 7, 0), caida, lenta], 50);
  assert.equal(r.estadisticas?.terminados, 10);
  assert.equal(r.estadisticas?.devolucionesSeguidas, 1);
  assert.deepEqual(r.usadas, ["tienda", "red"]);
  assert.deepEqual(r.fallidas, ["caida", "lenta"]);
});
