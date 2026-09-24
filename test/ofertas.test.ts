import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NIVELES_POR_DEFECTO,
  normalizarPaquete,
  paqueteParaProducto,
  aplicarDescuento,
  cobroNivel,
  normalizarOferta,
  ofertaParaProducto,
  precioNivel,
  precioPaquete,
  resumenPedido,
  textoConDescuento,
  type NivelCantidad,
  type Paquete,
} from "../app/lib/ofertas.ts";

// Números tomados de las capturas de EasySell.
const centella = { precio: 99700, precioComparacion: null };
const camelia = { precio: 89900, precioComparacion: 149900 };

const nivel = (cantidad: number, pct: number): NivelCantidad => ({
  id: `n${cantidad}`,
  cantidad,
  titulo: `${cantidad} Unidades`,
  subtitulo: "",
  etiqueta: "",
  descuento: { tipo: "porcentaje", valor: pct },
  porDefecto: false,
});

test("ofertas por cantidad: 1 / 2 (-20%) / 3 (-30%)", () => {
  assert.equal(precioNivel(nivel(1, 0), centella).total, 99700);
  assert.deepEqual(precioNivel(nivel(2, 20), centella), {
    total: 159520,
    antes: 199400,
    ahorro: 39880,
    ahorroPct: 20,
  });
  const tres = precioNivel(nivel(3, 30), centella);
  assert.equal(tres.total, 209370);
  assert.equal(tres.antes, 299100);
});

test("usar precio de comparación como precio tachado", () => {
  const r = precioNivel(nivel(1, 0), camelia, true);
  assert.equal(r.total, 89900);
  assert.equal(r.antes, 149900);
});

test("paquete Camelia + Centella con 20% repartido", () => {
  const paquete: Paquete = normalizarPaquete(
    {
      productos: [
        { productoId: "1", cantidad: 1 },
        { productoId: "2", cantidad: 1 },
      ],
      descuento: { tipo: "porcentaje", valor: 20 },
    },
    "p1",
  );
  const r = precioPaquete(paquete, { "1": camelia, "2": centella });
  assert.equal(r.total, 151680);
  assert.deepEqual(
    r.lineas.map((l) => l.total),
    [71920, 79760],
  );
  assert.equal(textoConDescuento(paquete.subtitulo, r.ahorroPct), "Ahorra 20%");
});

test("paquete: cada línea es unitario × cantidad y el total es la suma de las líneas", () => {
  const paquete = {
    productos: [
      { productoId: "a", cantidad: 1 },
      { productoId: "b", cantidad: 2 },
      { productoId: "c", cantidad: 1 },
    ],
    descuento: { tipo: "monto" as const, valor: 10 },
  };
  const r = precioPaquete(paquete, { a: { precio: 33.33 }, b: { precio: 33.33 }, c: { precio: 33.34 } });
  for (const l of r.lineas) assert.equal(l.total, Math.round(l.unitario * l.cantidad * 100) / 100);
  assert.equal(r.total, Math.round(r.lineas.reduce((s, l) => s + l.total, 0) * 100) / 100);
  assert.ok(Math.abs(r.total - (133.33 - 10)) < 0.05); // a lo sumo unos centavos de redondeo
});

test("normalizarPaquete: sin productos repetidos, máximo 5, y válido con 2 o más", () => {
  const p = normalizarPaquete(
    { productos: [{ productoId: "gid://shopify/Product/1" }, { productoId: "1" }, { productoId: "2", cantidad: 50 }] },
    "p1",
  );
  assert.deepEqual(p.productos, [
    { productoId: "1", cantidad: 1 },
    { productoId: "2", cantidad: 10 },
  ]);
  assert.equal(p.titulo, "Paquete completo");
  const solo = normalizarPaquete({ productos: [{ productoId: "9" }] }, "p2");
  assert.equal(paqueteParaProducto([solo], "9"), null); // un solo producto no es paquete
  assert.equal(paqueteParaProducto([p], "2")?.id, "p1");
  assert.equal(paqueteParaProducto([{ ...p, activo: false }], "2"), null);
});

