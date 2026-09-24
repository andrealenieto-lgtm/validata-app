import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { codigoProvincia } from "../app/lib/colombia.ts";

test("departamentos de Dropi a códigos de Shopify", () => {
  assert.equal(codigoProvincia("ANTIOQUIA", "MEDELLIN"), "ANT");
  assert.equal(codigoProvincia("VALLE", "CALI"), "VAC");
  assert.equal(codigoProvincia("Nariño", "Pasto"), "NAR");
  assert.equal(codigoProvincia("CUNDINAMARCA", "BOGOTA"), "DC");
  assert.equal(codigoProvincia("CUNDINAMARCA", "SOACHA"), "CUN");
  assert.equal(codigoProvincia("NO EXISTE", "X"), null);
});

test("todos los departamentos del desplegable tienen código", () => {
  const deptos = Object.keys(
    JSON.parse(readFileSync(new URL("../extensions/formulario-cod/assets/colombia.json", import.meta.url), "utf8")),
  );
  assert.equal(deptos.length, 32);
  for (const d of deptos) assert.ok(codigoProvincia(d, ""), d);
});
