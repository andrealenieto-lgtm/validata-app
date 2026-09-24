import { test } from "node:test";
import assert from "node:assert/strict";

import { AJUSTES_POR_DEFECTO } from "../app/lib/reglas/ajustes.ts";
import {
  aplicarExtrasBorrador,
  aplicarExtrasOrden,
  totalOrden,
  enlaceAbono,
  inputContraentrega,
  inputContraentregaPaquete,
  inputPagoAnticipado,
  inputPagoAnticipadoPaquete,
  leerCliente,
} from "../app/lib/pedido.ts";

const TEL = "+573001234567";
const body = {
  nombre: " Ana ",
  apellido: "Pérez",
  direccion: "Cl 13 # 20-35",
  direccion2: "Apto 201",
  barrio: "Modelia",
  departamento: "CUNDINAMARCA",
  ciudad: "BOGOTA",
  horario: "Entre 8 am y 12 pm",
};
const variante = {
  id: "gid://shopify/ProductVariant/1",
  precio: 99700,
  titulo: "Centella Oil",
};

test("leerCliente: limpia y exige los campos obligatorios", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  assert.equal(r.cliente.nombre, "Ana");
  assert.deepEqual(leerCliente({ nombre: "Ana" }, TEL), {
    ok: false,
    faltan: ["direccion", "departamento", "ciudad"],
  });
  assert.equal(
    (leerCliente({ ...body, nombre: 123 }, TEL) as { ok: false }).ok,
    false,
  );
});

test("contraentrega: pedido pendiente con dirección y código de Bogotá", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const { order } = inputContraentrega(
    r.cliente,
    variante,
    2,
    "historial_bueno",
  );
  assert.deepEqual(order.lineItems, [{ variantId: variante.id, quantity: 2 }]);
  assert.equal(order.financialStatus, "PENDING");
  assert.equal(order.shippingAddress.provinceCode, "DC");
  assert.equal(order.shippingAddress.address2, "Apto 201 - Barrio Modelia");
  assert.ok(order.customAttributes.some((a) => a.key === "Horario"));
});

test("pago anticipado: borrador con el producto y 5% de descuento", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const p = inputPagoAnticipado(r.cliente, variante, 1, AJUSTES_POR_DEFECTO, "tasa_cod");
  assert.equal(p.monto, 94715);
  assert.deepEqual(p.input.lineItems, [{ variantId: variante.id, quantity: 1 }]);
  assert.deepEqual(p.input.appliedDiscount, { title: "Pago anticipado", valueType: "PERCENTAGE", value: 5 });
  assert.deepEqual(p.input.tags, ["validata", "pago-anticipado"]);
});

const cop = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const conWa = { ...AJUSTES_POR_DEFECTO, whatsapp: { ...AJUSTES_POR_DEFECTO.whatsapp, numero: "573009998877" } };

test("abono: enlace de WhatsApp con el pedido completo para cerrar la venta", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const url = enlaceAbono(r.cliente, variante, 1, conWa, cop);
  assert.ok(url?.startsWith("https://wa.me/573009998877?text="));
  const texto = decodeURIComponent(url!.split("text=")[1]);
  assert.equal(
    texto,
    "Hola, soy Ana Pérez. Quiero Centella Oil x1 por $99.700. Quiero abonar $29.910 y pagar $69.790 al recibir. " +
      "Envío a: Cl 13 # 20-35, Apto 201, Barrio Modelia, BOGOTA (CUNDINAMARCA). Celular: +573001234567.",
  );
});

test("abono: sin WhatsApp o sin abono configurado no hay enlace", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  assert.equal(enlaceAbono(r.cliente, variante, 1, AJUSTES_POR_DEFECTO, cop), null);
  const sinAbono = { ...conWa, abono: { tipo: "porcentaje" as const, valor: 0 } };
  assert.equal(enlaceAbono(r.cliente, variante, 1, sinAbono, cop), null);
});

test("campos del constructor: obligatorios propios y campos extra en el pedido", () => {
  const campos = [
    { nombre: "barrio", etiqueta: "Barrio", requerido: true },
    { nombre: "extra_cedula", etiqueta: "Cédula", requerido: true },
    { nombre: "extra_oculto", etiqueta: "Oculto", requerido: true, oculto: true },
  ];
  assert.deepEqual(leerCliente({ ...body, barrio: "" }, TEL, campos), { ok: false, faltan: ["barrio", "extra_cedula"] });
  const r = leerCliente({ ...body, extra_cedula: "1020304050" }, TEL, campos);
  assert.ok(r.ok);
  assert.deepEqual(r.cliente.extras, [{ etiqueta: "Cédula", valor: "1020304050" }]);
  const { order } = inputContraentrega(r.cliente, variante, 1, "historial_bueno");
  assert.ok(order.customAttributes.some((a) => a.key === "Cédula" && a.value === "1020304050"));
});

test("oferta por cantidad en contraentrega: precio unitario de la oferta y nota en el pedido", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const oferta = { titulo: "2 unidades", total: 159520, antes: 199400, moneda: "COP" };
  const { order } = inputContraentrega(r.cliente, variante, 2, "historial_bueno", oferta);
  assert.deepEqual(order.lineItems[0], {
    variantId: variante.id,
    quantity: 2,
    priceSet: { shopMoney: { amount: 79760, currencyCode: "COP" } },
  });
  assert.ok(order.tags.includes("oferta-cantidad"));
  assert.ok(order.customAttributes.some((a) => a.key === "Oferta" && a.value === "2 unidades (ahorro 39880)"));
});

