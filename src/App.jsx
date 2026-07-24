import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

const ESTADOS = ['pendiente', 'confirmado', 'preparando', 'en_camino', 'entregado']
const METODOS_PAGO = [
  { id: 'efectivo', label: '💵 Efectivo' },
  { id: 'nequi', label: '📱 Nequi', llaveField: 'llave_nequi' },
  { id: 'daviplata', label: '📱 Daviplata', llaveField: 'llave_daviplata' },
  { id: 'bre_b', label: '📱 Bre-B', llaveField: 'llave_bre_b' },
]
const ESTADO_LABEL = {
  pendiente: 'El bar ya vio tu pedido',
  confirmado: 'Confirmado por el bar',
  preparando: 'Preparando tu ronda',
  en_camino: 'Tu mesero va en camino',
  entregado: '¡Entregado! Buen provecho 🍻',
  cancelado: 'Pedido cancelado',
}
const ESTADO_ICONO = {
  pendiente: '🧾',
  confirmado: '👍',
  preparando: '🍹',
  en_camino: '🚶',
  entregado: '✅',
}
const SOLICITUD_OPCIONES = [
  { tipo: 'mesero', label: '🙋 Hablar con el mesero' },
  { tipo: 'hielo', label: '🧊 Más hielo' },
  { tipo: 'servilletas', label: '🧻 Servilletas' },
  { tipo: 'cuenta', label: '🧾 La cuenta' },
  { tipo: 'otro', label: '✋ Otra cosa' },
]

function storageKey(mesaId) { return `ronda_pedido_${mesaId}` }
function ultimoPedidoKey(mesaId) { return `ronda_ultimo_pedido_${mesaId}` }
function nombreKey(mesaId) { return `ronda_nombre_${mesaId}` }

function money(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)
}

