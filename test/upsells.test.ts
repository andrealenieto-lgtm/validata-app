import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLICK_POR_DEFECTO,
  DOWNSELL_POR_DEFECTO,
  TICK_POR_DEFECTO,
  normalizarUpsells,
  porcentajeDownsell,
  validarExtras,
  aplicaA,
  downsellAlCerrar,
  precioOfertaUpsell,
  siguienteOferta,
  textoDownsell,
  textoTemporizador,
  textoTick,
  ticksParaCarrito,
  upsellParaCarrito,
  type Downsell,
  type Upsell1Click,
  type Upsell1Tick,
} from "../app/lib/upsells.ts";

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
const carrito = [{ productoId: "camelia", coleccionIds: ["skincare"] }];

const oferta = (productoId: string, pct = 10) => ({
  id: productoId,
  productoId,
  descuento: { tipo: "porcentaje" as const, valor: pct },
  selectorCantidad: false,
  seleccionVariantes: true,
  temporizadorMin: 10,
});

const upsell: Upsell1Click = {
  ...CLICK_POR_DEFECTO,
  id: "u1",
  nombre: "Nueva venta adicional #1",
  activo: true,
  modo: "post",
  disparador: { tipo: "productos", ids: ["camelia"] },
  ofertas: [oferta("cojin"), oferta("camelia"), oferta("centella")],
};

test("alcance: todos, productos y colecciones", () => {
  assert.equal(aplicaA({ tipo: "todos" }, carrito), true);
  assert.equal(aplicaA({ tipo: "productos", ids: ["otro"] }, carrito), false);
  assert.equal(aplicaA({ tipo: "colecciones", ids: ["skincare"] }, carrito), true);
});

test("1-click: se dispara por producto y respeta el modo", () => {
  assert.equal(upsellParaCarrito([upsell], "post", carrito)?.id, "u1");
  assert.equal(upsellParaCarrito([upsell], "pre", carrito), null);
  assert.equal(upsellParaCarrito([{ ...upsell, activo: false }], "post", carrito), null);
});

test("1-click: secuencia salta productos que ya están en el pedido", () => {
  const primera = siguienteOferta(upsell, -1, ["camelia"]);
  assert.equal(primera?.oferta.productoId, "cojin");
  // Después del cojín, "camelia" ya está en el pedido → pasa a "centella".
  assert.equal(siguienteOferta(upsell, primera!.indice, ["camelia", "cojin"])?.oferta.productoId, "centella");
  assert.equal(siguienteOferta(upsell, 2, []), null);
});

test("1-click: precio con -10% (captura: $82.900 → $74.610)", () => {
  assert.deepEqual(precioOfertaUpsell(oferta("cojin"), { precio: 82900 }), { antes: 82900, total: 74610 });
});

test("temporizador", () => {
  assert.equal(textoTemporizador("Termina en {time}", 592), "Termina en 09:52");
  assert.equal(textoTemporizador("{time}", -5), "00:00");
});

test("1-tick: envío prioritario para todos los productos", () => {
  const tick: Upsell1Tick = {
    ...TICK_POR_DEFECTO,
    id: "t1",
    nombre: "Envio prioritario",
    activo: true,
    alcance: { tipo: "todos" },
    titulo: "Envio prioritario",
    precio: 5000,
    texto: "🔥 Añade {{title}} por solo {{price}} Y recibe tu producto de 24-48 horas.",
    requiereEnvio: false,
    cobrarImpuesto: false,
    selectorCantidad: false,
  };
  assert.equal(ticksParaCarrito([tick], carrito).length, 1);
  assert.equal(
    textoTick(tick, cop),
    "🔥 Añade Envio prioritario por solo $5.000 Y recibe tu producto de 24-48 horas.",
  );
});

