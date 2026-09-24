// Arma el pedido que llega del formulario: valida los datos del cliente y construye el input
// de Shopify según el resultado de la validación por teléfono.
//  - contraentrega → orderCreate (pedido pendiente de pago, se cobra al entregar).
//  - pago anticipado → draftOrderCreate; el cliente paga en el checkout de Shopify (invoiceUrl).
//  - abono → la app no cobra: el cliente pasa a WhatsApp con sus datos para cerrar la venta.

import type { Ajustes } from "./reglas/ajustes.ts";
import { calcularPagos, enlaceWhatsapp } from "./reglas/motor.ts";
import { codigoProvincia } from "./colombia.ts";

export type FormaPago = "contraentrega" | "anticipado" | "abono";

export interface DatosCliente {
  nombre: string;
  apellido: string;
  telefono: string; // E.164, ya normalizado
  direccion: string;
  direccion2: string;
  barrio: string;
  departamento: string;
  ciudad: string;
  horario: string;
  /** Campos que agregó el comerciante en el constructor (p. ej. "Cédula"). */
  extras: { etiqueta: string; valor: string }[];
}

/** Lo que el servidor necesita saber de los campos del formulario configurado. */
export interface CampoFormulario {
  nombre: string;
  etiqueta: string;
  requerido: boolean;
  oculto?: boolean;
}

export interface Variante {
  id: string; // gid://shopify/ProductVariant/…
  precio: number;
  titulo: string; // "Producto - Variante"
}

const REQUERIDOS: (keyof DatosCliente)[] = [
  "nombre",
  "telefono",
  "direccion",
  "departamento",
  "ciudad",
];

/**
 * Limpia los campos que manda el navegador. Además de los obligatorios de siempre, exige los
 * que el comerciante marcó como obligatorios en el constructor y recoge sus campos propios.
 */
export function leerCliente(
  body: Record<string, unknown>,
  telefonoE164: string,
  campos: CampoFormulario[] = [],
): { ok: true; cliente: DatosCliente } | { ok: false; faltan: string[] } {
  const t = (k: string, max = 120) =>
    typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "";
  const visibles = campos.filter((c) => !c.oculto);
  const cliente: DatosCliente = {
    nombre: t("nombre", 60),
    apellido: t("apellido", 60),
    telefono: telefonoE164,
    direccion: t("direccion", 200),
    direccion2: t("direccion2", 120),
    barrio: t("barrio"),
    departamento: t("departamento"),
    ciudad: t("ciudad"),
    horario: t("horario"),
    extras: visibles
      .filter((c) => c.nombre.startsWith("extra_"))
      .map((c) => ({ etiqueta: c.etiqueta, valor: t(c.nombre, 200) }))
      .filter((x) => x.valor),
  };
  const requeridos = new Set<string>([
    ...REQUERIDOS,
    ...visibles.filter((c) => c.requerido).map((c) => c.nombre),
  ]);
  const faltan = [...requeridos].filter((k) =>
    k === "telefono" ? !cliente.telefono : !t(k),
  );
  return faltan.length ? { ok: false, faltan } : { ok: true, cliente };
}

function direccion(c: DatosCliente) {
  const provinceCode = codigoProvincia(c.departamento, c.ciudad);
  return {
    firstName: c.nombre,
    lastName: c.apellido || "-",
    address1: c.direccion,
    address2:
      [c.direccion2, c.barrio && `Barrio ${c.barrio}`]
        .filter(Boolean)
        .join(" - ") || undefined,
    city: c.ciudad,
    ...(provinceCode ? { provinceCode } : {}),
    countryCode: "CO",
    phone: c.telefono,
  };
}

function atributos(c: DatosCliente, extra: Record<string, string>) {
  return Object.entries({
    Departamento: c.departamento,
    Barrio: c.barrio,
    Horario: c.horario,
    ...Object.fromEntries(c.extras.map((x) => [x.etiqueta, x.valor])),
    ...extra,
  })
    .filter(([, v]) => v)
    .map(([key, value]) => ({ key, value }));
}

