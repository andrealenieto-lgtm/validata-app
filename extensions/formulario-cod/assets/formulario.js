/* Validata: formulario contraentrega con validación del historial por teléfono.
 * Todo el texto que viene de la configuración o del servidor se inserta con textContent. */
(() => {
  if (window.__validata) return;
  window.__validata = true;

  const PROXY = "/apps/validata";
  const ICONOS = {
    persona:
      '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    telefono:
      '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" fill="currentColor"/></svg>',
    ubicacion:
      '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>',
  };

  let config;
  let ciudades;
  const cargarConfig = (productoId, varianteId) =>
    (config ??= fetch(
      `${PROXY}/config?producto=${encodeURIComponent(productoId || "")}&variante=${encodeURIComponent(varianteId || "")}`,
    )
      .then((r) => r.json())
      .catch(() => ({ ok: false })));
  const cargarCiudades = (url) => (ciudades ??= fetch(url).then((r) => r.json()).catch(() => ({})));

  function el(tag, props = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const h of hijos.flat()) if (h != null && h !== false) n.append(h);
    return n;
  }

  // ─── Autocompletado de direcciones (Google Places, API nueva) ───
  let mapas;
  function cargarMapas(apiKey) {
    return (mapas ??= new Promise((listo, falla) => {
      if (window.google?.maps?.importLibrary) return listo();
      window.__vdMapas = () => listo();
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly&callback=__vdMapas`;
      s.async = true;
      s.onerror = falla;
      document.head.append(s);
    }).then(() => window.google.maps.importLibrary("places")));
  }
  const normal = (t) =>
    String(t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\bD\.?\s?C\.?$/, "")
      .replace(/[^A-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  /** Opción de la lista que corresponde al nombre de Google ("Valle del Cauca" → "VALLE"). */
  function opcionParecida(opciones, nombre) {
    const n = normal(nombre);
    if (!n) return null;
    const exacta = opciones.find((o) => normal(o) === n);
    if (exacta) return exacta;
    const parecidas = opciones.filter((o) => {
      const x = normal(o);
      return x && (n.startsWith(`${x} `) || x.startsWith(`${n} `) || n.endsWith(` ${x}`));
    });
    return parecidas.sort((a, b) => normal(b).length - normal(a).length)[0] || null;
  }
  function autocompletar(input, conf, alElegir) {
    const lista = el("ul", { class: "vd-sugerencias", role: "listbox", hidden: true });
    let token = null;
    let espera;
    let consulta = 0;
    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", () => {
      clearTimeout(espera);
      const q = input.value.trim();
      if (q.length < 4) {
        lista.hidden = true;
        return;
      }
      espera = setTimeout(async () => {
        const n = ++consulta;
        try {
          const places = await cargarMapas(conf.apiKey);
          token ??= new places.AutocompleteSessionToken();
          const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: q,
            sessionToken: token,
            includedRegionCodes: (conf.paises || []).map((p) => p.toLowerCase()),
          });
          if (n !== consulta) return;
          const predicciones = suggestions.map((x) => x.placePrediction).filter(Boolean).slice(0, 5);
          lista.replaceChildren(
            ...predicciones.map((p) =>
              el("li", {
                role: "option",
                text: p.text.toString(),
                onmousedown: async (e) => {
                  e.preventDefault(); // que el campo no pierda el foco antes de elegir
                  lista.hidden = true;
                  input.value = p.mainText?.toString() || p.text.toString();
                  try {
                    const lugar = p.toPlace();
                    await lugar.fetchFields({ fields: ["addressComponents"] });
                    alElegir(lugar.addressComponents || []);
                  } catch {
                    /* sin detalles: queda la dirección escrita */
                  }
                  token = null; // la sesión de Google termina al elegir
                },
              }),
            ),
          );
          lista.hidden = !predicciones.length;
        } catch {
          lista.hidden = true; // clave inválida o Google caído: el campo sigue funcionando normal
        }
      }, 300);
    });
    input.addEventListener("blur", () => setTimeout(() => (lista.hidden = true), 150));
    return lista;
  }

  const bonito = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

  function utm() {
    const p = new URLSearchParams(location.search);
    const actual = { campana: p.get("utm_campaign"), fuente: p.get("utm_source"), medio: p.get("utm_medium") };
    try {
      if (actual.campana || actual.fuente) sessionStorage.setItem("vd_utm", JSON.stringify(actual));
      return JSON.parse(sessionStorage.getItem("vd_utm") || "null") || actual;
    } catch {
      return actual;
    }
  }

  function pixel(evento, datos) {
    try {
      window.fbq?.("track", evento, datos);
      if (evento === "Purchase") window.ttq?.track?.("CompletePayment", datos);
      if (evento === "InitiateCheckout") window.ttq?.track?.("InitiateCheckout", datos);
    } catch {
      /* un píxel roto no debe romper el formulario */
    }
  }

  async function post(ruta, datos) {
    const r = await fetch(`${PROXY}/${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    return r.json().catch(() => ({ ok: false, error: "respuesta_invalida" }));
  }

  function varianteActual(raiz, producto) {
    const scope = raiz.closest(".shopify-section") || document;
    const input =
      scope.querySelector('form[action*="/cart/add"] [name="id"]') ||
      document.querySelector('form[action*="/cart/add"] [name="id"]');
    const id = Number(input?.value);
    return (
      producto.variantes.find((v) => v.id === id) ||
      producto.variantes.find((v) => v.disponible) ||
      producto.variantes[0]
    );
  }

  /** Colores y medidas del constructor como variables CSS (formulario.css las usa). */
  function aplicarEstilos(nodo, f) {
    const v = {
      "--vd-f-fondo": f.formulario?.fondo,
      "--vd-f-texto": f.formulario?.colorTexto,
      "--vd-f-borde": f.formulario?.colorBorde,
      "--vd-f-ancho-borde": `${f.formulario?.anchoBorde ?? 0}px`,
      "--vd-f-radio": `${f.formulario?.radio ?? 16}px`,
      "--vd-f-sombra": `0 ${(f.formulario?.sombra ?? 3) * 3}px ${(f.formulario?.sombra ?? 3) * 10}px rgb(0 0 0 / 0.25)`,
      "--vd-f-tamano": `${f.formulario?.tamanoTexto ?? 16}px`,
      "--vd-c-texto": f.campos?.colorTexto,
      "--vd-c-fondo": f.campos?.fondo,
      "--vd-c-icono": f.campos?.colorIcono,
      "--vd-c-fondo-icono": f.campos?.fondoIcono,
      "--vd-c-borde": f.campos?.colorBorde,
      "--vd-c-radio": `${f.campos?.radio ?? 0}px`,
      "--vd-e-fondo": f.botonEnviar?.fondo,
      "--vd-e-texto": f.botonEnviar?.colorTexto,
      "--vd-e-radio": `${f.botonEnviar?.radio ?? 999}px`,
    };
    // setProperty solo acepta el valor de la propiedad: un color no puede inyectar otras reglas.
    for (const [k, val] of Object.entries(v)) if (val) nodo.style.setProperty(k, val);
    nodo.classList.toggle("vd-negrita", !!f.formulario?.negrita);
    nodo.classList.toggle("vd-cursiva", !!f.formulario?.cursiva);
    nodo.classList.toggle("vd-etiquetas-izquierda", f.formulario?.alineacionEtiquetas === "izquierda");
  }

  function estiloBoton(boton, b) {
    if (!b) return;
    boton.querySelector(".vd-boton-texto").textContent = b.texto;
    const sub = boton.querySelector(".vd-boton-sub");
    if (sub) sub.textContent = b.subtitulo;
    else if (b.subtitulo) boton.append(el("span", { class: "vd-boton-sub", text: b.subtitulo }));
    const st = boton.style;
    st.setProperty("--vd-fondo", b.fondo);
    st.setProperty("--vd-texto", b.colorTexto);
    st.fontSize = `${b.tamanoTexto}px`;
    st.fontWeight = b.negrita ? "700" : "400";
    st.fontStyle = b.cursiva ? "italic" : "normal";
    st.border = b.anchoBorde ? `${b.anchoBorde}px solid` : "0";
    st.borderColor = b.colorBorde;
    st.borderRadius = `${b.radio}px`;
    st.boxShadow = b.sombra ? `0 ${b.sombra * 2}px ${b.sombra * 6}px rgb(0 0 0 / 0.2)` : "none";
    boton.classList.remove("vd-animar", "vd-anim-sacudir", "vd-anim-pulso", "vd-anim-rebote");
    if (b.animacion && b.animacion !== "ninguna") boton.classList.add(`vd-anim-${b.animacion}`);
  }

  // ─── Ofertas por cantidad (estilo Kaching) ───
  // El cálculo es el mismo que hace el servidor (app/lib/ofertas.ts); el servidor lo repite
  // al crear el pedido, así que esto solo sirve para mostrar los montos.
  function aplicarDescuento(monto, d) {
    let r = monto;
    if (d.tipo === "porcentaje") r = monto * (1 - Math.min(100, Math.max(0, d.valor)) / 100);
    else if (d.tipo === "monto") r = monto - d.valor;
    else if (d.tipo === "precioFijo") r = d.valor;
    return Math.round(Math.min(monto, Math.max(0, r)) * 100) / 100;
  }

  function precioDeNivel(oferta, nivel, precio, comparacion) {
    const base = Math.round(precio * nivel.cantidad * 100) / 100;
    // Igual que el servidor: precio unitario redondeado × cantidad.
    const unitario = Math.round((aplicarDescuento(base, nivel.descuento) / nivel.cantidad) * 100) / 100;
    const total = Math.round(unitario * nivel.cantidad * 100) / 100;
    const antes = oferta.opciones?.usarPrecioComparacion && comparacion > precio ? comparacion * nivel.cantidad : base;
    return { total, antes, pct: antes > 0 ? Math.round(((antes - total) / antes) * 100) : 0 };
  }

  let idOferta = 0;
  function widgetOferta({ oferta, precio, comparacion, fmt, nivelId, alElegir }) {
    const d = oferta.diseno;
    const nombre = `vd-nivel-${++idOferta}`;
    const caja = el("div", { class: `vd-oferta vd-oferta-${d.plantilla === "tarjetas" ? "tarjetas" : "barras"}` });
    const vars = {
      "--vd-o-principal": d.colorPrincipal,
      "--vd-o-fondo": d.colorFondo,
      "--vd-o-fondo-sel": d.colorFondoSeleccionado,
      "--vd-o-texto": d.colorTexto,
      "--vd-o-etiqueta": d.colorEtiqueta,
      "--vd-o-texto-etiqueta": d.colorTextoEtiqueta,
      "--vd-o-radio": `${d.radio}px`,
    };
    for (const [k, v] of Object.entries(vars)) if (v) caja.style.setProperty(k, v);
    if (d.encabezado) caja.append(el("p", { class: "vd-oferta-titulo", text: d.encabezado }));
    const lista = el("div", { class: "vd-niveles" });
    const pintar = (activo) => {
      lista.replaceChildren(
        ...oferta.niveles.map((n) => {
          const p = precioDeNivel(oferta, n, precio, comparacion);
          const sub = (n.subtitulo || "").replace(/\{(descuento|discount)\}/g, `${p.pct}%`);
          return el(
            "label",
            { class: `vd-nivel${n.id === activo ? " vd-nivel-activo" : ""}` },
            n.etiqueta ? el("span", { class: "vd-nivel-etiqueta", text: n.etiqueta }) : null,
            el("input", {
              type: "radio",
              name: nombre,
              value: n.id,
              checked: n.id === activo,
              onchange: () => {
                pintar(n.id);
                alElegir(n.id);
              },
            }),
            el("span", { class: "vd-nivel-info" }, el("strong", { text: n.titulo }), sub ? el("small", { text: sub }) : null),
            el(
              "span",
              { class: "vd-nivel-precio" },
              el("strong", { text: fmt.format(p.total) }),
              p.antes > p.total ? el("s", { text: fmt.format(p.antes) }) : null,
              oferta.opciones?.mostrarPrecioUnitario && n.cantidad > 1
                ? el("small", { text: `${fmt.format(p.total / n.cantidad)} c/u` })
                : null,
            ),
          );
        }),
      );
    };
    pintar(nivelId);
    caja.append(lista);
    return caja;
  }

  /**
   * Opciones "Precio estándar" / "Paquete completo" (combo). El paquete llega ya calculado por el
   * servidor con los precios reales; el servidor lo vuelve a calcular al cobrar.
   */
  function widgetPaquete({ paquete, producto, precio, comparacion, fmt, elegido, alElegir }) {
    const d = paquete.diseno || {};
    const caja = el("div", { class: "vd-oferta vd-paquete" });
    const vars = {
      "--vd-o-principal": d.colorPrincipal,
      "--vd-o-fondo": d.colorFondo,
      "--vd-o-fondo-sel": d.colorFondoSeleccionado,
      "--vd-o-texto": d.colorTexto,
      "--vd-o-etiqueta": d.colorEtiqueta,
      "--vd-o-texto-etiqueta": d.colorTextoEtiqueta,
      "--vd-o-radio": `${d.radio ?? 12}px`,
    };
    for (const [k, v] of Object.entries(vars)) if (v) caja.style.setProperty(k, v);
    const nombre = `vd-paquete-${++idOferta}`;
    const pct = paquete.antes > 0 ? Math.round(((paquete.antes - paquete.total) / paquete.antes) * 100) : 0;

    const opcion = (valor, activo, ...contenido) =>
      el(
        "label",
        { class: `vd-nivel vd-paquete-opcion${activo ? " vd-nivel-activo" : ""}` },
        el("input", {
          type: "radio",
          name: nombre,
          value: valor,
          checked: activo,
          onchange: () => {
            pintar(valor === "paquete");
            alElegir(valor === "paquete");
          },
        }),
        ...contenido,
      );

    const pintar = (esPaquete) => {
      const estandar = opcion(
        "estandar",
        !esPaquete,
        el("span", { class: "vd-nivel-info" }, el("strong", { text: producto.titulo }), el("small", { text: paquete.textoPrecioEstandar })),
        el(
          "span",
          { class: "vd-nivel-precio" },
          el("strong", { text: fmt.format(precio) }),
          comparacion > precio ? el("s", { text: fmt.format(comparacion) }) : null,
        ),
      );
      const productos = el(
        "div",
        { class: `vd-paquete-productos vd-paquete-${paquete.plantilla === "vertical" ? "vertical" : "horizontal"}` },
        ...paquete.productos.flatMap((p, i) => [
          i > 0 ? el("span", { class: "vd-paquete-mas", text: "+" }) : null,
          el(
            "div",
            { class: "vd-paquete-producto" },
            p.imagen ? el("img", { src: p.imagen, alt: "", width: "56", height: "56", loading: "lazy" }) : null,
            el("span", { class: "vd-paquete-nombre", text: p.cantidad > 1 ? `${p.titulo} x${p.cantidad}` : p.titulo }),
            el("strong", { text: fmt.format(p.total) }),
            p.antes > p.total ? el("s", { text: fmt.format(p.antes) }) : null,
          ),
        ]).filter(Boolean),
      );
      const combo = opcion(
        "paquete",
        esPaquete,
        paquete.etiqueta ? el("span", { class: "vd-nivel-etiqueta", text: paquete.etiqueta }) : null,
        el(
          "span",
          { class: "vd-paquete-cuerpo" },
          el(
            "span",
            { class: "vd-paquete-cabecera" },
            el(
              "span",
              { class: "vd-nivel-info" },
              el("strong", { text: paquete.titulo }),
              paquete.subtitulo ? el("small", { text: paquete.subtitulo.replace(/\{(descuento|discount)\}/g, `${pct}%`) }) : null,
            ),
            el(
              "span",
              { class: "vd-nivel-precio" },
              el("strong", { text: fmt.format(paquete.total) }),
              paquete.antes > paquete.total ? el("s", { text: fmt.format(paquete.antes) }) : null,
            ),
          ),
          productos,
        ),
      );
      caja.replaceChildren(
        ...[d.encabezado ? el("p", { class: "vd-oferta-titulo", text: d.encabezado }) : null, el("div", { class: "vd-niveles" }, estandar, combo)].filter(Boolean),
      );
    };
    pintar(elegido);
    return caja;
  }

  const nivelPorDefecto = (oferta) => (oferta?.niveles.find((n) => n.porDefecto) || oferta?.niveles[0])?.id;

  /**
   * Dibuja el formulario. Lo usan la tienda (ventana emergente o incrustado) y la vista previa
   * del constructor, que pasa un `api` simulado: así el panel muestra exactamente lo que ve el cliente.
   */
  function construir({ f, deptos, producto, variante, moneda, modo, api, alCerrar, oferta, nivelInicial, paquete, extras, integ }) {
    const fmt = new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: moneda,
      maximumFractionDigits: moneda === "COP" ? 0 : 2,
    });
    const precio = variante.precio / 100;
    const reportar = modo === "preview" ? () => {} : pixel;

    const comparacion = (variante.comparacion || 0) / 100;
    const estado = { cantidad: 1, decision: null, forma: "contraentrega", consulta: 0, nivel: null, paquete: !!paquete?.porDefecto };
    const nivelActual = () => oferta?.niveles.find((n) => n.id === estado.nivel);
    if (oferta) {
      estado.nivel = oferta.niveles.some((n) => n.id === nivelInicial) ? nivelInicial : nivelPorDefecto(oferta);
      estado.cantidad = nivelActual().cantidad;
    }
    const campos = {};
    const totalProductos = () =>
      estado.paquete ? paquete.total : nivelActual() ? precioDeNivel(oferta, nivelActual(), precio, comparacion).total : precio * estado.cantidad;
    const antesProductos = () =>
      estado.paquete ? paquete.antes : nivelActual() ? precioDeNivel(oferta, nivelActual(), precio, comparacion).antes : precio * estado.cantidad;

    // Extras: casillas (1-Tick), upsell aceptado y downsell. El servidor los vuelve a validar.
    estado.ticks = new Set();
    estado.upsell = null; // { upsellId, ofertaId, total, antes, titulo }
    estado.upsellMostrado = false;
    estado.downsell = null; // id
    const ticksDisponibles = extras?.ticks || [];
    const sumaTicks = () => ticksDisponibles.filter((t) => estado.ticks.has(t.id)).reduce((s, t) => s + t.precio, 0);
    const pctDownsell = (bruto) => {
      const d = estado.downsell && extras?.downsell;
      if (!d || bruto <= 0) return 0;
      return Math.min(90, d.descuento.tipo === "porcentaje" ? d.descuento.valor : (d.descuento.valor / bruto) * 100);
    };
    const bruto = () => totalProductos() + sumaTicks() + (estado.upsell?.total || 0);
    const total = () => Math.round(bruto() * (1 - pctDownsell(bruto()) / 100) * 100) / 100;
    const antes = () => antesProductos() + sumaTicks() + (estado.upsell?.antes || 0);

    // ─── Recuadro de validación ───
    const cajaValidacion = el("div", { class: "vd-validacion", "aria-live": "polite" });
    const botonEnviar = el("button", { type: "submit", class: "vd-enviar" });

    function textoEnviar() {
      const d = estado.decision;
      if (d?.accion === "pago_previo" && d.pagos) {
        if (estado.forma === "abono" && d.pagos.abono) return "Continuar por WhatsApp";
        return `Pagar ${fmt.format(d.pagos.anticipado)} ahora`;
      }
      return (f.bloques.find((b) => b.tipo === "enviar") || {}).texto || "Finalizar pedido";
    }

    function pintarValidacion(inicial) {
      cajaValidacion.replaceChildren();
      cajaValidacion.className = "vd-validacion";
      const d = estado.decision;
      botonEnviar.hidden = false;
      botonEnviar.textContent = textoEnviar();

      if (!d) {
        cajaValidacion.append(el("p", { text: inicial }));
        return;
      }
      if (d.cargando) {
        cajaValidacion.classList.add("vd-cargando");
        cajaValidacion.append(el("p", { text: "Verificando tu historial de entregas…" }));
        return;
      }
      if (!d.ok) {
        cajaValidacion.classList.add("vd-error");
        cajaValidacion.append(el("p", { text: "Revisa tu número de celular." }));
        return;
      }

      cajaValidacion.classList.add(`vd-${d.accion}`);
      cajaValidacion.append(el("p", { class: "vd-mensaje", text: d.mensaje }));
      if (d.huella) {
        cajaValidacion.append(el("p", { class: "vd-huella", text: d.huella.texto }));
        if (d.huella.detalle) {
          const h = d.huella.detalle;
          cajaValidacion.append(
            el("p", {
              class: "vd-huella-detalle",
              text: `${h.pedidos} pedidos · ${h.entregas} entregas · ${h.devoluciones} devoluciones · ${h.efectividad}% efectividad`,
            }),
          );
        }
      }

      if (d.accion === "pago_previo" && d.pagos) {
        if (estado.forma === "contraentrega") estado.forma = "anticipado";
        const opcion = (valor, titulo, detalle) =>
          el(
            "label",
            { class: "vd-opcion" },
            el("input", {
              type: "radio",
              name: "vd-pago",
              value: valor,
              checked: estado.forma === valor,
              onchange: () => {
                estado.forma = valor;
                botonEnviar.textContent = textoEnviar();
              },
            }),
            el("span", {}, el("strong", { text: titulo }), el("small", { text: detalle })),
          );
        const ahorro = total() - d.pagos.anticipado;
        cajaValidacion.append(
          opcion(
            "anticipado",
            `Pagar todo ahora: ${fmt.format(d.pagos.anticipado)}`,
            ahorro > 0 ? `Ahorras ${fmt.format(ahorro)}` : "Pago seguro en línea",
          ),
        );
        if (d.pagos.abono) {
          cajaValidacion.append(
            opcion(
              "abono",
              `Abonar ${fmt.format(d.pagos.abono.monto)} por WhatsApp`,
              `Un asesor confirma tu pedido y pagas ${fmt.format(d.pagos.abono.saldoContraentrega)} al recibir`,
            ),
          );
        }
        botonEnviar.textContent = textoEnviar();
      } else {
        estado.forma = "contraentrega";
      }

      if (d.accion === "whatsapp") {
        botonEnviar.hidden = true;
        if (d.whatsapp) {
          cajaValidacion.append(
            el("a", { class: "vd-whatsapp", href: d.whatsapp, target: "_blank", rel: "noopener", text: "Confirmar por WhatsApp" }),
          );
        }
      }
    }

    let temporizador;
    function validar(inmediato) {
      clearTimeout(temporizador);
      const tel = campos.telefono?.value.replace(/\D/g, "") || "";
      if (tel.length < 10) {
        estado.decision = null;
        pintarValidacion(bloqueValidacion?.textoInicial || "");
        return Promise.resolve();
      }
      return new Promise((resolver) => {
        temporizador = setTimeout(
          async () => {
            const n = ++estado.consulta;
            estado.decision = { cargando: true };
            pintarValidacion();
            const r = await api.validar({
              telefono: campos.telefono.value,
              total: total(),
              nombre: campos.nombre?.value,
              producto: producto.titulo,
              totalTexto: fmt.format(total()),
            }).catch(() => null);
            if (n !== estado.consulta) return resolver(); // llegó una consulta más nueva
            // Si la validación falla por red, se deja seguir: el servidor valida de nuevo al crear el pedido.
            estado.decision = r && (r.ok || r.error === "telefono_invalido") ? r : null;
            pintarValidacion(bloqueValidacion?.textoInicial || "");
            // Carrito abandonado: solo si puede comprar (a quien va a WhatsApp no se le recuerda).
            if (integ?.carrito && r?.ok && r.accion !== "whatsapp" && estado.borrador !== tel) {
              estado.borrador = tel;
              api.borrador?.({
                telefono: campos.telefono.value,
                nombre: campos.nombre?.value || "",
                producto: producto.titulo,
                ruta: location.pathname,
              }).catch(() => {});
            }
            resolver();
          },
          inmediato ? 0 : 450,
        );
      });
    }

    // ─── Resumen ───
    const filasResumen = el("div", { class: "vd-resumen" });
    function pintarResumen() {
      const ahorro = antes() - total();
      filasResumen.replaceChildren(
        ...[
          el("div", {}, el("span", { text: "Subtotal" }), el("span", { text: fmt.format(antes() - sumaTicks()) })),
          sumaTicks() > 0 ? el("div", {}, el("span", { text: "Adicionales" }), el("span", { text: fmt.format(sumaTicks()) })) : null,
          ahorro > 0 ? el("div", { class: "vd-descuento" }, el("span", { text: "Descuento" }), el("span", { text: `-${fmt.format(ahorro)}` })) : null,
        el("div", {}, el("span", { text: "Envío" }), el("span", { text: "Gratis" })),
          el("div", { class: "vd-total" }, el("span", { text: "Total" }), el("span", { text: fmt.format(total()) })),
        ].filter(Boolean),
      );
    }

    // ─── Bloques del formulario ───
    const bloqueValidacion = f.bloques.find((b) => b.tipo === "validacion" && !b.oculto);
    const form = el("form", { class: "vd-form", novalidate: true });
    const cantidadTexto = el("span", { text: "1" });

    function campoDe(b) {
      const req = b.requerido ? el("span", { class: "vd-req", text: " *" }) : null;
      const etiqueta = f.preferencias?.ocultarEtiquetas ? null : el("label", { class: "vd-label", text: b.etiqueta }, req);
      let control;
      if (b.tipoCampo === "departamento" || b.tipoCampo === "ciudad") {
        control = el("select", { name: b.nombre, required: b.requerido });
        control.append(el("option", { value: "", text: b.etiqueta }));
        if (b.tipoCampo === "departamento") {
          for (const d of Object.keys(deptos)) control.append(el("option", { value: d, text: bonito(d) }));
          control.addEventListener("change", () => {
            const c = campos.ciudad;
            if (!c) return;
            c.replaceChildren(el("option", { value: "", text: "Ciudad" }));
            for (const ciudad of deptos[control.value] || []) c.append(el("option", { value: ciudad, text: bonito(ciudad) }));
          });
        }
      } else if (b.tipoCampo === "opciones") {
        control = el(
          "div",
          { class: "vd-radios" },
          (b.opciones || []).map((o) =>
            el("label", {}, el("input", { type: "radio", name: b.nombre, value: o, required: b.requerido }), el("span", { text: o })),
          ),
        );
        campos[b.nombre] = {
          get value() {
            return control.querySelector("input:checked")?.value || "";
          },
          focus: () => control.querySelector("input")?.focus(),
          el: control,
        };
        return el("div", { class: "vd-campo" }, etiqueta, control);
      } else {
        const tel = b.tipoCampo === "telefono";
        control = el("input", {
          name: b.nombre,
          type: tel ? "tel" : "text",
          inputmode: tel ? "numeric" : null,
          placeholder: b.placeholder || "",
          required: b.requerido,
          autocomplete: f.preferencias?.desactivarAutocompletar
            ? "off"
            : { nombre: "given-name", apellido: "family-name", telefono: "tel-national", direccion: "address-line1", direccion2: "address-line2" }[b.nombre] || "on",
          maxlength: tel ? "20" : "200",
        });
        if (tel) control.addEventListener("input", () => validar(false));
      }
      campos[b.nombre] = control;
      const sugerencias =
        b.nombre === "direccion" && integ?.autocompletado && modo !== "preview"
          ? autocompletar(control, integ.autocompletado, (partes) => {
              const de = (tipo) => partes.find((x) => x.types?.includes(tipo))?.longText || "";
              const ciudad = de("locality") || de("administrative_area_level_2");
              // Bogotá es su propio "departamento" en Google; en Dropi está en Cundinamarca.
              const depto = normal(ciudad) === "BOGOTA" ? "CUNDINAMARCA" : de("administrative_area_level_1");
              const d = campos.departamento && opcionParecida(Object.keys(deptos), depto);
              if (d) {
                campos.departamento.value = d;
                campos.departamento.dispatchEvent(new Event("change"));
                const c = campos.ciudad && opcionParecida(deptos[d] || [], ciudad);
                if (c) campos.ciudad.value = c;
              }
              const barrio = de("neighborhood") || de("sublocality_level_1") || de("sublocality");
              if (campos.barrio && barrio && !campos.barrio.value) campos.barrio.value = barrio;
            })
          : null;
      const icono =
        f.preferencias?.mostrarIconos && b.icono && ICONOS[b.icono]
          ? (() => {
              const s = el("span", { class: "vd-icono" });
              s.innerHTML = ICONOS[b.icono]; // SVG fijo de este archivo, no viene de la configuración
              return s;
            })()
          : null;
      return el("div", { class: "vd-campo" }, etiqueta, el("div", { class: "vd-control" }, icono, control), sugerencias);
    }

    // Casillas 1-Tick ("Añade envío prioritario por $5.000").
    const zonaTicks = el(
      "div",
      { class: "vd-ticks" },
      ticksDisponibles.map((t) => {
        const caja = el(
          "label",
          { class: "vd-tick" },
          el("input", {
            type: "checkbox",
            onchange: (e) => {
              if (e.target.checked) estado.ticks.add(t.id);
              else estado.ticks.delete(t.id);
              caja.classList.toggle("vd-tick-activo", e.target.checked);
              pintarResumen();
              if (estado.decision && !estado.decision.cargando) validar(true);
            },
          }),
          el("span", {
            text: (t.texto || "").replace(/\{\{\s*title\s*\}\}/g, t.titulo).replace(/\{\{\s*price\s*\}\}/g, fmt.format(t.precio)),
          }),
        );
        const c = t.colores || {};
        if (c.marca) caja.style.setProperty("--vd-t-marca", c.marca);
        if (c.fondo) caja.style.setProperty("--vd-t-fondo", c.fondo);
        if (c.borde) caja.style.setProperty("--vd-t-borde", c.borde);
        if (c.estiloBorde) caja.style.setProperty("--vd-t-estilo", c.estiloBorde);
        return caja;
      }),
    );

    for (const b of f.bloques) {
      if (b.tipo === "upsell") {
        if (!b.oculto) form.append(zonaTicks);
        continue;
      }
      if (b.oculto) continue;
      if (b.tipo === "carrito" && paquete) {
        // Paquete (y, si se elige el precio estándar, las barras de la oferta por cantidad).
        const zonaOferta = el("div");
        const pintarZonaOferta = () =>
          zonaOferta.replaceChildren(
            ...(!estado.paquete && oferta && oferta.ubicacion?.formulario
              ? [widgetOferta({ oferta, precio, comparacion, fmt, nivelId: estado.nivel, alElegir: elegirNivel })]
              : []),
          );
        form.append(
          widgetPaquete({
            paquete,
            producto,
            precio,
            comparacion,
            fmt,
            elegido: estado.paquete,
            alElegir: (esPaquete) => {
              estado.paquete = esPaquete;
              pintarZonaOferta();
              pintarResumen();
              if (estado.decision && !estado.decision.cargando) validar(true);
            },
          }),
          zonaOferta,
        );
        pintarZonaOferta();
      } else if (b.tipo === "carrito" && oferta && oferta.ubicacion?.formulario) {
        form.append(
          el(
            "div",
            { class: "vd-producto" },
            producto.imagen ? el("img", { src: producto.imagen, alt: "", width: "64", height: "64" }) : null,
            el(
              "div",
              { class: "vd-producto-info" },
              el("strong", { text: producto.titulo }),
              variante.titulo !== "Default Title" ? el("small", { text: variante.titulo }) : null,
            ),
          ),
          widgetOferta({ oferta, precio, comparacion, fmt, nivelId: estado.nivel, alElegir: elegirNivel }),
        );
      } else if (b.tipo === "carrito") {
        form.append(
          el(
            "div",
            { class: "vd-producto" },
            producto.imagen ? el("img", { src: producto.imagen, alt: "", width: "64", height: "64" }) : null,
            el(
              "div",
              { class: "vd-producto-info" },
              el("strong", { text: producto.titulo }),
              variante.titulo !== "Default Title" ? el("small", { text: variante.titulo }) : null,
              el("span", { class: "vd-precio", text: fmt.format(precio) }),
            ),
            el(
              "div",
              { class: "vd-cantidad" },
              el("button", { type: "button", "aria-label": "Menos", text: "−", onclick: () => cambiarCantidad(-1) }),
              cantidadTexto,
              el("button", { type: "button", "aria-label": "Más", text: "+", onclick: () => cambiarCantidad(1) }),
            ),
          ),
        );
      } else if (b.tipo === "resumen") {
        form.append(filasResumen);
      } else if (b.tipo === "texto") {
        form.append(el("p", { class: "vd-texto", text: b.texto }));
      } else if (b.tipo === "imagen" && /^https:\/\//.test(b.url || "")) {
        form.append(el("img", { class: "vd-imagen", src: b.url, alt: b.alt || "" }));
      } else if (b.tipo === "campo") {
        form.append(campoDe(b));
      } else if (b.tipo === "validacion") {
        form.append(cajaValidacion);
      } else if (b.tipo === "enviar") {
        if (!form.contains(zonaTicks)) form.append(zonaTicks);
        form.append(botonEnviar);
      }
    }
    if (!form.contains(zonaTicks)) form.append(zonaTicks);
    if (!form.contains(botonEnviar)) form.append(botonEnviar);
    const aviso = el("p", { class: "vd-aviso", role: "alert" });
    form.append(aviso);

    function elegirNivel(id) {
      estado.nivel = id;
      estado.cantidad = nivelActual().cantidad;
      pintarResumen();
      if (estado.decision && !estado.decision.cargando) validar(true); // los montos de pago previo cambian
    }

    function cambiarCantidad(delta) {
      estado.cantidad = Math.min(10, Math.max(1, estado.cantidad + delta));
      cantidadTexto.textContent = String(estado.cantidad);
      pintarResumen();
      if (estado.decision && !estado.decision.cargando) validar(true); // los montos de pago previo cambian
    }

    // ─── Envío ───
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      aviso.textContent = "";
      let primero = null;
      for (const b of f.bloques) {
        if (b.tipo !== "campo" || !b.requerido || b.oculto) continue;
        const c = campos[b.nombre];
        const vacio = !String(c?.value || "").trim();
        (c?.el || c)?.classList?.toggle("vd-invalido", vacio);
        if (vacio && !primero) primero = c;
      }
      if (primero) {
        aviso.textContent = f.mensajes?.requerido || "Completa los campos obligatorios.";
        primero.focus?.();
        return;
      }
      if (!estado.decision || estado.decision.cargando) await validar(true);
      if (estado.decision && !estado.decision.ok) return;
      if (estado.decision?.accion === "whatsapp") return;

      // Upsell de 1 clic: se ofrece una vez, antes de crear el pedido.
      if (extras?.upsell && !estado.upsellMostrado) {
        estado.upsellMostrado = true;
        await mostrarUpsell();
        pintarResumen();
      }

      // Verificación del número por código (contraentrega). El servidor lo exige igual.
      if (integ?.verificacion && estado.forma === "contraentrega" && estado.decision?.accion === "contraentrega" && estado.codigo == null) {
        const codigo = await pedirCodigo();
        if (codigo == null) return; // cerró la ventana
        estado.codigo = codigo;
      }

      botonEnviar.disabled = true;
      botonEnviar.textContent = "Procesando…";
      const datos = {
        variante: variante.id,
        cantidad: estado.cantidad,
        nivel: estado.paquete ? null : estado.nivel,
        paquete: estado.paquete ? paquete.id : null,
        pago: estado.forma,
        utm: utm(),
        extras: {
          ticks: [...estado.ticks],
          upsell: estado.upsell ? { upsellId: estado.upsell.upsellId, ofertaId: estado.upsell.ofertaId } : null,
          downsell: estado.downsell,
        },
      };
      for (const [k, c] of Object.entries(campos)) datos[k] = c.value;
      if (estado.codigo != null) datos.codigo = estado.codigo;
      const r = await api.pedido(datos).catch(() => ({ ok: false, error: "red" }));
      botonEnviar.disabled = false;

      if (r.ok && r.tipo === "pedido") {
        reportar("Purchase", { value: r.total, currency: moneda, content_ids: [String(variante.id)], content_type: "product" });
        panel.replaceChildren(
          cerrar || "",
          el(
            "div",
            { class: "vd-gracias" },
            el("h2", { text: `¡Gracias, ${campos.nombre?.value || ""}!` }),
            el("p", { text: `Tu pedido ${r.pedido} fue recibido.` }),
            el("p", { text: `Pagas ${fmt.format(r.total)} cuando lo recibas.` }),
          ),
        );
        return;
      }
      if (r.ok && r.tipo === "whatsapp") {
        // Abono: la venta la cierra un asesor por WhatsApp con el pedido ya escrito.
        location.href = r.url;
        return;
      }
      if (r.ok && r.tipo === "pago") {
        // La compra se reporta al píxel cuando el cliente paga en el checkout de Shopify.
        location.href = r.url;
        return;
      }
      if (r.error === "pago_previo" || r.error === "whatsapp") {
        await validar(true);
        return;
      }
      botonEnviar.textContent = textoEnviar();
      if (String(r.error || "").startsWith("codigo_")) estado.codigo = null; // se vuelve a pedir
      aviso.textContent =
        {
          codigo_invalido: "El código no es correcto. Da clic en finalizar para intentarlo de nuevo.",
          codigo_vencido: "El código venció. Da clic en finalizar para recibir uno nuevo.",
          codigo_bloqueado: "Demasiados intentos. Espera unos minutos y pide un código nuevo.",
          codigo_requerido: "Da clic en finalizar para recibir tu código de verificación.",
          faltan_campos: f.mensajes?.requerido || "Completa los campos obligatorios.",
          agotado: f.mensajes?.agotado || "Producto agotado.",
          limite_pedidos: "Ya recibimos tus pedidos de hoy. Si necesitas otro, escríbenos.",
          demasiados_pedidos: "Espera unos minutos antes de intentar de nuevo.",
        }[r.error] || "No pudimos crear tu pedido. Intenta de nuevo.";
    });

    // ─── Código de verificación ───
    /** Envía el código y lo pide. Devuelve el código, "" si no hace falta, o null si cerró. */
    async function pedirCodigo() {
      const envio = await api.codigo({ telefono: campos.telefono.value }).catch(() => null);
      if (envio?.ok && !envio.requerido) return ""; // no se pudo enviar: el servidor lo deja pasar
      if (!envio?.ok && envio?.error !== "espera") return ""; // error de red: que decida el servidor
      return new Promise((terminar) => {
        const capa = el("div", { class: "vd-capa vd-codigo" });
        const entrada = el("input", {
          type: "text",
          inputmode: "numeric",
          autocomplete: "one-time-code",
          maxlength: "6",
          placeholder: "••••••",
          "aria-label": "Código de verificación",
        });
        const error = el("p", { class: "vd-codigo-error", "aria-live": "polite" });
        const reenviar = el("button", { type: "button", class: "vd-codigo-reenviar", disabled: true, text: "Reenviar código" });
        let quedan = 60;
        const reloj = setInterval(() => {
          quedan--;
          reenviar.textContent = quedan > 0 ? `Reenviar código (${quedan}s)` : "Reenviar código";
          if (quedan <= 0) {
            reenviar.disabled = false;
            clearInterval(reloj);
          }
        }, 1000);
        const fin = (valor) => {
          clearInterval(reloj);
          capa.remove();
          terminar(valor);
        };
        reenviar.addEventListener("click", async () => {
          reenviar.disabled = true;
          const r = await api.codigo({ telefono: campos.telefono.value }).catch(() => null);
          error.textContent = r?.ok ? "Te enviamos un código nuevo." : "Espera un momento antes de pedir otro código.";
        });
        const confirmar = () => {
          const v = entrada.value.replace(/\D/g, "");
          if (v.length !== 6) {
            error.textContent = "Escribe los 6 números del código.";
            entrada.focus();
            return;
          }
          fin(v);
        };
        entrada.addEventListener("input", () => {
          entrada.value = entrada.value.replace(/\D/g, "").slice(0, 6);
          if (entrada.value.length === 6) confirmar();
        });
        entrada.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), confirmar()));
        capa.append(
          el(
            "div",
            { class: "vd-codigo-caja" },
            el("button", { type: "button", class: "vd-codigo-cerrar", "aria-label": "Cerrar", text: "×", onclick: () => fin(null) }),
            el("h3", { text: "Verifica tu número" }),
            el("p", {
              text:
                envio?.error === "espera"
                  ? `Ya te enviamos un código al ${campos.telefono.value}. Escríbelo aquí:`
                  : `Te enviamos un código de 6 números al ${campos.telefono.value}.`,
            }),
            entrada,
            error,
            el("button", { type: "button", class: "vd-codigo-si", text: "Confirmar pedido", onclick: confirmar }),
            reenviar,
          ),
        );
        panel.append(capa);
        entrada.focus();
      });
    }

    // ─── Upsell de 1 clic (antes de confirmar) ───
    function mostrarUpsell() {
      const u = extras.upsell;
      const t = u.textos || {};
      return new Promise((terminar) => {
        let i = 0;
        let reloj;
        const capa = el("div", { class: "vd-capa vd-upsell" });
        if (u.colores?.fondo) capa.style.setProperty("--vd-u-fondo", u.colores.fondo);
        if (u.colores?.texto) capa.style.setProperty("--vd-u-texto", u.colores.texto);
        if (u.colores?.principal) capa.style.setProperty("--vd-u-principal", u.colores.principal);
        const fin = () => {
          clearInterval(reloj);
          capa.remove();
          terminar();
        };
        const pintar = () => {
          clearInterval(reloj);
          const o = u.ofertas[i];
          if (!o) return fin();
          const pct = o.descuento.tipo === "porcentaje" ? `${o.descuento.valor}%` : fmt.format(o.descuento.valor);
          const temporizador = el("p", { class: "vd-upsell-reloj" });
          if (o.temporizadorMin > 0) {
            let quedan = o.temporizadorMin * 60;
            const pintarReloj = () => {
              const mmss = `${String(Math.floor(quedan / 60)).padStart(2, "0")}:${String(quedan % 60).padStart(2, "0")}`;
              temporizador.textContent = (t.temporizador || "{time}").replace(/\{time\}/g, mmss);
              if (quedan > 0) quedan--;
            };
            pintarReloj();
            reloj = setInterval(pintarReloj, 1000);
          }
          capa.replaceChildren(
            el(
              "div",
              { class: "vd-upsell-caja" },
              t.encabezado ? el("h3", { text: t.encabezado }) : null,
              t.subtitulo ? el("p", { text: t.subtitulo }) : null,
              o.temporizadorMin > 0 ? temporizador : null,
              o.imagen ? el("img", { src: o.imagen, alt: "" }) : null,
              el("p", { class: "vd-upsell-titulo", text: o.titulo }),
              o.antes > o.total ? el("span", { class: "vd-upsell-etiqueta", text: (t.etiquetaDescuento || "-{discount}").replace(/\{discount\}/g, pct) }) : null,
              el(
                "p",
                { class: "vd-upsell-precio" },
                o.antes > o.total ? el("s", { text: fmt.format(o.antes) }) : null,
                el("strong", { text: fmt.format(o.total) }),
              ),
              el("button", {
                type: "button",
                class: "vd-upsell-si",
                text: t.aceptar || "Sí, añadir a mi pedido",
                onclick: () => {
                  estado.upsell = { upsellId: u.id, ofertaId: o.id, total: o.total, antes: o.antes, titulo: o.titulo };
                  fin();
                },
              }),
              el("button", {
                type: "button",
                class: "vd-upsell-no",
                text: t.rechazar || "No, gracias",
                onclick: () => {
                  i++;
                  pintar();
                },
              }),
            ),
          );
        };
        panel.append(capa);
        pintar();
      });
    }

    // ─── Downsell (al cerrar el formulario) ───
    function claveSesion(nombre) {
      return `vd_${nombre}_${producto.id || "x"}`;
    }
    function leerSesion(nombre) {
      try {
        return sessionStorage.getItem(claveSesion(nombre));
      } catch {
        return null;
      }
    }
    function guardarSesion(nombre, valor) {
      try {
        sessionStorage.setItem(claveSesion(nombre), valor);
      } catch {
        /* sin almacenamiento: el downsell sale como máximo una vez por apertura */
      }
    }
    /** Devuelve true si mostró el downsell (y el formulario debe quedarse abierto). */
    function intentarDownsell() {
      const d = extras?.downsell;
      if (!d || estado.downsell || leerSesion("downsell") === d.id) return false;
      const cierres = Number(leerSesion("cierres") || 0) + 1;
      guardarSesion("cierres", String(cierres));
      if (cierres < d.cierresNecesarios) return false;
      guardarSesion("downsell", d.id);
      const t = d.textos || {};
      const valor = d.descuento.tipo === "porcentaje" ? `${d.descuento.valor}%` : fmt.format(d.descuento.valor);
      const capa = el("div", { class: "vd-capa vd-downsell" });
      const c = d.colores || {};
      if (c.fondo) capa.style.setProperty("--vd-d-fondo", c.fondo);
      if (c.texto) capa.style.setProperty("--vd-d-texto", c.texto);
      if (c.boton) capa.style.setProperty("--vd-d-boton", c.boton);
      if (c.textoBoton) capa.style.setProperty("--vd-d-texto-boton", c.textoBoton);
      capa.append(
        el(
          "div",
          { class: "vd-downsell-caja" },
          t.titulo ? el("h3", { text: t.titulo }) : null,
          t.subtitulo ? el("p", { text: t.subtitulo }) : null,
          t.descripcion ? el("p", { class: "vd-downsell-desc", text: t.descripcion }) : null,
          el("div", { class: "vd-downsell-insignia" }, el("strong", { text: valor }), t.insignia ? el("span", { text: t.insignia }) : null),
          el("button", {
            type: "button",
            class: "vd-downsell-si",
            text: (t.aceptar || "Completar pedido con {discount} de descuento").replace(/\{(discount|descuento)\}/g, valor),
            onclick: () => {
              estado.downsell = d.id;
              capa.remove();
              pintarResumen();
              if (estado.decision && !estado.decision.cargando) validar(true);
            },
          }),
          el("button", {
            type: "button",
            class: "vd-downsell-no",
            text: t.rechazar || "No, gracias",
            onclick: () => {
              capa.remove();
              alCerrar?.(true);
            },
          }),
        ),
      );
      panel.append(capa);
      return true;
    }

    // ─── Contenedor ───
    const cerrar =
      modo === "incrustado" || f.preferencias?.ocultarCerrar
        ? null
        : el("button", {
            type: "button",
            class: "vd-cerrar",
            "aria-label": "Cerrar",
            text: "×",
            // Primero el downsell (si aplica); si no se muestra, se cierra de verdad.
            onclick: () => intentarDownsell() || alCerrar?.(true),
          });
    const panel = el("div", { class: `vd-panel vd-${modo}` }, cerrar, form);
    aplicarEstilos(panel, f);
    pintarResumen();
    pintarValidacion(bloqueValidacion?.textoInicial || "");
    return {
      panel,
      intentarDownsell,
      alMostrar() {
        reportar("InitiateCheckout", { value: total(), currency: moneda });
      },
      enfocar() {
        (campos.nombre || form.querySelector("input"))?.focus();
      },
    };
  }

  const apiTienda = {
    validar: (d) => post("validar", d),
    pedido: (d) => post("pedido", d),
    codigo: (d) => post("codigo", d),
    borrador: (d) => post("borrador", d),
  };

  async function datosDe(raiz, producto) {
    const [cfg, deptos] = await Promise.all([cargarConfig(producto.id, varianteActual(raiz, producto).id), cargarCiudades(raiz.dataset.ciudades)]);
    if (!cfg.ok) return null;
    return {
      f: cfg.formulario,
      deptos,
      producto,
      variante: varianteActual(raiz, producto),
      moneda: raiz.dataset.moneda || "COP",
      oferta: cfg.oferta || null,
      nivelInicial: raiz.dataset.nivel,
      paquete: cfg.paquete || null,
      extras: cfg.extras || null,
      integ: cfg.integraciones || null,
    };
  }

  async function abrir(raiz, producto) {
    const datos = await datosDe(raiz, producto);
    if (!datos) {
      alert("No pudimos cargar el formulario. Intenta de nuevo en un momento.");
      return;
    }
    const tecla = (e) => e.key === "Escape" && salir();
    function salir(forzar) {
      // Antes de cerrar se ofrece el downsell (si hay uno y aplica); si se muestra, no se cierra.
      if (!forzar && vista.intentarDownsell()) return;
      fondo.remove();
      document.body.classList.remove("vd-abierto");
      document.removeEventListener("keydown", tecla);
    }
    const vista = construir({ ...datos, modo: "emergente", api: apiTienda, alCerrar: salir });
    const fondo = el("div", { class: "vd-fondo", onclick: (e) => e.target === fondo && salir() }, vista.panel);
    if (datos.f.preferencias?.pantallaCompletaMovil) fondo.classList.add("vd-completa-movil");
    vista.panel.setAttribute("role", "dialog");
    vista.panel.setAttribute("aria-modal", "true");
    document.addEventListener("keydown", tecla);
    document.body.append(fondo);
    document.body.classList.add("vd-abierto");
    vista.alMostrar();
    vista.enfocar();
  }

  async function iniciar() {
    for (const raiz of document.querySelectorAll(".vd-cod:not([data-vd])")) {
      raiz.dataset.vd = "1";
      let producto;
      try {
        producto = JSON.parse(raiz.querySelector('script[type="application/json"]').textContent);
      } catch {
        continue;
      }
      const boton = raiz.querySelector(".vd-boton");
      boton.addEventListener("click", () => abrir(raiz, producto));
      // La configuración se carga de una vez para aplicar el estilo del botón o incrustar el formulario.
      cargarConfig(producto.id, varianteActual(raiz, producto).id).then(async (cfg) => {
        if (!cfg.ok) return;
        if (cfg.formulario.tipo === "incrustado") {
          const datos = await datosDe(raiz, producto);
          if (!datos) return;
          const vista = construir({ ...datos, modo: "incrustado", api: apiTienda });
          boton.replaceWith(vista.panel);
          vista.alMostrar();
        } else {
          estiloBoton(boton, cfg.formulario.boton);
          // Barras de la oferta encima del botón (como Kaching); lo elegido pasa al formulario.
          const o = cfg.oferta;
          if (o && o.ubicacion?.encimaBoton) {
            const moneda = raiz.dataset.moneda || "COP";
            const v = varianteActual(raiz, producto);
            raiz.dataset.nivel = nivelPorDefecto(o);
            boton.before(
              widgetOferta({
                oferta: o,
                precio: v.precio / 100,
                comparacion: (v.comparacion || 0) / 100,
                fmt: new Intl.NumberFormat("es-CO", { style: "currency", currency: moneda, maximumFractionDigits: moneda === "COP" ? 0 : 2 }),
                nivelId: raiz.dataset.nivel,
                alElegir: (id) => (raiz.dataset.nivel = id),
              }),
            );
          }
        }
      });
    }
  }

  // Vista previa del constructor (panel de Validata). Respuestas simuladas, sin pedidos ni píxeles.
  window.ValidataPreview = {
    montar(contenedor, f, deptos, oferta, paquete, extras, integ) {
      const decision = (tel) => {
        const u = tel.replace(/\D/g, "").slice(-1);
        const pagos = { anticipado: 94715, abono: { monto: 29910, saldoContraentrega: 69790 } };
        if (u === "9") return { ok: true, accion: "whatsapp", mensaje: "Para completar tu pedido, confírmalo con un asesor por WhatsApp.", huella: { texto: "Historial con varias devoluciones" }, pagos: null, whatsapp: "#" };
        if (u === "0") return { ok: true, accion: "pago_previo", mensaje: "Para este pedido necesitamos un pago previo. Elige cómo pagar:", huella: { texto: "Historial con devoluciones" }, pagos, whatsapp: null };
        return { ok: true, accion: "contraentrega", mensaje: "✓ Pago contraentrega disponible", huella: { texto: "Buen historial de entregas" }, pagos: null, whatsapp: null };
      };
      const api = {
        validar: async (d) => decision(d.telefono || ""),
        pedido: async () => ({ ok: true, tipo: "pedido", pedido: "#1001", total: 99700 }),
        codigo: async () => ({ ok: true, requerido: true }),
      };
      const producto = { titulo: "Nombre del producto", imagen: "", variantes: [{ id: 1, titulo: "Variante", precio: 9970000, disponible: true }] };
      const vista = construir({ f, deptos, producto, variante: producto.variantes[0], moneda: "COP", modo: "preview", api, oferta: oferta || null, paquete: paquete || null, extras: extras || null, integ: integ || null });
      contenedor.replaceChildren(vista.panel);
    },
    estiloBoton,
    /** Vista previa del editor de paquetes: las dos opciones con los productos reales. */
    montarPaquete(contenedor, paquete, producto) {
      const fmt = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
      contenedor.replaceChildren(
        widgetPaquete({
          paquete,
          producto,
          precio: producto.precio,
          comparacion: producto.comparacion || 0,
          fmt,
          elegido: paquete.porDefecto,
          alElegir: () => {},
        }),
      );
    },
    /** Vista previa del editor de ofertas: solo las barras, con un producto de ejemplo. */
    montarOferta(contenedor, oferta, precio = 99700) {
      const fmt = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
      contenedor.replaceChildren(
        widgetOferta({ oferta, precio, comparacion: 0, fmt, nivelId: nivelPorDefecto(oferta), alElegir: () => {} }),
      );
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
  // Editor de temas: el bloque se puede agregar sin recargar la página.
  document.addEventListener("shopify:section:load", iniciar);
})();