test("oferta en pago anticipado: descuento de línea y el 5% encima", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const oferta = { titulo: "2 unidades", total: 159520, antes: 199400, moneda: "COP" };
  const p = inputPagoAnticipado(r.cliente, variante, 2, AJUSTES_POR_DEFECTO, "tasa_cod", oferta);
  assert.deepEqual(p.input.lineItems[0].appliedDiscount, { title: "Oferta 2 unidades", valueType: "PERCENTAGE", value: 20 });
  assert.equal(p.monto, 151544); // 159.520 - 5%
});

const paqueteCamelia = {
  titulo: "Paquete completo",
  moneda: "COP",
  total: 151680,
  antes: 189600,
  lineas: [
    { varianteId: "gid://shopify/ProductVariant/11", titulo: "Camelia", cantidad: 1, unitario: 71920, precioNormal: 89900 },
    { varianteId: "gid://shopify/ProductVariant/22", titulo: "Centella", cantidad: 1, unitario: 79760, precioNormal: 99700 },
  ],
};

test("paquete contraentrega: una línea por producto con su precio rebajado", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const { order } = inputContraentregaPaquete(r.cliente, paqueteCamelia, "historial_bueno");
  assert.deepEqual(
    order.lineItems.map((l) => [l.variantId, l.quantity, l.priceSet.shopMoney.amount]),
    [
      ["gid://shopify/ProductVariant/11", 1, 71920],
      ["gid://shopify/ProductVariant/22", 1, 79760],
    ],
  );
  assert.ok(order.tags.includes("paquete"));
  assert.ok(
    order.customAttributes.some(
      (a) => a.key === "Paquete" && a.value === "Paquete completo: Camelia x1 + Centella x1 (ahorro 37920)",
    ),
  );
});

test("paquete en pago anticipado: 20% por línea y el 5% encima", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const p = inputPagoAnticipadoPaquete(r.cliente, paqueteCamelia, AJUSTES_POR_DEFECTO, "tasa_cod");
  assert.deepEqual(
    p.input.lineItems.map((l) => l.appliedDiscount?.value),
    [20, 20],
  );
  assert.equal(p.monto, 144096); // 151.680 − 5%
});

const extras = (e: Partial<Parameters<typeof aplicarExtrasOrden>[1]>) => ({
  moneda: "COP",
  preciosBase: { [variante.id]: 99700 },
  ticks: [],
  upsell: null,
  pctDownsell: 0,
  ...e,
});

test("extras en contraentrega: envío prioritario, upsell −10% y downsell 10%", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const base = inputContraentrega(r.cliente, variante, 1, "historial_bueno");
  const envio = { titulo: "Envío prioritario", precio: 5000, requiereEnvio: false, cobrarImpuesto: false };
  const cojin = { varianteId: "gid://shopify/ProductVariant/77", titulo: "Cojín", unitario: 74610, precioNormal: 82900 };

  const conTick = aplicarExtrasOrden(base, extras({ ticks: [envio] }));
  assert.equal(totalOrden(conTick.order, { [variante.id]: 99700 }), 104700);
  assert.deepEqual(conTick.order.lineItems[1], {
    title: "Envío prioritario",
    quantity: 1,
    priceSet: { shopMoney: { amount: 5000, currencyCode: "COP" } },
    requiresShipping: false,
    taxable: false,
  });
  assert.ok(conTick.order.tags.includes("1-tick"));

  const todo = aplicarExtrasOrden(base, extras({ ticks: [envio], upsell: cojin, pctDownsell: 10 }));
  // (99.700 + 74.610 + 5.000) − 10% = 161.379
  assert.equal(totalOrden(todo.order), 161379);
  assert.deepEqual(todo.order.tags.slice(-3), ["1-tick", "upsell", "downsell"]);
  assert.ok(todo.order.customAttributes.some((a) => a.key === "Downsell" && a.value === "10% de descuento"));

  // Sin extras el pedido no cambia.
  assert.equal(aplicarExtrasOrden(base, extras({})), base);
});

test("extras en pago anticipado: downsell y 5% combinados sobre el total", () => {
  const r = leerCliente(body, TEL);
  assert.ok(r.ok);
  const base = inputPagoAnticipado(r.cliente, variante, 1, AJUSTES_POR_DEFECTO, "tasa_cod");
  const envio = { titulo: "Envío prioritario", precio: 5000, requiereEnvio: false, cobrarImpuesto: false };
  const p = aplicarExtrasBorrador(base, extras({ ticks: [envio], pctDownsell: 10 }), AJUSTES_POR_DEFECTO, 99700);
  // 1 − 0,9 × 0,95 = 14,5%
  assert.deepEqual(p.input.appliedDiscount, { title: "Descuento especial + Pago anticipado", valueType: "PERCENTAGE", value: 14.5 });
  assert.equal(p.monto, 89518.5); // 104.700 × 0,855
  assert.equal(p.input.lineItems.length, 2);
});