export default function App() {
  const [fase, setFase] = useState('cargando') // cargando | error | listo
  const [errorMsg, setErrorMsg] = useState('')
  const [mesa, setMesa] = useState(null)
  const [bar, setBar] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [categoriaActiva, setCategoriaActiva] = useState(null)
  const [carrito, setCarrito] = useState({}) // { productoId: cantidad }
  const [pedido, setPedido] = useState(null) // pedido activo (no entregado/cancelado) o null
  const [enviando, setEnviando] = useState(false)
  const [editando, setEditando] = useState(false)

  const [nombreCliente, setNombreCliente] = useState('')
  const [totalVisita, setTotalVisita] = useState(0)

  const [modalCarrito, setModalCarrito] = useState(false)
  const [modalSolicitud, setModalSolicitud] = useState(false)
  const [modalCuenta, setModalCuenta] = useState(false)
  const [cuentaPedidos, setCuentaPedidos] = useState([])
  const [cargandoCuenta, setCargandoCuenta] = useState(false)

  const [toast, setToast] = useState('')
  const [ultimoPedido, setUltimoPedido] = useState(null)
  const [upsell, setUpsell] = useState(null)
  const [calificacion, setCalificacion] = useState(0)
  const [propinaEnviada, setPropinaEnviada] = useState(false)
  const [topProductoId, setTopProductoId] = useState(null)

  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [comprobanteUrl, setComprobanteUrl] = useState(null)
  const [subiendoComprobante, setSubiendoComprobante] = useState(false)

  const mostrarToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  // --- Carga inicial: resolver mesa desde el QR ---
  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search)
      const qr = params.get('m')
      if (!qr) {
        setErrorMsg('Este enlace no tiene un código de mesa válido.')
        setFase('error')
        return
      }

      const { data: mesaData, error: mesaErr } = await supabase
        .from('mesas')
        .select('id, numero, bar_id, activa, sesion_actual')
        .eq('qr_code', qr)
        .eq('activa', true)
        .maybeSingle()

      if (mesaErr || !mesaData) {
        setErrorMsg('No encontramos esta mesa. Pide ayuda al mesero.')
        setFase('error')
        return
      }

      const { data: barData, error: barErr } = await supabase
        .from('bares')
        .select('id, nombre, logo_url, activo, llave_nequi, llave_daviplata, llave_bre_b, propinas_habilitadas')
        .eq('id', mesaData.bar_id)
        .eq('activo', true)
        .maybeSingle()

      if (barErr || !barData) {
        setErrorMsg('Este bar no está disponible en este momento.')
        setFase('error')
        return
      }

      setMesa(mesaData)
      setBar(barData)
      setNombreCliente(localStorage.getItem(nombreKey(mesaData.id)) || '')

      const ultimoGuardado = localStorage.getItem(ultimoPedidoKey(mesaData.id))
      if (ultimoGuardado) {
        try { setUltimoPedido(JSON.parse(ultimoGuardado)) } catch (e) { localStorage.removeItem(ultimoPedidoKey(mesaData.id)) }
      }

      const savedId = localStorage.getItem(storageKey(mesaData.id))
      if (savedId) {
        const { data: pedidoData } = await supabase
          .from('pedidos')
          .select('id, estado, total, mesa_id, mesero_id, cliente_nombre')
          .eq('id', savedId)
          .maybeSingle()
        if (pedidoData && !['entregado', 'cancelado'].includes(pedidoData.estado)) {
          setPedido(pedidoData)
        } else {
          localStorage.removeItem(storageKey(mesaData.id))
        }
      }

      await cargarMenu(mesaData.bar_id)
      await refrescarTotalVisita(mesaData)
      setFase('listo')
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function cargarMenu(barId) {
    const { data: cats } = await supabase
      .from('categorias').select('id, nombre, icono, orden')
      .eq('bar_id', barId).order('orden', { ascending: true })
    const { data: prods } = await supabase
      .from('productos')
      .select('id, categoria_id, nombre, descripcion, precio, foto_url, disponible, orden, producto_sugerido_id')
      .eq('bar_id', barId).eq('disponible', true).order('orden', { ascending: true })

    setCategorias(cats || [])
    setProductos(prods || [])
    if (cats && cats.length) setCategoriaActiva(cats[0].id)

    const { data: itemsVendidos } = await supabase
      .from('pedido_items').select('producto_id, cantidad, pedidos!inner(bar_id)').eq('pedidos.bar_id', barId)
    if (itemsVendidos && itemsVendidos.length > 0) {
      const conteo = {}
      itemsVendidos.forEach((it) => { conteo[it.producto_id] = (conteo[it.producto_id] || 0) + it.cantidad })
      const top = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0]
      if (top && top[1] >= 3) setTopProductoId(top[0])
    }
  }

  async function refrescarTotalVisita(mesaRef) {
    const m = mesaRef || mesa
    if (!m) return
    const { data } = await supabase
      .from('pedidos').select('total')
      .eq('mesa_id', m.id).eq('sesion_id', m.sesion_actual).neq('estado', 'cancelado')
    setTotalVisita((data || []).reduce((s, p) => s + Number(p.total), 0))
  }

  function guardarNombre(valor) {
    setNombreCliente(valor)
    if (mesa) localStorage.setItem(nombreKey(mesa.id), valor)
  }

  // --- Suscripción en tiempo real + respaldo por polling al pedido activo ---
  useEffect(() => {
    if (!pedido?.id) return
    let yaProcesado = false

    async function manejarCambio(estado) {
      if (estado === 'cancelado' && !yaProcesado) {
        yaProcesado = true
        localStorage.removeItem(storageKey(mesa.id))
        mostrarToast('Tu pedido fue cancelado.')
        setTimeout(() => { setPedido(null); refrescarTotalVisita() }, 1500)
      }
    }

    const channel = supabase
      .channel(`pedido-${pedido.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `id=eq.${pedido.id}` }, (payload) => {
        setPedido(payload.new)
        manejarCambio(payload.new.estado)
        refrescarTotalVisita()
      })
      .subscribe()

    const intervalo = setInterval(async () => {
      const { data } = await supabase.from('pedidos').select('id, estado, total, mesa_id, mesero_id, cliente_nombre').eq('id', pedido.id).maybeSingle()
      if (data) { setPedido(data); manejarCambio(data.estado) }
    }, 4000)

    return () => { supabase.removeChannel(channel); clearInterval(intervalo) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.id])

  const productosVisibles = useMemo(() => productos.filter((p) => p.categoria_id === categoriaActiva), [productos, categoriaActiva])
  const totalItems = useMemo(() => Object.values(carrito).reduce((a, b) => a + b, 0), [carrito])
  const totalCarrito = useMemo(() => Object.entries(carrito).reduce((sum, [id, cant]) => {
    const p = productos.find((x) => x.id === id)
    return sum + (p ? p.precio * cant : 0)
  }, 0), [carrito, productos])

  // El pedido bloquea nuevos productos solo cuando el mesero YA empezó a atenderlo (más allá de "pendiente")
  const pedidoBloqueado = pedido && pedido.estado !== 'pendiente' && pedido.estado !== 'entregado' && pedido.estado !== 'cancelado'

  function agregar(productoId) {
    if (pedidoBloqueado) return
    setCarrito((c) => ({ ...c, [productoId]: (c[productoId] || 0) + 1 }))
    const producto = productos.find((p) => p.id === productoId)
    if (producto?.producto_sugerido_id && !carrito[producto.producto_sugerido_id]) {
      const sugerido = productos.find((p) => p.id === producto.producto_sugerido_id)
      if (sugerido) setUpsell(sugerido)
    }
  }
  function quitar(productoId) {
    setCarrito((c) => {
      const next = { ...c }
      if (!next[productoId]) return next
      next[productoId] -= 1
      if (next[productoId] <= 0) delete next[productoId]
      return next
    })
  }
  function agregarSugerido() {
    if (!upsell) return
    setCarrito((c) => ({ ...c, [upsell.id]: (c[upsell.id] || 0) + 1 }))
    setUpsell(null)
  }

  // --- Abrir el carrito para editar el pedido pendiente actual ---
  async function abrirEdicionPedido() {
    if (!pedido) return
    const { data: items } = await supabase.from('pedido_items').select('producto_id, cantidad').eq('pedido_id', pedido.id)
    const mapa = {}
    ;(items || []).forEach((it) => { mapa[it.producto_id] = it.cantidad })
    setCarrito(mapa)
    setEditando(true)
    setModalCarrito(true)
  }

  function abrirCarritoNuevo() {
    setEditando(false)
    setModalCarrito(true)
  }

  async function subirComprobante(file) {
    if (!file) return
    setSubiendoComprobante(true)
    try {
      const nombreArchivo = `${mesa.id}_${Date.now()}_${file.name}`
      const { error } = await supabase.storage.from('comprobantes').upload(nombreArchivo, file)
      if (error) throw error
      const { data } = supabase.storage.from('comprobantes').getPublicUrl(nombreArchivo)
      setComprobanteUrl(data.publicUrl)
      mostrarToast('Comprobante subido ✅')
    } catch (e) {
      mostrarToast('No se pudo subir el comprobante. Intenta de nuevo.')
    } finally {
      setSubiendoComprobante(false)
    }
  }

  async function confirmarPedido() {
    const entries = Object.entries(carrito).filter(([, cant]) => cant > 0)
    if (entries.length === 0) return
    setEnviando(true)
    try {
      const total = entries.reduce((sum, [id, cant]) => {
        const p = productos.find((x) => x.id === id)
        return sum + (p ? p.precio * cant : 0)
      }, 0)

      if (editando && pedido) {
        await supabase.from('pedido_items').delete().eq('pedido_id', pedido.id)
        const items = entries.map(([id, cant]) => {
          const p = productos.find((x) => x.id === id)
          return { pedido_id: pedido.id, producto_id: id, cantidad: cant, precio_unitario: p.precio }
        })
        await supabase.from('pedido_items').insert(items)
        await supabase.from('pedidos').update({ total, cliente_nombre: nombreCliente || null }).eq('id', pedido.id)
        await supabase.from('pagos').update({ metodo: metodoPago, monto: total, comprobante_url: comprobanteUrl || null }).eq('pedido_id', pedido.id)
        setPedido({ ...pedido, total })
        mostrarToast('Pedido actualizado ✏️')
      } else {
        const { data: nuevoPedido, error: pedidoErr } = await supabase
          .from('pedidos')
          .insert({ bar_id: bar.id, mesa_id: mesa.id, estado: 'pendiente', total, sesion_id: mesa.sesion_actual, cliente_nombre: nombreCliente || null })
          .select().single()
        if (pedidoErr) throw pedidoErr

        const items = entries.map(([id, cant]) => {
          const p = productos.find((x) => x.id === id)
          return { pedido_id: nuevoPedido.id, producto_id: id, cantidad: cant, precio_unitario: p.precio }
        })
        await supabase.from('pedido_items').insert(items)
        await supabase.from('pagos').insert({ pedido_id: nuevoPedido.id, metodo: metodoPago, monto: total, comprobante_url: comprobanteUrl || null, confirmado: false })

        localStorage.setItem(storageKey(mesa.id), nuevoPedido.id)
        localStorage.setItem(ultimoPedidoKey(mesa.id), JSON.stringify(Object.fromEntries(entries)))
        setUltimoPedido(Object.fromEntries(entries))
        setPedido(nuevoPedido)
        setCalificacion(0)
        setPropinaEnviada(false)
      }

      setCarrito({})
      setEditando(false)
      setModalCarrito(false)
      setMetodoPago('efectivo')
      setComprobanteUrl(null)
      refrescarTotalVisita()
    } catch (e) {
      mostrarToast('No pudimos enviar tu pedido. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  async function repetirPedido() {
    if (enviando || !ultimoPedido) return
    setCarrito(ultimoPedido)
    setEditando(false)
    setEnviando(true)
    try {
      const entries = Object.entries(ultimoPedido).filter(([, c]) => c > 0)
      const total = entries.reduce((sum, [id, cant]) => {
        const p = productos.find((x) => x.id === id)
        return sum + (p ? p.precio * cant : 0)
      }, 0)
      const { data: nuevoPedido, error: pedidoErr } = await supabase
        .from('pedidos')
        .insert({ bar_id: bar.id, mesa_id: mesa.id, estado: 'pendiente', total, sesion_id: mesa.sesion_actual, cliente_nombre: nombreCliente || null })
        .select().single()
      if (pedidoErr) throw pedidoErr
      const items = entries.map(([id, cant]) => {
        const p = productos.find((x) => x.id === id)
        return { pedido_id: nuevoPedido.id, producto_id: id, cantidad: cant, precio_unitario: p.precio }
      })
      await supabase.from('pedido_items').insert(items)
      await supabase.from('pagos').insert({ pedido_id: nuevoPedido.id, metodo: 'efectivo', monto: total, confirmado: false })
      localStorage.setItem(storageKey(mesa.id), nuevoPedido.id)
      setPedido(nuevoPedido)
      setCalificacion(0)
      setPropinaEnviada(false)
      setCarrito({})
      refrescarTotalVisita()
    } catch (e) {
      mostrarToast('No pudimos repetir el pedido.')
    } finally {
      setEnviando(false)
    }
  }

  async function enviarPropina(pct) {
    if (!pedido) return
    const monto = Math.round(pedido.total * pct)
    await supabase.from('propinas').insert({ pedido_id: pedido.id, mesero_id: pedido.mesero_id || null, monto, calificacion: calificacion || null })
    mostrarToast(`¡Gracias! Propina de ${money(monto)} registrada 🙌`)
    setPropinaEnviada(true)
    setTimeout(() => { localStorage.removeItem(storageKey(mesa.id)); setPedido(null) }, 1800)
  }

  async function terminarSinPropina() {
    if (calificacion > 0 && pedido) {
      await supabase.from('propinas').insert({ pedido_id: pedido.id, mesero_id: pedido.mesero_id || null, monto: 0, calificacion })
    }
    localStorage.removeItem(storageKey(mesa.id))
    setPedido(null)
  }

  async function enviarSolicitud(tipo) {
    setModalSolicitud(false)
    const { error } = await supabase.from('solicitudes').insert({ bar_id: bar.id, mesa_id: mesa.id, tipo })
    mostrarToast(error ? 'No se pudo enviar. Intenta otra vez.' : 'Ya avisamos al mesero 👍')
  }

  async function abrirCuenta() {
    setCargandoCuenta(true)
    setModalCuenta(true)
    const { data: pedidosData } = await supabase
      .from('pedidos').select('id, estado, total, created_at')
      .eq('mesa_id', mesa.id).eq('sesion_id', mesa.sesion_actual).neq('estado', 'cancelado')
      .order('created_at', { ascending: true })

    const ids = (pedidosData || []).map((p) => p.id)
    let itemsPorPedido = {}
    if (ids.length > 0) {
      const { data: itemsData } = await supabase.from('pedido_items').select('pedido_id, cantidad, precio_unitario, productos(nombre)').in('pedido_id', ids)
      itemsPorPedido = (itemsData || []).reduce((acc, it) => {
        if (!acc[it.pedido_id]) acc[it.pedido_id] = []
        acc[it.pedido_id].push(it)
        return acc
      }, {})
    }
    setCuentaPedidos((pedidosData || []).map((p) => ({ ...p, items: itemsPorPedido[p.id] || [] })))
    setCargandoCuenta(false)
  }

  // --- Pantallas ---
  if (fase === 'cargando') {
    return <div className="center-msg"><div className="spinner" /><p>Abriendo la carta…</p></div>
  }
  if (fase === 'error') {
    return <div className="center-msg"><div className="center-msg-icono">🍸</div><p>{errorMsg}</p></div>
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">{bar?.nombre}</div>
        <div className="header-mesa">Mesa {mesa?.numero}</div>
      </header>

      <div className="total-visita">
        <span>Hoy llevas</span>
        <strong>{money(totalVisita)}</strong>
      </div>

      {pedido && (
        <div className={`banner-estado banner-${pedido.estado}`}>
          <div className="banner-icono">{ESTADO_ICONO[pedido.estado] || '🍻'}</div>
          <div className="banner-texto">
            <div className="banner-titulo">{ESTADO_LABEL[pedido.estado] || pedido.estado}</div>
            <div className="banner-total">{money(pedido.total)}</div>
          </div>
          {pedido.estado === 'pendiente' && (
            <button className="banner-editar" onClick={abrirEdicionPedido}>✏️ Editar</button>
          )}
        </div>
      )}

      {pedido?.estado === 'entregado' && !propinaEnviada && bar?.propinas_habilitadas !== false && (
        <div className="propina-box">
          <p className="propina-titulo">¿Cómo te atendieron?</p>
          <div className="estrellas">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`estrella ${n <= calificacion ? 'estrella-activa' : ''}`} onClick={() => setCalificacion(n)}>★</span>
            ))}
          </div>
          <p className="propina-titulo">¿Dejamos propina?</p>
          <div className="propina-botones">
            <button onClick={() => enviarPropina(0.10)}>10%</button>
            <button onClick={() => enviarPropina(0.15)}>15%</button>
            <button onClick={() => enviarPropina(0.20)}>20%</button>
          </div>
          <button className="btn-secundario" onClick={terminarSinPropina}>No, gracias</button>
        </div>
      )}

      <div className="campo-nombre">
        <label>¿Quién de la mesa está pidiendo?</label>
        <input type="text" value={nombreCliente} onChange={(e) => guardarNombre(e.target.value)} placeholder="Ej: Santiago" maxLength={30} />
      </div>

      <nav className="categorias">
        {categorias.map((c) => (
          <button key={c.id} className={`cat-btn ${categoriaActiva === c.id ? 'activa' : ''}`} onClick={() => setCategoriaActiva(c.id)}>
            {c.icono ? `${c.icono} ` : ''}{c.nombre}
          </button>
        ))}
      </nav>

      <main className="productos">
        {productosVisibles.map((p) => (
          <div key={p.id} className="producto-card">
            {p.id === topProductoId && <span className="producto-badge">🔥 Más pedido</span>}
            {p.foto_url ? (
              <img src={p.foto_url} alt={p.nombre} className="producto-foto" />
            ) : (
              <div className="producto-icono">{categorias.find((c) => c.id === p.categoria_id)?.icono || '🍸'}</div>
            )}
            <div className="producto-info">
              <div className="producto-nombre">{p.nombre}</div>
              <div className="producto-precio">{money(p.precio)}</div>
            </div>
            <div className="producto-cantidad">
              {carrito[p.id] > 0 && (
                <>
                  <button className="qty-btn" onClick={() => quitar(p.id)}>−</button>
                  <span className="qty-num">{carrito[p.id]}</span>
                </>
              )}
              <button className="qty-btn qty-btn-add" onClick={() => agregar(p.id)} disabled={pedidoBloqueado}>+</button>
            </div>
          </div>
        ))}
        {productosVisibles.length === 0 && <p className="vacio">No hay productos en esta categoría.</p>}
        {pedidoBloqueado && <p className="vacio">El mesero ya está atendiendo tu pedido — cuando lo entreguen podrás pedir otra ronda.</p>}
      </main>

      {upsell && (
        <div className="upsell-banner">
          <span>¿Agregas {upsell.nombre} por {money(upsell.precio)}?</span>
          <div className="upsell-botones">
            <button className="upsell-si" onClick={agregarSugerido}>Sí, agregar</button>
            <button className="upsell-no" onClick={() => setUpsell(null)}>No, gracias</button>
          </div>
        </div>
      )}

      {totalItems > 0 && !editando && (
        <button className="barra-carrito" onClick={abrirCarritoNuevo}>
          <span>{totalItems} producto{totalItems > 1 ? 's' : ''}</span>
          <span>Revisar y enviar → {money(totalCarrito)}</span>
        </button>
      )}
      {totalItems === 0 && !pedido && ultimoPedido && (
        <button className="barra-repetir" onClick={repetirPedido} disabled={enviando}>
          {enviando ? 'Enviando…' : '🔁 Otra ronda (repetir el mismo pedido)'}
        </button>
      )}

      <button className="btn-flotante btn-flotante-cuenta" onClick={abrirCuenta}>🧾 Mi cuenta</button>
      <button className="btn-flotante" onClick={() => setModalSolicitud(true)}>✋ Necesito algo</button>

      {modalCarrito && (
        <div className="modal-overlay" onClick={() => setModalCarrito(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editando ? 'Editar tu pedido' : 'Tu pedido'}</h3>
            <div className="cuenta-lista">
              {Object.entries(carrito).map(([id, cant]) => {
                const p = productos.find((x) => x.id === id)
                if (!p) return null
                return (
                  <div key={id} className="carrito-item">
                    <span>{p.nombre}</span>
                    <div className="producto-cantidad">
                      <button className="qty-btn" onClick={() => quitar(id)}>−</button>
                      <span className="qty-num">{cant}</span>
                      <button className="qty-btn qty-btn-add" onClick={() => setCarrito((c) => ({ ...c, [id]: (c[id] || 0) + 1 }))}>+</button>
                    </div>
                    <span>{money(p.precio * cant)}</span>
                  </div>
                )
              })}
            </div>
            <div className="carrito-total"><strong>Total</strong><strong>{money(totalCarrito)}</strong></div>

            <p className="pago-titulo">¿Cómo vas a pagar?</p>
            <div className="pago-metodos">
              {METODOS_PAGO.filter((m) => m.id === 'efectivo' || bar[m.llaveField]).map((m) => (
                <button key={m.id} className={`pago-btn ${metodoPago === m.id ? 'activo' : ''}`} onClick={() => setMetodoPago(m.id)}>{m.label}</button>
              ))}
            </div>
            {metodoPago !== 'efectivo' && (
              <div className="pago-detalle">
                <p className="pago-numero">Transfiere a: <strong>{bar[METODOS_PAGO.find((m) => m.id === metodoPago).llaveField]}</strong></p>
                <label className="pago-subir">
                  {subiendoComprobante ? 'Subiendo…' : comprobanteUrl ? '✅ Comprobante subido — cambiar' : '📎 Subir foto del comprobante'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => subirComprobante(e.target.files[0])} />
                </label>
              </div>
            )}

            <button className="btn-primario" disabled={enviando || totalItems === 0} onClick={confirmarPedido}>
              {enviando ? 'Enviando…' : editando ? 'Actualizar pedido' : 'Enviar pedido'}
            </button>
            <button className="btn-secundario" onClick={() => { setModalCarrito(false); setEditando(false) }}>← Seguir viendo el menú</button>
          </div>
        </div>
      )}

      {modalCuenta && (
        <div className="modal-overlay" onClick={() => setModalCuenta(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mi cuenta — Mesa {mesa?.numero}</h3>
            {cargandoCuenta && <p className="vacio">Cargando…</p>}
            {!cargandoCuenta && cuentaPedidos.length === 0 && <p className="vacio">Todavía no has hecho ningún pedido en esta visita.</p>}
            {!cargandoCuenta && cuentaPedidos.length > 0 && (
              <>
                <div className="cuenta-lista">
                  {cuentaPedidos.map((p, i) => (
                    <div key={p.id} className="cuenta-ronda">
                      <div className="cuenta-fila cuenta-fila-titulo">
                        <span>Ronda {i + 1} — {ESTADO_LABEL[p.estado] || p.estado}</span>
                        <span>{money(p.total)}</span>
                      </div>
                      {p.items.map((it, j) => (
                        <div key={j} className="cuenta-fila-item">
                          <span>{it.cantidad}x {it.productos?.nombre}</span>
                          <span>{money(it.precio_unitario * it.cantidad)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="cuenta-total"><strong>Total de la mesa</strong><strong>{money(cuentaPedidos.reduce((s, p) => s + Number(p.total), 0))}</strong></div>
              </>
            )}
            <button className="btn-secundario" onClick={() => setModalCuenta(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {modalSolicitud && (
        <div className="modal-overlay" onClick={() => setModalSolicitud(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Qué necesitas?</h3>
            {SOLICITUD_OPCIONES.map((o) => (
              <button key={o.tipo} className="modal-opcion" onClick={() => enviarSolicitud(o.tipo)}>{o.label}</button>
            ))}
            <button className="btn-secundario" onClick={() => setModalSolicitud(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
