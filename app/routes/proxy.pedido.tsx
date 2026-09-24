// POST /apps/validata/pedido (App Proxy): crea el pedido que envía el formulario.
// Vuelve a validar el teléfono y toma el precio de Shopify: nada de lo que decide el pago
// se confía al navegador.

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { limitador, validarTelefono } from "../lib/reglas/validacion.ts";
import {
  aplicarExtrasBorrador,
  aplicarExtrasOrden,
  totalOrden,
  type DatosCliente,
  type ExtrasCobro,
  enlaceAbono,
  inputContraentrega,
  inputContraentregaPaquete,
  inputPagoAnticipado,
  inputPagoAnticipadoPaquete,
  leerCliente,
  type FormaPago,
  type PaqueteAplicado,
} from "../lib/pedido.ts";
import {
  cobroNivel,
  ofertaParaProducto,
  paqueteParaProducto,
} from "../lib/ofertas.ts";
import { cobrarPaquete, productosDelPaquete } from "../paquetes.server";
import {
  porcentajeDownsell,
  precioOfertaUpsell,
  validarExtras,
} from "../lib/upsells.ts";
import {
  fuentesPara,
  listarOfertas,
  listarPaquetes,
  obtenerUpsells,
  obtenerTienda,
  registrarEvento,
} from "../tienda.server";
import {
  comprobarCodigo,
  completarBorrador,
  enviarASheets,
  enviarMensaje,
  obtenerMensajeria,
  verificacionActiva,
} from "../mensajes.server";
import type { ConfigMensajeria } from "../lib/mensajeria.ts";

const porIp = limitador(5, 10 * 60 * 1000);
const MAX_PEDIDOS_TELEFONO_24H = 3;

const json = (data: unknown, status = 200) => Response.json(data, { status });

/**
 * Mensaje al cliente, fila en Google Sheets y cierre del carrito abandonado. Corre después de
 * responder: si un proveedor está lento o caído, el cliente no espera ni pierde su pedido.
 */