test("downsell: aparece en el cierre configurado y solo una vez", () => {
  const d: Downsell = {
    ...DOWNSELL_POR_DEFECTO,
    id: "d1",
    nombre: "Nueva oferta adicional",
    activo: true,
    alcance: { tipo: "todos" },
    cierresNecesarios: 2,
    descuento: { tipo: "porcentaje", valor: 10 },
  };
  assert.equal(downsellAlCerrar([d], carrito, 1, false), null);
  assert.equal(downsellAlCerrar([d], carrito, 2, false)?.id, "d1");
  assert.equal(downsellAlCerrar([d], carrito, 2, true), null);
  assert.equal(
    textoDownsell("Completar pedido con {discount} de DESCUENTO", d.descuento, cop),
    "Completar pedido con 10% de DESCUENTO",
  );
});

test("normalizarUpsells: ids únicos, colores y descuentos acotados", () => {
  const c = normalizarUpsells({
    ticks: [{ id: "t1", precio: -5, colores: { marca: "url(x)" } }, { id: "t1" }],
    clicks: [{ id: "c1", modo: "post", ofertas: [{ id: "o1", productoId: "gid://shopify/Product/9", descuento: { tipo: "porcentaje", valor: 500 } }, { id: "o2" }] }],
    downsells: [{ id: "d1", cierresNecesarios: 9, descuento: { tipo: "porcentaje", valor: 99 } }],
  });
  assert.equal(c.ticks.length, 1);
  assert.equal(c.ticks[0].precio, 0);
  assert.equal(c.ticks[0].colores.marca, TICK_POR_DEFECTO.colores.marca);
  assert.equal(c.clicks[0].modo, "pre");
  assert.deepEqual(
    c.clicks[0].ofertas.map((o) => [o.productoId, o.descuento.valor]),
    [["9", 90]],
  );
  assert.equal(c.downsells[0].cierresNecesarios, 4);
  assert.equal(c.downsells[0].descuento.valor, 90);
  assert.deepEqual(normalizarUpsells(null), { ticks: [], clicks: [], downsells: [] });
});

test("validarExtras: solo acepta lo que existe, está activo y aplica al producto", () => {
  const cfg = normalizarUpsells({
    ticks: [
      { id: "envio", alcance: { tipo: "todos" } },
      { id: "garantia", activo: false },
      { id: "otro", alcance: { tipo: "productos", ids: ["999"] } },
    ],
    clicks: [{ id: "c1", ofertas: [{ id: "o1", productoId: "555" }, { id: "o2", productoId: "camelia1" }] }],
    downsells: [{ id: "d1" }, { id: "d2", activo: false }],
  });
  const carrito = [{ productoId: "111", coleccionIds: [] }];
  const r = validarExtras(cfg, carrito, {
    ticks: ["envio", "garantia", "otro", "inventado"],
    upsell: { upsellId: "c1", ofertaId: "o1" },
    downsell: "d1",
  });
  assert.deepEqual(r.ticks.map((t) => t.id), ["envio"]);
  assert.equal(r.upsell?.oferta.productoId, "555");
  assert.equal(r.downsell?.id, "d1");

  const falso = validarExtras(cfg, carrito, { upsell: { upsellId: "c1", ofertaId: "nope" }, downsell: "d2" });
  assert.equal(falso.upsell, null);
  assert.equal(falso.downsell, null);
  // El producto del upsell ya está en el pedido: no se agrega otra vez.
  const repetido = validarExtras(cfg, [{ productoId: "555", coleccionIds: [] }], { upsell: { upsellId: "c1", ofertaId: "o1" } });
  assert.equal(repetido.upsell, null);
});

test("porcentajeDownsell: % directo o monto fijo convertido", () => {
  const pct = { ...DOWNSELL_POR_DEFECTO, id: "d", descuento: { tipo: "porcentaje" as const, valor: 10 } };
  const monto = { ...DOWNSELL_POR_DEFECTO, id: "d", descuento: { tipo: "monto" as const, valor: 5000 } };
  assert.equal(porcentajeDownsell(pct, 100000), 10);
  assert.equal(porcentajeDownsell(monto, 100000), 5);
  assert.equal(porcentajeDownsell(null, 100000), 0);
});
