import { test } from "node:test";
import assert from "node:assert/strict";

import { ahorroEstimado, diaLocal, resumir, tablaUtm, type EventoAnalisis } from "../app/lib/analisis.ts";

const BOGOTA = "America/Bogota";

test("un pedido a las 8 pm de Bogotá cuenta en ese día, no en el siguiente (bug de EasySell)", () => {
  // 2026-09-17 20:00 en Bogotá = 2026-09-18 01:00 UTC.
  assert.equal(diaLocal("2026-09-18T01:00:00Z", BOGOTA), "2026-09-17");
  assert.equal(diaLocal("2026-09-18T01:00:00Z", "UTC"), "2026-09-18");
});

const eventos: EventoAnalisis[] = [
  { tipo: "apertura", fecha: "2026-09-16T15:00:00Z", utm: { campana: "magnesio_bm_nuevo", fuente: "meta", medio: "paid_social" } },
  { tipo: "apertura", fecha: "2026-09-16T15:05:00Z", utm: { campana: "magnesio_bm_nuevo", fuente: "meta", medio: "paid_social" } },
  { tipo: "apertura", fecha: "2026-09-16T16:00:00Z" },
  { tipo: "apertura", fecha: "2026-09-17T16:00:00Z", utm: { campana: "testeo13", fuente: "facebook", medio: "cpc" } },
  {
    tipo: "pedido",
    fecha: "2026-09-16T15:10:00Z",
    total: 99700,
    upsell: 5000,
    utm: { campana: "magnesio_bm_nuevo", fuente: "meta", medio: "paid_social" },
  },
  { tipo: "pedido", fecha: "2026-09-17T16:10:00Z", total: 159520, utm: { campana: "testeo13", fuente: "facebook", medio: "cpc" } },
  { tipo: "validacion", fecha: "2026-09-16T15:10:00Z", accion: "contraentrega" },
  { tipo: "validacion", fecha: "2026-09-17T16:10:00Z", accion: "pago_previo" },
  { tipo: "validacion", fecha: "2026-09-17T17:00:00Z", accion: "whatsapp" },
  { tipo: "pedido", fecha: "2026-10-01T00:00:00Z", total: 1 }, // fuera del rango
];

test("resumen: totales, conversión, valor promedio y días vacíos en 0", () => {
  const r = resumir(eventos, BOGOTA, "2026-09-16", "2026-09-18");
  assert.equal(r.aperturas, 4);
  assert.equal(r.pedidos, 2);
  assert.equal(r.ingresos, 259220);
  assert.equal(r.ingresosUpsell, 5000);
  assert.equal(r.conversion, 50);
  assert.equal(r.valorPromedio, 129610);
  assert.deepEqual(r.validacion, { contraentrega: 1, pago_previo: 1, whatsapp: 1 });
  assert.deepEqual(
    r.serie.map((p) => [p.dia, p.pedidos]),
    [
      ["2026-09-16", 1],
      ["2026-09-17", 1],
      ["2026-09-18", 0],
    ],
  );
});

test("tabla UTM agrupa por campaña/fuente/medio y marca vacíos con -", () => {
  const t = tablaUtm(eventos.filter((e) => e.fecha < "2026-10-01"));
  assert.deepEqual(t[0], {
    campana: "magnesio_bm_nuevo",
    fuente: "meta",
    medio: "paid_social",
    aperturas: 2,
    pedidos: 1,
    conversion: 50,
  });
  assert.ok(t.some((f) => f.campana === "-" && f.aperturas === 1 && f.pedidos === 0));
});

test("ahorro estimado por pedidos frenados", () => {
  const r = resumir(eventos, BOGOTA, "2026-09-16", "2026-09-18");
  assert.equal(ahorroEstimado(r, 18000), 36000);
  assert.equal(ahorroEstimado(r, 18000, 0.5), 18000);
});
