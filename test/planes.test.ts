import { test } from "node:test";
import assert from "node:assert/strict";

import { estadoCupo, precio, precioMensualMostrado, tieneFuncion } from "../app/lib/planes.ts";

test("gratis: 60 pedidos y luego se desactiva", () => {
  assert.equal(estadoCupo("gratis", "mensual", 47).avisar, false);
  assert.equal(estadoCupo("gratis", "mensual", 48).avisar, true);
  assert.equal(estadoCupo("gratis", "mensual", 59).permitido, true);
  assert.deepEqual(estadoCupo("gratis", "mensual", 60), {
    permitido: false,
    cobrarAdicional: false,
    usados: 60,
    incluidos: 60,
    avisar: true,
  });
});

test("profesional mensual: pasados 440 cobra $0.05 por pedido hasta el tope", () => {
  assert.equal(estadoCupo("profesional", "mensual", 439).cobrarAdicional, false);
  const e = estadoCupo("profesional", "mensual", 440);
  assert.equal(e.permitido, true);
  assert.equal(e.cobrarAdicional, true);
  assert.equal(estadoCupo("profesional", "mensual", 3000, 100).permitido, false);
});

test("anual: sin cargos por uso, se desactiva al llenar el cupo", () => {
  assert.equal(estadoCupo("profesional", "anual", 440).permitido, false);
});

test("ilimitado nunca se bloquea", () => {
  assert.equal(estadoCupo("ilimitado", "anual", 1_000_000).permitido, true);
});

test("precios con 25% de descuento anual", () => {
  assert.equal(precio("profesional", "mensual"), 9.95);
  assert.equal(precio("profesional", "anual"), 89.55);
  assert.equal(precioMensualMostrado("avanzado", "anual"), 18.71);
  assert.equal(precio("gratis", "anual"), 0);
});

test("funciones por plan", () => {
  assert.equal(tieneFuncion("gratis", "upsells"), true);
  assert.equal(tieneFuncion("gratis", "validacionRed"), false);
  assert.equal(tieneFuncion("profesional", "validacionRed"), true);
  assert.equal(tieneFuncion("profesional", "pagoParcial"), false);
  assert.equal(tieneFuncion("avanzado", "pagoParcial"), true);
});
