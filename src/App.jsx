import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

const ESTADOS = ['pendiente', 'confirmado', 'preparando', 'en_camino', 'entregado']
const ESTADO_LABEL = {
  pendiente: 'Pedido enviado',
  confirmado: 'Confirmado',
  preparando: 'Preparando',
  en_camino: 'En camino a tu mesa',
  entregado: '¡Entregado! Buen provecho 🍻',
  cancelado: 'Pedido cancelado',
}
const SOLICITUD_OPCIONES = [
  { tipo: 'mesero', label: '🙋 Hablar con el mesero' },
  { tipo: 'hielo', label: '🧊 Más hielo' },
  { tipo: 'servilletas', label: '🧻 Servilletas' },
  { tipo: 'cuenta', label: '🧾 La cuenta' },
  { tipo: 'otro', label: '✋ Otra cosa' },
]

function storageKey(mesaId) {
  return `ronda_pedido_${mesaId}`
}

function ultimoPedidoKey(mesaId) {
  return `ronda_ultimo_pedido_${mesaId}`
}

function money(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

export default function App() {
  const [fase, setFase] = useState('cargando') // cargando | error | menu | carrito | seguimiento
  const [errorMsg, setErrorMsg] = useState('')
  const [mesa, setMesa] = useState(null)
  const [bar, setBar] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [categoriaActiva, setCategoriaActiva] = useState(null)
  const [carrito, setCarrito] = useState({}) // { productoId: cantidad }
  const [pedido, setPedido] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [modalSolicitud, setModalSolicitud] = useState(false)
  const [toast, setToast] = useState('')
  const [ultimoPedido, setUltimoPedido] = useState(null) // { productoId: cantidad } del último pedido enviado
  const [modalCuenta, setModalCuenta] = useState(false)
  const [cuentaPedidos, setCuentaPedidos] = useState([])
  const [cargandoCuenta, setCargandoCuenta] = useState(false)
  const [upsell, setUpsell] = useState(null) // producto sugerido a mostrar
  const [calificacion, setCalificacion] = useState(0)
  const [propinaEnviada, setPropinaEnviada] = useState(false)
  const [topProductoId, setTopProductoId] = useState(null)

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
        .select('id, nombre, logo_url, activo')
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

      const ultimoGuardado = localStorage.getItem(ultimoPedidoKey(mesaData.id))
      if (ultimoGuardado) {
        try {
          setUltimoPedido(JSON.parse(ultimoGuardado))
        } catch (e) {
          localStorage.removeItem(ultimoPedidoKey(mesaData.id))
        }
      }

      // ¿ya hay un pedido activo guardado para esta mesa?
      const savedId = localStorage.getItem(storageKey(mesaData.id))
      if (savedId) {
        const { data: pedidoData } = await supabase
          .from('pedidos')
          .select('id, estado, total, mesa_id, mesero_id')
          .eq('id', savedId)
          .maybeSingle()

        if (pedidoData && !['entregado', 'cancelado'].includes(pedidoData.estado)) {
          setPedido(pedidoData)
          setFase('seguimiento')
          return
        } else {
          localStorage.removeItem(storageKey(mesaData.id))
        }
      }

      await cargarMenu(mesaData.bar_id)
      setFase('menu')
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function cargarMenu(barId) {
    const { data: cats } = await supabase
      .from('categorias')
      .select('id, nombre, icono, orden')
      .eq('bar_id', barId)
      .order('orden', { ascending: true })

    const { data: prods } = await supabase
      .from('productos')
      .select('id, categoria_id, nombre, descripcion, precio, foto_url, disponible, orden, producto_sugerido_id')
      .eq('bar_id', barId)
      .eq('disponible', true)
      .order('orden', { ascending: true })

    setCategorias(cats || [])
    setProductos(prods || [])
    if (cats && cats.length) setCategoriaActiva(cats[0].id)

    // Calcular el producto más pedido del bar (para la insignia "🔥 más pedido")
    const { data: itemsVendidos } = await supabase
      .from('pedido_items')
      .select('producto_id, cantidad, pedidos!inner(bar_id)')
      .eq('pedidos.bar_id', barId)
    if (itemsVendidos && itemsVendidos.length > 0) {
      const conteo = {}
      itemsVendidos.forEach((it) => {
        conteo[it.producto_id] = (conteo[it.producto_id] || 0) + it.cantidad
      })
      const top = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0]
      if (top && top[1] >= 3) setTopProductoId(top[0]) // solo se destaca si ya tiene al menos 3 unidades vendidas
    }
  }

  // --- Suscripción en tiempo real al estado del pedido ---
  useEffect(() => {
    if (fase !== 'seguimiento' || !pedido?.id) return

    let yaProcesado = false
    async function manejarSiEntregado(estado) {
      if (yaProcesado || !['entregado', 'cancelado'].includes(estado)) return
      yaProcesado = true
      localStorage.removeItem(storageKey(mesa.id))
      if (estado === 'cancelado') {
        setTimeout(async () => {
          if (bar) await cargarMenu(bar.id)
          setFase('menu')
        }, 2500)
      } else {
        // Damos tiempo para que el cliente vea la propina antes de volver solo al menú
        setTimeout(async () => {
          if (bar) await cargarMenu(bar.id)
          setFase((f) => (f === 'seguimiento' ? 'menu' : f))
        }, 25000)
      }
    }

    const channel = supabase
      .channel(`pedido-${pedido.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `id=eq.${pedido.id}` },
        (payload) => {
          setPedido(payload.new)
          manejarSiEntregado(payload.new.estado)
        }
      )
      .subscribe()

    // Respaldo: si por algún motivo no llega el evento en tiempo real, igual lo detectamos revisando cada 4s
    const intervalo = setInterval(async () => {
      const { data } = await supabase.from('pedidos').select('id, estado, total, mesa_id, mesero_id').eq('id', pedido.id).maybeSingle()
      if (data) {
        setPedido(data)
        manejarSiEntregado(data.estado)
      }
    }, 4000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(intervalo)
    }
  }, [fase, pedido?.id, mesa, bar])

  async function enviarPropina(pct) {
    if (!pedido) return
    const monto = Math.round(pedido.total * pct)
    await supabase.from('propinas').insert({
      pedido_id: pedido.id,
      mesero_id: pedido.mesero_id || null,
      monto,
      calificacion: calificacion || null,
    })
    mostrarToast(`¡Gracias! Propina de ${money(monto)} registrada 🙌`)
    setPropinaEnviada(true)
    setTimeout(async () => {
      if (bar) await cargarMenu(bar.id)
      setFase('menu')
    }, 1800)
  }

  async function terminarSinPropina() {
    if (calificacion > 0 && pedido) {
      await supabase.from('propinas').insert({ pedido_id: pedido.id, mesero_id: pedido.mesero_id || null, monto: 0, calificacion })
    }
    if (bar) await cargarMenu(bar.id)
    setFase('menu')
  }

  const productosVisibles = useMemo(
    () => productos.filter((p) => p.categoria_id === categoriaActiva),
    [productos, categoriaActiva]
  )

  const totalItems = useMemo(() => Object.values(carrito).reduce((a, b) => a + b, 0), [carrito])
  const totalPrecio = useMemo(() => {
    return Object.entries(carrito).reduce((sum, [prodId, cant]) => {
      const p = productos.find((x) => x.id === prodId)
      return sum + (p ? p.precio * cant : 0)
    }, 0)
  }, [carrito, productos])

  function agregar(productoId) {
    setCarrito((c) => ({ ...c, [productoId]: (c[productoId] || 0) + 1 }))

    const producto = productos.find((p) => p.id === productoId)
    if (producto?.producto_sugerido_id && !carrito[producto.producto_sugerido_id]) {
      const sugerido = productos.find((p) => p.id === producto.producto_sugerido_id)
      if (sugerido) setUpsell(sugerido)
    }
  }
  function agregarSugerido() {
    if (!upsell) return
    agregarSinUpsell(upsell.id)
    setUpsell(null)
  }
  function agregarSinUpsell(productoId) {
    setCarrito((c) => ({ ...c, [productoId]: (c[productoId] || 0) + 1 }))
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

  async function crearPedido(itemsMap) {
    const entries = Object.entries(itemsMap).filter(([, cant]) => cant > 0)
    if (entries.length === 0) return
    setEnviando(true)
    try {
      const totalCalculado = entries.reduce((sum, [prodId, cant]) => {
        const p = productos.find((x) => x.id === prodId)
        return sum + (p ? p.precio * cant : 0)
      }, 0)

      const { data: nuevoPedido, error: pedidoErr } = await supabase
        .from('pedidos')
        .insert({ bar_id: bar.id, mesa_id: mesa.id, estado: 'pendiente', total: totalCalculado, sesion_id: mesa.sesion_actual })
        .select()
        .single()

      if (pedidoErr) throw pedidoErr

      const items = entries.map(([prodId, cant]) => {
        const p = productos.find((x) => x.id === prodId)
        return {
          pedido_id: nuevoPedido.id,
          producto_id: prodId,
          cantidad: cant,
          precio_unitario: p.precio,
        }
      })
      const { error: itemsErr } = await supabase.from('pedido_items').insert(items)
      if (itemsErr) throw itemsErr

      localStorage.setItem(storageKey(mesa.id), nuevoPedido.id)
      localStorage.setItem(ultimoPedidoKey(mesa.id), JSON.stringify(Object.fromEntries(entries)))
      setUltimoPedido(Object.fromEntries(entries))
      setPedido(nuevoPedido)
      setCalificacion(0)
      setPropinaEnviada(false)
      setFase('seguimiento')
    } catch (e) {
      mostrarToast('No pudimos enviar tu pedido. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  async function enviarPedido() {
    if (enviando || totalItems === 0) return
    await crearPedido(carrito)
    setCarrito({})
  }

  async function repetirPedido() {
    if (enviando || !ultimoPedido) return
    await crearPedido(ultimoPedido)
  }

  async function enviarSolicitud(tipo) {
    setModalSolicitud(false)
    const { error } = await supabase.from('solicitudes').insert({ bar_id: bar.id, mesa_id: mesa.id, tipo })
    if (error) {
      mostrarToast('No se pudo enviar. Intenta otra vez.')
    } else {
      mostrarToast('Ya avisamos al mesero 👍')
    }
  }

  async function abrirCuenta() {
    setCargandoCuenta(true)
    setModalCuenta(true)
    const { data: pedidosData } = await supabase
      .from('pedidos')
      .select('id, estado, total, created_at')
      .eq('mesa_id', mesa.id)
      .eq('sesion_id', mesa.sesion_actual)
      .neq('estado', 'cancelado')
      .order('created_at', { ascending: true })

    const pedidosIds = (pedidosData || []).map((p) => p.id)
    let itemsPorPedido = {}
    if (pedidosIds.length > 0) {
      const { data: itemsData } = await supabase
        .from('pedido_items')
        .select('pedido_id, cantidad, precio_unitario, productos(nombre)')
        .in('pedido_id', pedidosIds)
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
    return (
      <div className="center-msg">
        <div className="spinner" />
        <p>Abriendo la carta…</p>
      </div>
    )
  }

  if (fase === 'error') {
    return (
      <div className="center-msg">
        <div className="center-msg-icono">🍸</div>
        <p>{errorMsg}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">{bar?.nombre}</div>
        <div className="header-mesa">Mesa {mesa?.numero}</div>
      </header>

      {fase === 'menu' && (
        <>
          <nav className="categorias">
            {categorias.map((c) => (
              <button
                key={c.id}
                className={`cat-btn ${categoriaActiva === c.id ? 'activa' : ''}`}
                onClick={() => setCategoriaActiva(c.id)}
              >
                {c.icono ? `${c.icono} ` : ''}
                {c.nombre}
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
                  <div className="producto-icono">
                    {categorias.find((c) => c.id === p.categoria_id)?.icono || '🍸'}
                  </div>
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
                  <button className="qty-btn qty-btn-add" onClick={() => agregar(p.id)}>+</button>
                </div>
              </div>
            ))}
            {productosVisibles.length === 0 && <p className="vacio">No hay productos en esta categoría.</p>}
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

          {totalItems > 0 && (
            <div className="barra-carrito" onClick={() => setFase('carrito')}>
              <span>{totalItems} producto{totalItems > 1 ? 's' : ''}</span>
              <span>{money(totalPrecio)}</span>
              <span>Ver pedido →</span>
            </div>
          )}

          {totalItems === 0 && ultimoPedido && (
            <button className="barra-repetir" onClick={repetirPedido} disabled={enviando}>
              {enviando ? 'Enviando…' : '🔁 Otra ronda (repetir el mismo pedido)'}
            </button>
          )}
        </>
      )}

      {fase === 'carrito' && (
        <main className="carrito-view">
          <h2>Tu pedido</h2>
          {Object.entries(carrito).map(([prodId, cant]) => {
            const p = productos.find((x) => x.id === prodId)
            if (!p) return null
            return (
              <div key={prodId} className="carrito-item">
                <span>{p.nombre}</span>
                <div className="producto-cantidad">
                  <button className="qty-btn" onClick={() => quitar(prodId)}>−</button>
                  <span className="qty-num">{cant}</span>
                  <button className="qty-btn qty-btn-add" onClick={() => agregar(prodId)}>+</button>
                </div>
                <span>{money(p.precio * cant)}</span>
              </div>
            )
          })}
          <div className="carrito-total">
            <strong>Total</strong>
            <strong>{money(totalPrecio)}</strong>
          </div>
          <button className="btn-primario" disabled={enviando || totalItems === 0} onClick={enviarPedido}>
            {enviando ? 'Enviando…' : 'Enviar pedido'}
          </button>
          <button className="btn-secundario" onClick={() => setFase('menu')}>← Seguir viendo el menú</button>
        </main>
      )}

      {fase === 'seguimiento' && pedido && (
        <main className="seguimiento-view">
          <h2>{ESTADO_LABEL[pedido.estado] || pedido.estado}</h2>
          <div className="pasos">
            {ESTADOS.map((e, i) => {
              const pasoActual = ESTADOS.indexOf(pedido.estado)
              const activo = i <= pasoActual
              return (
                <div key={e} className={`paso ${activo ? 'paso-activo' : ''}`}>
                  <div className="paso-punto" />
                  <div className="paso-label">{ESTADO_LABEL[e]}</div>
                </div>
              )
            })}
          </div>
          <div className="seguimiento-total">
            <span>Total del pedido</span>
            <strong>{money(pedido.total)}</strong>
          </div>

          {pedido.estado === 'entregado' && !propinaEnviada && (
            <div className="propina-box">
              <p className="propina-titulo">¿Cómo te atendieron?</p>
              <div className="estrellas">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    className={`estrella ${n <= calificacion ? 'estrella-activa' : ''}`}
                    onClick={() => setCalificacion(n)}
                  >
                    ★
                  </span>
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
          {pedido.estado === 'entregado' && propinaEnviada && (
            <p className="propina-gracias">¡Gracias por tu propina! 🙌</p>
          )}
        </main>
      )}

      <button className="btn-flotante btn-flotante-cuenta" onClick={abrirCuenta}>🧾 Mi cuenta</button>
      <button className="btn-flotante" onClick={() => setModalSolicitud(true)}>✋ Necesito algo</button>

      {modalCuenta && (
        <div className="modal-overlay" onClick={() => setModalCuenta(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mi cuenta — Mesa {mesa?.numero}</h3>
            {cargandoCuenta && <p className="vacio">Cargando…</p>}
            {!cargandoCuenta && cuentaPedidos.length === 0 && (
              <p className="vacio">Todavía no has hecho ningún pedido en esta visita.</p>
            )}
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
                <div className="cuenta-total">
                  <strong>Total de la mesa</strong>
                  <strong>{money(cuentaPedidos.reduce((s, p) => s + Number(p.total), 0))}</strong>
                </div>
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
              <button key={o.tipo} className="modal-opcion" onClick={() => enviarSolicitud(o.tipo)}>
                {o.label}
              </button>
            ))}
            <button className="btn-secundario" onClick={() => setModalSolicitud(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

