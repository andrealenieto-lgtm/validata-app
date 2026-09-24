import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLOQUES_FIJOS,
  FORMULARIO_POR_DEFECTO,
  PLANTILLAS,
  normalizarFormulario,
} from "../app/lib/formulario/esquema.ts";

const D = FORMULARIO_POR_DEFECTO;

test("vacío o dañado: formulario por defecto; normalizar dos veces no cambia nada", () => {
  const n = normalizarFormulario(null);
  assert.deepEqual(normalizarFormulario("basura"), n);
  assert.deepEqual(normalizarFormulario(D), n);
  assert.deepEqual(normalizarFormulario(n), n);
  assert.deepEqual(
    n.bloques.map((b) => b.id),
    D.bloques.map((b) => b.id),
  );
  const { bloques: _a, ...restoN } = n;
  const { bloques: _b, ...restoD } = D;
  assert.deepEqual(restoN, restoD);
});

test("colores: acepta hex, rgb y degradados; rechaza CSS peligroso", () => {
  const ok = ["#fff", "#10b981", "rgba(0, 0, 0, 0.5)", "linear-gradient(90deg, #60a5fa, #2563eb)", "linear-gradient(135deg, rgba(0,0,0,.2) 0%, #fff 100%)"];
  for (const c of ok) assert.equal(normalizarFormulario({ formulario: { fondo: c } }).formulario.fondo, c, c);
  const malos = [
    "url(https://evil.example/x.png)",
    "red; background: url(x)",
    "#fff} body{display:none",
    "expression(alert(1))",
    "linear-gradient(url(x), #fff)",
  ];
  for (const c of malos) assert.equal(normalizarFormulario({ formulario: { fondo: c } }).formulario.fondo, D.formulario.fondo, c);
});

test("números fuera de rango se ajustan", () => {
  const f = normalizarFormulario({ campos: { radio: 500 }, formulario: { tamanoTexto: 2 } });
  assert.equal(f.campos.radio, 30);
  assert.equal(f.formulario.tamanoTexto, 12);
});

test("los campos fijos no se pueden borrar, ocultar ni volver opcionales", () => {
  const sinFijos = D.bloques.filter((b) => b.id !== "telefono" && b.id !== "enviar");
  const f = normalizarFormulario({
    bloques: sinFijos.map((b) => (b.id === "nombre" && b.tipo === "campo" ? { ...b, oculto: true, requerido: false } : b)),
  });
  for (const id of BLOQUES_FIJOS) assert.ok(f.bloques.some((b) => b.id === id), id);
  const nombre = f.bloques.find((b) => b.id === "nombre");
  assert.ok(nombre?.tipo === "campo" && nombre.requerido && !nombre.oculto);
  // El teléfono vuelve después del apellido, como en el formulario por defecto.
  const ids = f.bloques.map((b) => b.id);
  assert.equal(ids.indexOf("telefono"), ids.indexOf("apellido") + 1);
  assert.equal(ids.at(-1), "enviar");
});

test("bloques desconocidos, ids repetidos y campos con nombre libre se descartan", () => {
  const f = normalizarFormulario({
    bloques: [
      ...D.bloques,
      { id: "x", tipo: "script", codigo: "alert(1)" },
      { id: "nombre", tipo: "texto", texto: "duplicado" },
      { id: "hack", tipo: "campo", nombre: "__proto__", tipoCampo: "texto", etiqueta: "x" },
      { id: "cedula", tipo: "campo", nombre: "extra_cedula", tipoCampo: "texto", etiqueta: "Cédula", requerido: true },
    ],
  });
  assert.ok(!f.bloques.some((b) => b.id === "x" || b.id === "hack"));
  assert.equal(f.bloques.filter((b) => b.id === "nombre").length, 1);
  const cedula = f.bloques.find((b) => b.id === "cedula");
  assert.ok(cedula?.tipo === "campo" && cedula.nombre === "extra_cedula" && cedula.requerido);
});

test("imágenes solo por https", () => {
  const f = normalizarFormulario({
    bloques: [...D.bloques, { id: "img", tipo: "imagen", url: "javascript:alert(1)" }],
  });
  const img = f.bloques.find((b) => b.id === "img");
  assert.ok(img?.tipo === "imagen" && img.url === "");
});

test("todas las plantillas producen colores válidos", () => {
  for (const p of PLANTILLAS) {
    const f = normalizarFormulario({ ...D, ...p.estilos });
    assert.deepEqual(
      { formulario: f.formulario, campos: f.campos, botonEnviar: f.botonEnviar },
      p.estilos,
      p.nombre,
    );
  }
});
