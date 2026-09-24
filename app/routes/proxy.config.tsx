// GET /apps/validata/config?producto=ID&variante=ID (App Proxy): configuración pública del
// formulario de la tienda, la oferta por cantidad y el paquete (combo) que aplican al producto.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { ofertaParaProducto, paqueteParaProducto } from "../lib/ofertas.ts";
import {
  listarOfertas,
  listarPaquetes,
  obtenerTienda,
  obtenerUpsells,
} from "../tienda.server";
import {
  aplicaA,
  precioOfertaUpsell,
  ticksParaCarrito,
  upsellParaCarrito,
} from "../lib/upsells.ts";
import { cobrarPaquete, productosDelPaquete } from "../paquetes.server";
import { obtenerMensajeria, verificacionActiva } from "../mensajes.server";
import { proveedorListo } from "../lib/mensajeria.ts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ ok: false }, { status: 404 });

  const url = new URL(request.url);
  const producto = (url.searchParams.get("producto") ?? "").replace(/\D/g, "");
  const variante = (url.searchParams.get("variante") ?? "").replace(/\D/g, "");
  const [tienda, ofertas, paquetes] = await Promise.all([
    obtenerTienda(session.shop),
    producto ? listarOfertas(session.shop) : Promise.resolve([]),
    producto ? listarPaquetes(session.shop) : Promise.resolve([]),
  ]);
  const oferta = producto ? ofertaParaProducto(ofertas, producto) : null;

  // Paquete: se manda ya calculado con los precios reales (el servidor lo recalcula al cobrar).
  const definido = producto ? paqueteParaProducto(paquetes, producto) : null;
  let paquete = null;
  if (definido && admin) {
    const datos = await productosDelPaquete(admin, definido, {
      productoId: producto,
      varianteId: variante,
    });
    const cobro = cobrarPaquete(definido, datos, "");
    if (cobro?.disponible) {
      paquete = {
        id: definido.id,
        titulo: definido.titulo,
        subtitulo: definido.subtitulo,
        etiqueta: definido.etiqueta,
        textoPrecioEstandar: definido.textoPrecioEstandar,
        porDefecto: definido.porDefecto,
        plantilla: definido.plantilla,
        diseno: definido.diseno,
        total: cobro.total,
        antes: cobro.antes,
        productos: cobro.lineas.map((l, i) => ({
          titulo: l.titulo,
          cantidad: l.cantidad,
          imagen: datos[definido.productos[i].productoId]?.imagen ?? null,
          total: Math.round(l.unitario * l.cantidad * 100) / 100,
          antes: l.precioNormal * l.cantidad,
        })),
      };
    }
  }
  // Upsells y downsells que aplican a este producto (por producto o por colección).
  let extras = null;
  if (producto && admin) {
    const cfg = await obtenerUpsells(session.shop);
    if (cfg.ticks.length || cfg.clicks.length || cfg.downsells.length) {
      const rc = await admin.graphql(
        `#graphql
        query colecciones($id: ID!) { product(id: $id) { collections(first: 50) { nodes { id } } } }`,
        { variables: { id: `gid://shopify/Product/${producto}` } },
      );
      const colecciones = (
        ((await rc.json()).data?.product?.collections?.nodes ?? []) as {
          id: string;
        }[]
      ).map((c) => c.id.replace(/\D/g, ""));
      const carrito = [{ productoId: producto, coleccionIds: colecciones }];

      const click = upsellParaCarrito(cfg.clicks, "pre", carrito);
      let ofertasClick: unknown[] = [];
      if (click) {
        const ids = click.ofertas
          .filter((o) => o.productoId !== producto)
          .map((o) => `gid://shopify/Product/${o.productoId}`);
        const rp = ids.length
          ? await admin.graphql(
              `#graphql
              query ofertas($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on Product {
                    id title featuredMedia { preview { image { url } } }
                    variants(first: 50) { nodes { price availableForSale } }
                  }
                }
              }`,
              { variables: { ids } },
            )
          : null;
        type Nodo = {
          id?: string;
          title?: string;
          featuredMedia?: { preview?: { image?: { url?: string } } };
          variants?: { nodes: { price: string; availableForSale: boolean }[] };
        };
        const nodos = rp
          ? (((await rp.json()).data?.nodes ?? []) as (Nodo | null)[])
          : [];
        ofertasClick = click.ofertas.flatMap((o) => {
          const n = nodos.find(
            (x) => x?.id?.replace(/\D/g, "") === o.productoId,
          );
          const v = n?.variants?.nodes.find((x) => x.availableForSale);
          if (!n || !v) return []; // sin stock o producto actual: no se ofrece
          const precio = Number(v.price);
          const p = precioOfertaUpsell(o, { precio });
          return [
            {
              id: o.id,
              titulo: n.title,
              imagen: n.featuredMedia?.preview?.image?.url ?? null,
              antes: p.antes,
              total: p.total,
              descuento: o.descuento,
              temporizadorMin: o.temporizadorMin,
            },
          ];
        });
      }
      const downsell =
        cfg.downsells.find((d) => d.activo && aplicaA(d.alcance, carrito)) ??
        null;
      extras = {
        ticks: ticksParaCarrito(cfg.ticks, carrito).map((t) => ({
          id: t.id,
          titulo: t.titulo,
          precio: t.precio,
          texto: t.texto,
          colores: t.colores,
        })),
        upsell:
          click && ofertasClick.length
            ? {
                id: click.id,
                textos: click.textos,
                colores: click.colores,
                ofertas: ofertasClick,
              }
            : null,
        downsell: downsell && {
          id: downsell.id,
          cierresNecesarios: downsell.cierresNecesarios,
          descuento: downsell.descuento,
          textos: downsell.textos,
          colores: downsell.colores,
        },
      };
    }
  }

  // Integraciones que cambian el formulario. La clave de Google Maps es pública por diseño
  // (va en el navegador); se protege restringiéndola al dominio de la tienda en Google Cloud.
  const m = await obtenerMensajeria(session.shop);
  const integraciones = {
    verificacion: verificacionActiva(m),
    carrito:
      m.plantillas.carrito_abandonado.activa && proveedorListo(m.proveedor),
    autocompletado:
      m.autocompletadoGoogle.activo && m.autocompletadoGoogle.apiKey
        ? {
            apiKey: m.autocompletadoGoogle.apiKey,
            paises: m.autocompletadoGoogle.paises,
          }
        : null,
  };

  return Response.json(
    {
      ok: true,
      integraciones,
      formulario: tienda.formularioConfig,
      // Solo lo que el navegador necesita para dibujar; la lista de productos no se expone.
      oferta: oferta && {
        niveles: oferta.niveles,
        diseno: oferta.diseno,
        ubicacion: oferta.ubicacion,
        opciones: oferta.opciones,
      },
      paquete,
      extras,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
};