/** Oferta por cantidad ya cobrada por el servidor (ver cobroNivel en ofertas.ts). */
export interface OfertaAplicada {
  titulo: string; // "2 unidades"
  /** Total de la línea con la oferta. */
  total: number;
  /** Total de la línea sin la oferta. */
  antes: number;
  moneda: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function atributoOferta(o: OfertaAplicada | undefined): Record<string, string> {
  return o ? { Oferta: `${o.titulo} (ahorro ${r2(o.antes - o.total)})` } : {};
}

export function inputContraentrega(
  c: DatosCliente,
  v: Variante,
  cantidad: number,
  motivo: string,
  oferta?: OfertaAplicada,
) {
  const dir = direccion(c);
  return {
    order: {
      lineItems: [
        {
          variantId: v.id,
          quantity: cantidad,
          // Precio unitario de la oferta: así el total del pedido (y lo que cobra la
          // transportadora) ya viene con el descuento.
          ...(oferta
            ? {
                priceSet: {
                  shopMoney: {
                    amount: r2(oferta.total / cantidad),
                    currencyCode: oferta.moneda,
                  },
                },
              }
            : {}),
        },
      ],
      phone: c.telefono,
      shippingAddress: dir,
      billingAddress: dir,
      financialStatus: "PENDING",
      tags: [
        "validata",
        "contraentrega",
        ...(oferta ? ["oferta-cantidad"] : []),
      ],
      customAttributes: atributos(c, {
        Validata: motivo,
        ...atributoOferta(oferta),
      }),
    },
    options: {
      inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
      sendReceipt: false,
    },
  };
}

export function inputPagoAnticipado(
  c: DatosCliente,
  v: Variante,
  cantidad: number,
  ajustes: Ajustes,
  motivo: string,
  oferta?: OfertaAplicada,
) {
  const dir = direccion(c);
  const total = oferta ? oferta.total : v.precio * cantidad;
  // En borradores la oferta va como descuento de la línea (en %), y el del pago anticipado
  // se aplica encima, sobre el total ya rebajado.
  const pctOferta =
    oferta && oferta.antes > 0
      ? r2((1 - oferta.total / oferta.antes) * 100)
      : 0;
  return {
    input: {
      phone: c.telefono,
      shippingAddress: dir,
      billingAddress: dir,
      customAttributes: atributos(c, {
        Validata: motivo,
        ...atributoOferta(oferta),
      }),
      lineItems: [
        {
          variantId: v.id,
          quantity: cantidad,
          ...(pctOferta > 0
            ? {
                appliedDiscount: {
                  title: `Oferta ${oferta!.titulo}`,
                  valueType: "PERCENTAGE",
                  value: pctOferta,
                },
              }
            : {}),
        },
      ],
      ...(ajustes.descuentoAnticipado > 0
        ? {
            appliedDiscount: {
              title: "Pago anticipado",
              valueType: "PERCENTAGE",
              value: ajustes.descuentoAnticipado,
            },
          }
        : {}),
      tags: [
        "validata",
        "pago-anticipado",
        ...(oferta ? ["oferta-cantidad"] : []),
      ],
    },
    monto: calcularPagos(total, ajustes, 2).anticipado,
  };
}

/** Una línea de un paquete ya cobrada por el servidor (ver precioPaquete en ofertas.ts). */
export interface LineaPaqueteCobro {
  varianteId: string;
  titulo: string;
  cantidad: number;
  unitario: number;
  /** Precio por unidad sin el descuento del paquete. */
  precioNormal: number;
}

export interface PaqueteAplicado {
  titulo: string; // "Paquete completo"
  lineas: LineaPaqueteCobro[];
  total: number;
  antes: number;
  moneda: string;
}

const atributoPaquete = (p: PaqueteAplicado) => ({
  Paquete: `${p.titulo}: ${p.lineas.map((l) => `${l.titulo} x${l.cantidad}`).join(" + ")} (ahorro ${r2(p.antes - p.total)})`,
});

/** Pedido contraentrega de un paquete: una línea por producto con su precio ya rebajado. */
export function inputContraentregaPaquete(
  c: DatosCliente,
  paquete: PaqueteAplicado,
  motivo: string,
) {
  const dir = direccion(c);
  return {
    order: {
      lineItems: paquete.lineas.map((l) => ({
        variantId: l.varianteId,
        quantity: l.cantidad,
        priceSet: {
          shopMoney: { amount: l.unitario, currencyCode: paquete.moneda },
        },
      })),
      phone: c.telefono,
      shippingAddress: dir,
      billingAddress: dir,
      financialStatus: "PENDING",
      tags: ["validata", "contraentrega", "paquete"],
      customAttributes: atributos(c, {
        Validata: motivo,
        ...atributoPaquete(paquete),
      }),
    },
    options: {
      inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
      sendReceipt: false,
    },
  };
}

/** Borrador de pago anticipado de un paquete: descuento por línea y el del pago anticipado encima. */
export function inputPagoAnticipadoPaquete(
  c: DatosCliente,
  paquete: PaqueteAplicado,
  ajustes: Ajustes,
  motivo: string,
) {
  const dir = direccion(c);
  return {
    input: {
      phone: c.telefono,
      shippingAddress: dir,
      billingAddress: dir,
      customAttributes: atributos(c, {
        Validata: motivo,
        ...atributoPaquete(paquete),
      }),
      lineItems: paquete.lineas.map((l) => {
        const pct =
          l.precioNormal > 0 ? r2((1 - l.unitario / l.precioNormal) * 100) : 0;
        return {
          variantId: l.varianteId,
          quantity: l.cantidad,
          ...(pct > 0
            ? {
                appliedDiscount: {
                  title: paquete.titulo,
                  valueType: "PERCENTAGE",
                  value: pct,
                },
              }
            : {}),
        };
      }),
      ...(ajustes.descuentoAnticipado > 0
        ? {
            appliedDiscount: {
              title: "Pago anticipado",
              valueType: "PERCENTAGE",
              value: ajustes.descuentoAnticipado,
            },
          }
        : {}),
      tags: ["validata", "pago-anticipado", "paquete"],
    },
    monto: calcularPagos(paquete.total, ajustes, 2).anticipado,
  };
}

/**
 * Enlace de WhatsApp para cerrar un abono con un asesor. Lleva el pedido completo (producto,
 * montos y dirección) para que la tienda no tenga que volver a preguntar nada.
 * null si la tienda no tiene WhatsApp o el abono no aplica a este total.
 */
export function enlaceAbono(
  c: DatosCliente,
  v: Variante,
  cantidad: number,
  ajustes: Ajustes,
  formatear: (n: number) => string,
  totalOferta?: number,
): string | null {
  const total = totalOferta ?? v.precio * cantidad;
  const { abono } = calcularPagos(total, ajustes, 2);
  if (!abono) return null;
  return enlaceWhatsapp(
    ajustes,
    {
      nombre: [c.nombre, c.apellido].filter(Boolean).join(" "),
      producto: v.titulo,
      cantidad,
      total: formatear(total),
      abono: formatear(abono.monto),
      saldo: formatear(abono.saldoContraentrega),
      telefono: c.telefono,
      direccion: [c.direccion, c.direccion2, c.barrio && `Barrio ${c.barrio}`]
        .filter(Boolean)
        .join(", "),
      ciudad: c.ciudad,
      departamento: c.departamento,
    },
    ajustes.whatsapp.mensajeAbono,
  );
}

// ─── Extras: casillas (1-Tick), upsell de 1 clic y downsell ─────────────────

export interface ExtrasCobro {
  moneda: string;
  /** Precio normal de las líneas que no traen precio propio (producto sin oferta). */
  preciosBase: Record<string, number>;
  ticks: {
    titulo: string;
    precio: number;
    requiereEnvio: boolean;
    cobrarImpuesto: boolean;
    varianteId?: string;
  }[];
  upsell: {
    varianteId: string;
    titulo: string;
    unitario: number;
    precioNormal: number;
  } | null;
  /** % de descuento del downsell sobre todo el pedido (0 = sin downsell). */
  pctDownsell: number;
}

type LineaOrden = {
  variantId?: string;
  title?: string;
  quantity: number;
  priceSet?: { shopMoney: { amount: number; currencyCode: string } };
  requiresShipping?: boolean;
  taxable?: boolean;
};

const hayExtras = (e: ExtrasCobro) =>
  e.ticks.length > 0 || !!e.upsell || e.pctDownsell > 0;

/**
 * Agrega los extras a un pedido contraentrega ya armado (producto, oferta o paquete).
 * El downsell rebaja el precio de cada línea, así el total que cobra la transportadora ya
 * viene con el descuento.
 */
export function aplicarExtrasOrden<
  T extends {
    order: {
      lineItems: unknown[];
      tags: string[];
      customAttributes: { key: string; value: string }[];
    };
  },
>(base: T, e: ExtrasCobro): T {
  if (!hayExtras(e)) return base;
  const factor = 1 - e.pctDownsell / 100;
  const dinero = (amount: number) => ({
    shopMoney: { amount: r2(amount), currencyCode: e.moneda },
  });

  const lineas: LineaOrden[] = (base.order.lineItems as LineaOrden[]).map(
    (l) => {
      const unitario =
        l.priceSet?.shopMoney.amount ??
        (l.variantId ? e.preciosBase[l.variantId] : undefined);
      return unitario === undefined || !e.pctDownsell
        ? l
        : { ...l, priceSet: dinero(unitario * factor) };
    },
  );
  if (e.upsell)
    lineas.push({
      variantId: e.upsell.varianteId,
      quantity: 1,
      priceSet: dinero(e.upsell.unitario * factor),
    });
  for (const t of e.ticks)
    lineas.push(
      t.varianteId
        ? {
            variantId: `gid://shopify/ProductVariant/${t.varianteId}`,
            quantity: 1,
            priceSet: dinero(t.precio * factor),
          }
        : {
            title: t.titulo,
            quantity: 1,
            priceSet: dinero(t.precio * factor),
            requiresShipping: t.requiereEnvio,
            taxable: t.cobrarImpuesto,
          },
    );

  const notas: Record<string, string> = {};
  if (e.ticks.length)
    notas["Adicionales"] = e.ticks
      .map((t) => `${t.titulo} (${t.precio})`)
      .join(", ");
  if (e.upsell)
    notas["Upsell"] =
      `${e.upsell.titulo} (${e.upsell.unitario} en vez de ${e.upsell.precioNormal})`;
  if (e.pctDownsell) notas["Downsell"] = `${e.pctDownsell}% de descuento`;
  return {
    ...base,
    order: {
      ...base.order,
      lineItems: lineas,
      tags: [
        ...base.order.tags,
        ...(e.ticks.length ? ["1-tick"] : []),
        ...(e.upsell ? ["upsell"] : []),
        ...(e.pctDownsell ? ["downsell"] : []),
      ],
      customAttributes: [
        ...base.order.customAttributes,
        ...Object.entries(notas).map(([key, value]) => ({ key, value })),
      ],
    },
  };
}

/** Total real del pedido armado (suma de precio × cantidad de cada línea). */
export function totalOrden(
  order: { lineItems: unknown[] },
  preciosBase: Record<string, number> = {},
): number {
  return r2(
    (order.lineItems as LineaOrden[]).reduce(
      (s, l) =>
        s +
        (l.priceSet?.shopMoney.amount ??
          (l.variantId ? (preciosBase[l.variantId] ?? 0) : 0)) *
          l.quantity,
      0,
    ),
  );
}

/**
 * Extras en un borrador de pago anticipado. El downsell se suma al descuento del pago
 * anticipado (ambos sobre el total del pedido).
 */
export function aplicarExtrasBorrador<
  T extends {
    input: {
      lineItems: unknown[];
      tags: string[];
      customAttributes: { key: string; value: string }[];
      appliedDiscount?: unknown;
    };
  },
>(
  base: T & { monto: number },
  e: ExtrasCobro,
  ajustes: Ajustes,
  totalProductos: number,
): T & { monto: number } {
  if (!hayExtras(e)) return base;
  const lineas = [...(base.input.lineItems as Record<string, unknown>[])];
  if (e.upsell) {
    const pct =
      e.upsell.precioNormal > 0
        ? r2((1 - e.upsell.unitario / e.upsell.precioNormal) * 100)
        : 0;
    lineas.push({
      variantId: e.upsell.varianteId,
      quantity: 1,
      ...(pct > 0
        ? {
            appliedDiscount: {
              title: "Oferta especial",
              valueType: "PERCENTAGE",
              value: pct,
            },
          }
        : {}),
    });
  }
  for (const t of e.ticks)
    lineas.push(
      t.varianteId
        ? {
            variantId: `gid://shopify/ProductVariant/${t.varianteId}`,
            quantity: 1,
          }
        : {
            title: t.titulo,
            originalUnitPrice: t.precio,
            quantity: 1,
            requiresShipping: t.requiereEnvio,
            taxable: t.cobrarImpuesto,
          },
    );

  const bruto =
    totalProductos +
    (e.upsell?.unitario ?? 0) +
    e.ticks.reduce((s, t) => s + t.precio, 0);
  const pctTotal = r2(
    (1 - (1 - e.pctDownsell / 100) * (1 - ajustes.descuentoAnticipado / 100)) *
      100,
  );
  const titulo = [
    e.pctDownsell ? "Descuento especial" : "",
    ajustes.descuentoAnticipado ? "Pago anticipado" : "",
  ]
    .filter(Boolean)
    .join(" + ");
  return {
    ...base,
    input: {
      ...base.input,
      lineItems: lineas,
      ...(pctTotal > 0
        ? {
            appliedDiscount: {
              title: titulo,
              valueType: "PERCENTAGE",
              value: pctTotal,
            },
          }
        : {}),
      tags: [
        ...base.input.tags,
        ...(e.ticks.length ? ["1-tick"] : []),
        ...(e.upsell ? ["upsell"] : []),
        ...(e.pctDownsell ? ["downsell"] : []),
      ],
    },
    monto: r2(bruto * (1 - pctTotal / 100)),
  };
}
