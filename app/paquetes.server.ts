// Datos reales (Shopify) de los productos de un paquete y su precio con el descuento.
// Lo usan el formulario de la tienda (mostrar y cobrar) y el editor del panel (vista previa).

import { precioPaquete, type Paquete } from "./lib/ofertas.ts";
import type { LineaPaqueteCobro, PaqueteAplicado } from "./lib/pedido.ts";

type Admin = {
  graphql: (
    q: string,
    o?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export interface ProductoDelPaquete {
  productoId: string;
  varianteId: string;
  titulo: string;
  imagen: string | null;
  precio: number;
  comparacion: number | null;
  disponible: boolean;
}

/**
 * Consulta los productos del paquete. Para cada uno se usa la primera variante disponible,
 * salvo el producto que el cliente está viendo, que usa la variante que eligió en la página.
 */
export async function productosDelPaquete(
  admin: Admin,
  paquete: Paquete,
  elegida?: { productoId: string; varianteId: string },
): Promise<Record<string, ProductoDelPaquete>> {
  const r = await admin.graphql(
    `#graphql
    query paquete($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          featuredMedia { preview { image { url } } }
          variants(first: 50) { nodes { id price compareAtPrice availableForSale } }
        }
      }
    }`,
    {
      variables: {
        ids: paquete.productos.map(
          (p) => `gid://shopify/Product/${p.productoId}`,
        ),
      },
    },
  );
  type Nodo = {
    id?: string;
    title?: string;
    featuredMedia?: { preview?: { image?: { url?: string } } };
    variants?: {
      nodes: {
        id: string;
        price: string;
        compareAtPrice: string | null;
        availableForSale: boolean;
      }[];
    };
  };
  const nodos = ((await r.json()).data?.nodes ?? []) as (Nodo | null)[];

  const resultado: Record<string, ProductoDelPaquete> = {};
  for (const n of nodos) {
    if (!n?.id || !n.variants?.nodes.length) continue;
    const productoId = n.id.replace(/\D/g, "");
    const variantes = n.variants.nodes;
    const v =
      (elegida?.productoId === productoId &&
        variantes.find(
          (x) =>
            x.id.replace(/\D/g, "") === elegida.varianteId.replace(/\D/g, ""),
        )) ||
      variantes.find((x) => x.availableForSale) ||
      variantes[0];
    resultado[productoId] = {
      productoId,
      varianteId: v.id,
      titulo: n.title ?? "",
      imagen: n.featuredMedia?.preview?.image?.url ?? null,
      precio: Number(v.price),
      comparacion: v.compareAtPrice ? Number(v.compareAtPrice) : null,
      disponible: v.availableForSale,
    };
  }
  return resultado;
}

/** Precio del paquete con los datos reales. null si falta algún producto (borrado de la tienda). */
export function cobrarPaquete(
  paquete: Paquete,
  datos: Record<string, ProductoDelPaquete>,
  moneda: string,
): (PaqueteAplicado & { disponible: boolean }) | null {
  if (paquete.productos.some((p) => !datos[p.productoId])) return null;
  const precio = precioPaquete(
    paquete,
    Object.fromEntries(
      Object.values(datos).map((d) => [d.productoId, { precio: d.precio }]),
    ),
  );
  const lineas: LineaPaqueteCobro[] = precio.lineas.map((l) => ({
    varianteId: datos[l.productoId].varianteId,
    titulo: datos[l.productoId].titulo,
    cantidad: l.cantidad,
    unitario: l.unitario,
    precioNormal: datos[l.productoId].precio,
  }));
  return {
    titulo: paquete.titulo,
    lineas,
    total: precio.total,
    antes: precio.antes,
    moneda,
    disponible: paquete.productos.every((p) => datos[p.productoId].disponible),
  };
}