test("descuentos nunca dan negativo ni suben el precio", () => {
  assert.equal(aplicarDescuento(100, { tipo: "monto", valor: 500 }), 0);
  assert.equal(aplicarDescuento(100, { tipo: "precioFijo", valor: 150 }), 100);
  assert.equal(aplicarDescuento(100, { tipo: "porcentaje", valor: 120 }), 0);
});

test("resumen del pedido", () => {
  assert.deepEqual(resumenPedido([{ antes: 199400, total: 159520 }], 0), {
    subtotal: 199400,
    descuento: 39880,
    envio: 0,
    total: 159520,
  });
});

test("oferta por defecto estilo Kaching: 1 / 2 (-20%, Más popular) / 3 (-30%)", () => {
  const o = normalizarOferta({ productoIds: ["gid://shopify/Product/555"] }, "o1");
  assert.deepEqual(o.productoIds, ["555"]);
  assert.deepEqual(
    o.niveles.map((n) => [n.cantidad, n.descuento.valor, n.etiqueta, n.porDefecto]),
    [
      [1, 0, "", false],
      [2, 20, "Más popular", true],
      [3, 30, "Mejor precio", false],
    ],
  );
  assert.equal(o.diseno.plantilla, "barras");
});

test("niveles: sin cantidades repetidas, ordenados y un solo nivel por defecto", () => {
  const o = normalizarOferta(
    {
      niveles: [
        { id: "a", cantidad: 3, titulo: "3", descuento: { tipo: "porcentaje", valor: 150 }, porDefecto: true },
        { id: "b", cantidad: 1, titulo: "1", porDefecto: true },
        { id: "c", cantidad: 3, titulo: "otra vez 3" },
      ],
    },
    "o1",
  );
  assert.deepEqual(o.niveles.map((n) => n.id), ["b", "a"]);
  assert.equal(o.niveles.find((n) => n.id === "a")!.descuento.valor, 100);
  assert.equal(o.niveles.filter((n) => n.porDefecto).length, 1);
});

test("colores del diseño: solo hex o rgb", () => {
  const o = normalizarOferta({ diseno: { colorPrincipal: "red;}body{display:none", colorFondo: "#fff" } }, "o1");
  assert.equal(o.diseno.colorPrincipal, "#10b981");
  assert.equal(o.diseno.colorFondo, "#fff");
});

test("oferta por producto: la específica gana a la de todos los productos", () => {
  const todos = normalizarOferta({ nombre: "General", todosLosProductos: true }, "g");
  const centella = normalizarOferta({ nombre: "Centella", productoIds: ["10250219716930"] }, "c");
  const apagada = normalizarOferta({ activa: false, productoIds: ["777"] }, "x");
  assert.equal(ofertaParaProducto([todos, centella], "gid://shopify/Product/10250219716930")?.id, "c");
  assert.equal(ofertaParaProducto([todos, centella], "999")?.id, "g");
  assert.equal(ofertaParaProducto([apagada], "777"), null);
});

test("cobro del servidor: el nivel debe existir; el navegador no inventa descuentos", () => {
  const o = normalizarOferta({ productoIds: ["1"] }, "o1");
  assert.deepEqual(
    (({ cantidad, total, antes }) => ({ cantidad, total, antes }))(cobroNivel(o, "n2", centella)!),
    { cantidad: 2, total: 159520, antes: 199400 },
  );
  assert.equal(cobroNivel(o, "n-falso", centella), null);
  assert.equal(cobroNivel(null, "n2", centella), null);
  assert.equal(NIVELES_POR_DEFECTO.length, 3);
});

test("el total de la oferta es precio unitario × cantidad (caso real del pedido #1002)", () => {
  const snowboard = { precio: 785.95 };
  const r = precioNivel(nivel(2, 25), snowboard);
  // 1.571,90 − 25% = 1.178,925 → 589,46 por unidad → 1.178,92. Shopify cobra 589,46 × 2,
  // exactamente lo que ve el cliente (antes del arreglo cobraba 1.178,94 y mostraba 1.178,93).
  assert.equal(r.total, 1178.92);
  assert.equal(Math.round((r.total / 2) * 100) / 100, 589.46);
  assert.equal(r.antes, 1571.9);
  const tres = precioNivel(nivel(3, 10), { precio: 10 }); // 27 exacto
  assert.equal(tres.total, 27);
});