function notificar(
  shop: string,
  cfg: ConfigMensajeria,
  c: DatosCliente,
  p: {
    evento: "pedido_confirmado" | "pago_previo";
    pedido: string;
    total: string;
    producto: string;
    cantidad: number;
    pago: string;
    estado: string;
    enlace?: string;
    utm?: unknown;
  },
) {
  const utm = (p.utm ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : "");
  void Promise.allSettled([
    enviarMensaje(
      shop,
      p.evento,
      c.telefono,
      {
        nombre: c.nombre,
        pedido: p.pedido,
        total: p.total,
        producto: p.producto,
        direccion: c.direccion,
        ciudad: c.ciudad,
        enlace: p.enlace,
      },
      cfg,
    ),
    enviarASheets(
      shop,
      {
        fecha: new Date().toLocaleString("es-CO", {
          timeZone: "America/Bogota",
        }),
        pedido: p.pedido,
        nombre: c.nombre,
        apellido: c.apellido,
        telefono: c.telefono,
        departamento: c.departamento,
        ciudad: c.ciudad,
        direccion: [c.direccion, c.direccion2].filter(Boolean).join(" - "),
        barrio: c.barrio,
        producto: p.producto,
        cantidad: p.cantidad,
        total: p.total,
        pago: p.pago,
        estado: p.estado,
        utm_source: s(utm.fuente),
        utm_campaign: s(utm.campana),
      },
      cfg,
    ),
    completarBorrador(shop, c.telefono),
  ]).then((r) =>
    r.forEach(
      (x) => x.status === "rejected" && console.error("notificar", x.reason),
    ),
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin)
    return json({ ok: false, error: "no_instalada" }, 404);
  const shop = session.shop;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip && !porIp(`${shop}:${ip}`))
    return json({ ok: false, error: "demasiados_pedidos" }, 429);

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  let cantidad = Math.min(
    10,
    Math.max(1, Math.floor(Number(body.cantidad) || 1)),
  );
  const forma: FormaPago =
    body.pago === "anticipado" || body.pago === "abono"
      ? body.pago
      : "contraentrega";
  const variantId = String(body.variante ?? "").replace(/\D/g, "");
  if (!variantId) return json({ ok: false, error: "producto_invalido" }, 400);

  // Precio real de la variante.
  const rv = await admin.graphql(
    `#graphql
    query variante($id: ID!) {
      productVariant(id: $id) {
        id price compareAtPrice displayName availableForSale
        product { id collections(first: 50) { nodes { id } } }
      }
      shop { currencyCode name }
    }`,
    { variables: { id: `gid://shopify/ProductVariant/${variantId}` } },
  );
  const datosVariante = (await rv.json()).data;
  const v = datosVariante?.productVariant;
  const moneda: string = datosVariante?.shop?.currencyCode ?? "COP";
  const nombreTienda: string = datosVariante?.shop?.name ?? "";
  if (!v) return json({ ok: false, error: "producto_invalido" }, 400);
  if (!v.availableForSale) return json({ ok: false, error: "agotado" }, 409);
  const variante = {
    id: v.id as string,
    precio: Number(v.price),
    titulo: v.displayName as string,
  };
  let total = variante.precio * cantidad;

  // Oferta por cantidad: el nivel lo elige el cliente, pero cantidad y precio salen de la
  // oferta guardada para este producto. Un nivel que no existe se rechaza.
  let oferta;
  if (typeof body.nivel === "string" && body.nivel) {
    const cobro = cobroNivel(
      ofertaParaProducto(await listarOfertas(shop), v.product.id),
      body.nivel,
      {
        precio: variante.precio,
        precioComparacion: v.compareAtPrice ? Number(v.compareAtPrice) : null,
      },
    );
    if (!cobro) return json({ ok: false, error: "oferta_invalida" }, 400);
    cantidad = cobro.cantidad;
    total = cobro.total;
    oferta = {
      titulo: cobro.nivel.titulo,
      total: cobro.total,
      antes: variante.precio * cobro.cantidad,
      moneda,
    };
  }

  // Paquete (combo): los productos, variantes y precios salen del paquete guardado y de
  // Shopify; del navegador solo se acepta cuál paquete eligió.
  let paquete: PaqueteAplicado | undefined;
  let tituloProducto = variante.titulo;
  if (typeof body.paquete === "string" && body.paquete) {
    const definido = paqueteParaProducto(
      await listarPaquetes(shop),
      v.product.id,
    );
    if (!definido || definido.id !== body.paquete)
      return json({ ok: false, error: "paquete_invalido" }, 400);
    const cobro = cobrarPaquete(
      definido,
      await productosDelPaquete(admin, definido, {
        productoId: String(v.product.id).replace(/\D/g, ""),
        varianteId: variante.id,
      }),
      moneda,
    );
    if (!cobro) return json({ ok: false, error: "paquete_invalido" }, 400);
    if (!cobro.disponible) return json({ ok: false, error: "agotado" }, 409);
    paquete = cobro;
    oferta = undefined; // el paquete reemplaza a la oferta por cantidad
    total = cobro.total;
    tituloProducto = `${cobro.titulo}: ${cobro.lineas.map((l) => l.titulo).join(" + ")}`;
  }

  // Extras (casillas 1-Tick, upsell de 1 clic y downsell): del navegador solo llegan ids; se
  // aceptan los que existen y aplican a este producto, con precios del servidor.
  const productoId = String(v.product.id).replace(/\D/g, "");
  const carrito = [
    {
      productoId,
      coleccionIds: (
        (v.product.collections?.nodes ?? []) as { id: string }[]
      ).map((c) => c.id.replace(/\D/g, "")),
    },
  ];
  const sel = (body.extras ?? {}) as Record<string, unknown>;
  const validados = validarExtras(await obtenerUpsells(shop), carrito, sel);
  let upsellCobro: ExtrasCobro["upsell"] = null;
  if (validados.upsell) {
    const ru = await admin.graphql(
      `#graphql
      query upsell($id: ID!) {
        product(id: $id) { title variants(first: 50) { nodes { id price availableForSale } } }
      }`,
      {
        variables: {
          id: `gid://shopify/Product/${validados.upsell.oferta.productoId}`,
        },
      },
    );
    const pu = (await ru.json()).data?.product;
    const vu = (pu?.variants?.nodes ?? []).find(
      (x: { availableForSale: boolean }) => x.availableForSale,
    ) as { id: string; price: string } | undefined;
    if (pu && vu) {
      const precio = Number(vu.price);
      upsellCobro = {
        varianteId: vu.id,
        titulo: pu.title,
        unitario: precioOfertaUpsell(validados.upsell.oferta, { precio }).total,
        precioNormal: precio,
      };
    }
  }
  const brutoExtras =
    (upsellCobro?.unitario ?? 0) +
    validados.ticks.reduce((s, t) => s + t.precio, 0);
  const pctDownsell = porcentajeDownsell(
    validados.downsell,
    total + brutoExtras,
  );
  const extras: ExtrasCobro = {
    moneda,
    preciosBase: { [variante.id]: variante.precio },
    ticks: validados.ticks,
    upsell: upsellCobro,
    pctDownsell,
  };
  const totalProductos = total;
  total =
    Math.round((total + brutoExtras) * (1 - pctDownsell / 100) * 100) / 100;

  const tienda = await obtenerTienda(shop);
  const r = await validarTelefono({
    telefono: typeof body.telefono === "string" ? body.telefono : "",
    ajustes: tienda.ajustes,
    fuentes: fuentesPara(shop, tienda.ajustes),
    modoHuella: "oculta",
    telefonoVerificado: false,
    total,
    datos: {
      nombre: typeof body.nombre === "string" ? body.nombre : "",
      producto: tituloProducto,
      totalTexto: String(total),
    },
  });
  if (!r.publico.ok)
    return json({ ok: false, error: "telefono_invalido" }, 400);
  const { telefono, accion } = r.publico;

  const cliente = leerCliente(
    body,
    telefono,
    tienda.formularioConfig.bloques.flatMap((b) =>
      b.tipo === "campo" ? [b] : [],
    ),
  );
  if (!cliente.ok)
    return json(
      { ok: false, error: "faltan_campos", faltan: cliente.faltan },
      400,
    );

  // Evita pedidos repetidos del mismo teléfono (doble clic, bots).
  const recientes = await prisma.evento.count({
    where: {
      shop,
      tipo: "pedido",
      datos: { contains: `"telefono":"${telefono}"` },
      createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
  });
  if (recientes >= MAX_PEDIDOS_TELEFONO_24H)
    return json({ ok: false, error: "limite_pedidos" }, 429);

  const mensajeria = await obtenerMensajeria(shop);
  if (!mensajeria.nombreTienda) mensajeria.nombreTienda = nombreTienda;
  const formato = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: moneda === "COP" ? 0 : 2,
  });

  if (accion === "whatsapp") {
    void completarBorrador(shop, telefono).catch(() => {});
    return json({ ok: false, error: "whatsapp", whatsapp: r.publico.whatsapp });
  }
  // El navegador pidió contraentrega pero la validación exige pago previo: se le muestran las opciones.
  if (accion === "pago_previo" && forma === "contraentrega") {
    return json({ ok: false, error: "pago_previo", pagos: r.publico.pagos });
  }
  const motivo = r.motivo ?? "";

  // Verificación por código: solo para contraentrega, que es donde un número falso cuesta.
  if (accion === "contraentrega" && verificacionActiva(mensajeria)) {
    const codigo =
      typeof body.codigo === "string"
        ? body.codigo.replace(/\D/g, "").slice(0, 6)
        : "";
    const v = await comprobarCodigo(shop, telefono, codigo);
    if (v !== "valido")
      return json({
        ok: false,
        error: v === "sin_codigo" ? "codigo_requerido" : `codigo_${v}`,
      });
  }

  if (accion === "contraentrega") {
    const orden = aplicarExtrasOrden(
      paquete
        ? inputContraentregaPaquete(cliente.cliente, paquete, motivo)
        : inputContraentrega(
            cliente.cliente,
            variante,
            cantidad,
            motivo,
            oferta,
          ),
      extras,
    );
    // Total exacto de lo que se cobra: la suma de las líneas del pedido.
    total = totalOrden(orden.order, extras.preciosBase);
    const res = await admin.graphql(
      `#graphql
      mutation crear($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          order { id name }
          userErrors { field message }
        }
      }`,
      { variables: orden },
    );
    const d = (await res.json()).data?.orderCreate;
    if (!d?.order) {
      console.error("orderCreate", JSON.stringify(d?.userErrors));
      return json({ ok: false, error: "no_se_pudo_crear" }, 502);
    }
    await registrarEvento(shop, "pedido", {
      telefono,
      total,
      accion,
      pedido: d.order.name,
      utm: body.utm,
    });
    notificar(shop, mensajeria, cliente.cliente, {
      evento: "pedido_confirmado",
      pedido: d.order.name,
      total: formato.format(total),
      producto: tituloProducto,
      cantidad,
      pago: "contraentrega",
      estado: "pendiente de envío",
      utm: body.utm,
    });
    return json({
      ok: true,
      tipo: "pedido",
      pedido: d.order.name,
      total,
    });
  }

  // Abono: la app no cobra; el cliente pasa a WhatsApp con su pedido para cerrar la venta.
  if (forma === "abono") {
    const url = enlaceAbono(
      cliente.cliente,
      paquete ? { ...variante, titulo: tituloProducto } : variante,
      paquete ? 1 : cantidad,
      tienda.ajustes,
      (n) => formato.format(n),
      total,
    );
    if (!url) return json({ ok: false, error: "abono_no_disponible" }, 400);
    await registrarEvento(shop, "abono_whatsapp", { telefono, total, motivo });
    void completarBorrador(shop, telefono).catch(() => {});
    return json({ ok: true, tipo: "whatsapp", url });
  }

  const p = aplicarExtrasBorrador(
    paquete
      ? inputPagoAnticipadoPaquete(
          cliente.cliente,
          paquete,
          tienda.ajustes,
          motivo,
        )
      : inputPagoAnticipado(
          cliente.cliente,
          variante,
          cantidad,
          tienda.ajustes,
          motivo,
          oferta,
        ),
    extras,
    tienda.ajustes,
    totalProductos,
  );
  const res = await admin.graphql(
    `#graphql
    mutation borrador($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name invoiceUrl }
        userErrors { field message }
      }
    }`,
    { variables: { input: p.input } },
  );
  const d = (await res.json()).data?.draftOrderCreate;
  if (!d?.draftOrder?.invoiceUrl) {
    console.error("draftOrderCreate", JSON.stringify(d?.userErrors));
    return json({ ok: false, error: "no_se_pudo_crear" }, 502);
  }
  await registrarEvento(shop, "pedido_pago_previo", {
    telefono,
    total,
    forma,
    borrador: d.draftOrder.name,
  });
  notificar(shop, mensajeria, cliente.cliente, {
    evento: "pago_previo",
    pedido: d.draftOrder.name,
    total: formato.format(p.monto ?? total),
    producto: tituloProducto,
    cantidad,
    pago: "anticipado",
    estado: "esperando pago",
    enlace: d.draftOrder.invoiceUrl,
    utm: body.utm,
  });
  return json({
    ok: true,
    tipo: "pago",
    url: d.draftOrder.invoiceUrl,
    monto: p.monto,
  });
};
