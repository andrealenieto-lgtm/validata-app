import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lineas,
  motivoOculto,
  reportarCompra,
  revisarFraude,
  type Contexto,
  type ProteccionFraude,
  type Visibilidad,
} from "../app/lib/configuracion.ts";

const vis: Visibilidad = {
  activo: true,
  colocacion: "toda_la_tienda",
  desactivarEn: [],
  ocultarBotones: { pagar: false, agregarCarrito: false, comprarAhora: true },
  contenido: "producto_y_carrito",
  paises: ["CO"],
  desactivarSinStock: true,
};
const ctx: Contexto = {
  pagina: "producto",
  carrito: [{ productoId: "camelia", coleccionIds: ["skincare"] }],
  pais: "CO",
  total: 99700,
  hayStock: true,
};

test("visibilidad: se muestra por defecto", () => {
  assert.equal(motivoOculto(vis, ctx), null);
});

test("visibilidad: página, colocación, país, rango, stock y productos", () => {
  assert.equal(motivoOculto({ ...vis, activo: false }, ctx), "desactivado");
  assert.equal(motivoOculto({ ...vis, desactivarEn: ["inicio"] }, { ...ctx, pagina: "inicio" }), "pagina");
  assert.equal(motivoOculto({ ...vis, colocacion: "solo_carrito" }, ctx), "pagina");
  assert.equal(motivoOculto(vis, { ...ctx, pais: "MX" }), "pais");
  assert.equal(motivoOculto({ ...vis, rangoTotal: { max: 500000 } }, { ...ctx, total: 600000 }), "total_fuera_de_rango");
  assert.equal(motivoOculto(vis, { ...ctx, hayStock: false }), "sin_stock");
  assert.equal(motivoOculto({ ...vis, soloPara: { tipo: "productos", ids: ["otro"] } }, ctx), "producto_no_incluido");
  assert.equal(motivoOculto({ ...vis, excepto: { tipo: "colecciones", ids: ["skincare"] } }, ctx), "producto_excluido");
});

const fraude: ProteccionFraude = {
  limitePedidos: { maximo: 1, horas: 24 },
  maxUnidadesPorPedido: 10,
  telefonosBloqueados: ["+576949130303"],
  correosBloqueados: ["andrew@gmail.com", "domain.com"],
  ipsBloqueadas: ["191.156.146.175", "2A05:9402:0:C:A705:5:0:28FF"],
  ipsPermitidas: ["219.109.22.2"],
  codigosPostales: { modo: "bloquear", codigos: ["110111"] },
  mensajeBloqueo: "Lo siento, no se le permite realizar más pedidos",
};
const intento = { telefono: "+573001234567", ip: "1.2.3.4", unidades: 1 };
const HORA = 3_600_000;

test("fraude: listas negras", () => {
  assert.equal(revisarFraude(fraude, intento, []), null);
  assert.equal(revisarFraude(fraude, { ...intento, telefono: "+576949130303" }, []), "telefono_bloqueado");
  assert.equal(revisarFraude(fraude, { ...intento, correo: "Andrew@Gmail.com" }, []), "correo_bloqueado");
  assert.equal(revisarFraude(fraude, { ...intento, correo: "x@domain.com" }, []), "correo_bloqueado");
  assert.equal(revisarFraude(fraude, { ...intento, correo: "x@otrodomain.com" }, []), null);
  assert.equal(revisarFraude(fraude, { ...intento, ip: "2a05:9402:0:c:a705:5:0:28ff" }, []), "ip_bloqueada");
  assert.equal(revisarFraude(fraude, { ...intento, codigoPostal: "110111" }, []), "codigo_postal");
  assert.equal(revisarFraude(fraude, { ...intento, unidades: 11 }, []), "demasiadas_unidades");
});

test("fraude: 1 pedido por teléfono/IP/correo en 24 h", () => {
  const ahora = 100 * HORA;
  const previo = { telefono: "+573001234567", ip: "9.9.9.9", fecha: ahora - 2 * HORA };
  assert.equal(revisarFraude(fraude, intento, [previo], ahora), "limite_pedidos");
  assert.equal(revisarFraude(fraude, intento, [{ ...previo, fecha: ahora - 25 * HORA }], ahora), null);
  assert.equal(revisarFraude(fraude, intento, [{ telefono: "+570000000000", ip: "1.2.3.4", fecha: ahora - HORA }], ahora), "limite_pedidos");
});

test("fraude: IP permitida y pedidos de prueba nunca se bloquean", () => {
  assert.equal(revisarFraude(fraude, { ...intento, telefono: "+576949130303", ip: "219.109.22.2" }, []), null);
  assert.equal(revisarFraude(fraude, { ...intento, telefono: "+576949130303", esPrueba: true }, []), null);
});

test("textarea a lista", () => {
  assert.deepEqual(lineas(" +57300\n\n+57300\r\n+57301 "), ["+57300", "+57301"]);
});

test("píxeles: la compra se reporta solo si el pedido es real", () => {
  assert.equal(reportarCompra("contraentrega", false), true);
  assert.equal(reportarCompra("pago_previo", false), false);
  assert.equal(reportarCompra("pago_previo", true), true);
  assert.equal(reportarCompra("whatsapp", false), false);
});
