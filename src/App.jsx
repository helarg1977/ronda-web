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
        .select('id, numero, bar_id, activa')
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

      // ¿ya hay un pedido activo guardado para esta mesa?
      const savedId = localStorage.getItem(storageKey(mesaData.id))
      if (savedId) {
        const { data: pedidoData } = await supabase
          .from('pedidos')
          .select('id, estado, total, mesa_id')
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
      .select('id, categoria_id, nombre, descripcion, precio, foto_url, disponible, orden')
      .eq('bar_id', barId)
      .eq('disponible', true)
      .order('orden', { ascending: true })

    setCategorias(cats || [])
    setProductos(prods || [])
    if (cats && cats.length) setCategoriaActiva(cats[0].id)
  }

  // --- Suscripción en tiempo real al estado del pedido ---
  useEffect(() => {
    if (fase !== 'seguimiento' || !pedido?.id) return
    const channel = supabase
      .channel(`pedido-${pedido.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `id=eq.${pedido.id}` },
        (payload) => {
          setPedido(payload.new)
          if (['entregado', 'cancelado'].includes(payload.new.estado)) {
            localStorage.removeItem(storageKey(mesa.id))
            setTimeout(async () => {
              if (categorias.length === 0) {
                await cargarMenu(bar.id)
              }
              setFase('menu')
            }, 3000)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fase, pedido?.id, mesa])

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

  async function enviarPedido() {
    if (enviando || totalItems === 0) return
    setEnviando(true)
    try {
      const { data: nuevoPedido, error: pedidoErr } = await supabase
        .from('pedidos')
        .insert({ bar_id: bar.id, mesa_id: mesa.id, estado: 'pendiente', total: totalPrecio })
        .select()
        .single()

      if (pedidoErr) throw pedidoErr

      const items = Object.entries(carrito).map(([prodId, cant]) => {
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
      setPedido(nuevoPedido)
      setCarrito({})
      setFase('seguimiento')
    } catch (e) {
      mostrarToast('No pudimos enviar tu pedido. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
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

  // --- Pantallas ---
  if (fase === 'cargando') {
    return <CenterMsg>Cargando…</CenterMsg>
  }

  if (fase === 'error') {
    return <CenterMsg>{errorMsg}</CenterMsg>
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
                {p.foto_url && <img src={p.foto_url} alt={p.nombre} className="producto-foto" />}
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

          {totalItems > 0 && (
            <div className="barra-carrito" onClick={() => setFase('carrito')}>
              <span>{totalItems} producto{totalItems > 1 ? 's' : ''}</span>
              <span>{money(totalPrecio)}</span>
              <span>Ver pedido →</span>
            </div>
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
        </main>
      )}

      <button className="btn-flotante" onClick={() => setModalSolicitud(true)}>✋ Necesito algo</button>

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

function CenterMsg({ children }) {
  return (
    <div className="center-msg">
      <p>{children}</p>
    </div>
  )
}
