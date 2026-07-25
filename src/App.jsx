import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

const ESTADOS = ['pendiente', 'confirmado', 'preparando', 'en_camino', 'entregado']
const MINUTOS_RONDA_INTELIGENTE = 30 // a los cuantos minutos sin pedir se pregunta sola "¿otra ronda?"
const MINUTOS_SNOOZE_RONDA = 15 // si dice "más tarde", cuánto espera antes de volver a preguntar
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
  const [telefonoCliente, setTelefonoCliente] = useState('')
  const [visitasCliente, setVisitasCliente] = useState(0)
  const [mostrarGuardarTel, setMostrarGuardarTel] = useState(false)
  const [promociones, setPromociones] = useState([])
  const [promoVista, setPromoVista] = useState(null)
  const [totalVisita, setTotalVisita] = useState(0)

  const [modalCarrito, setModalCarrito] = useState(false)
  const [modalChat, setModalChat] = useState(false)
  const [mensajesChat, setMensajesChat] = useState([])
  const [textoChat, setTextoChat] = useState('')
  const [hayMensajesNuevos, setHayMensajesNuevos] = useState(false)
  const [cuentaPedidos, setCuentaPedidos] = useState([])
  const [cargandoCuenta, setCargandoCuenta] = useState(false)

  const [toast, setToast] = useState('')
  const [ultimoPedido, setUltimoPedido] = useState(null)
  const [upsell, setUpsell] = useState(null)
  const [calificacion, setCalificacion] = useState(0)
  const [propinaEnviada, setPropinaEnviada] = useState(false)
  const [topProductoId, setTopProductoId] = useState(null)
  const [historialAbierto, setHistorialAbierto] = useState(true)
  const [fotoAmpliada, setFotoAmpliada] = useState(null)
  const [modalDividir, setModalDividir] = useState(false)
  const [mostrarPromptRonda, setMostrarPromptRonda] = useState(false)
  const [snoozeRondaHasta, setSnoozeRondaHasta] = useState(0)
  const [personasDividir, setPersonasDividir] = useState(2)

  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [comprobanteUrl, setComprobanteUrl] = useState(null)
  const [subiendoComprobante, setSubiendoComprobante] = useState(false)

  const mostrarToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  // --- Sistema de zona flotante: mide #capaFlotante y reserva el espacio automáticamente ---
  useEffect(() => {
    const capa = document.getElementById('capaFlotante')
    if (!capa) return
    const raiz = document.documentElement
    function actualizar() {
      raiz.style.setProperty('--alto-zona-flotante', capa.getBoundingClientRect().height + 'px')
    }
    const observer = new ResizeObserver(actualizar)
    observer.observe(capa)
    actualizar()
    return () => observer.disconnect()
  }, [])

  // --- Segunda ronda inteligente: pregunta sola si ya pasó rato sin pedir ---
  useEffect(() => {
    if (!mesa) return
    function revisar() {
      if (pedido || !ultimoPedido) return // ya hay pedido activo, o nunca ha pedido nada — no aplica
      const ultimaEntrega = Number(localStorage.getItem(`ronda_ultima_entrega_${mesa.id}`) || 0)
      if (!ultimaEntrega) return
      const ahora = Date.now()
      if (ahora < snoozeRondaHasta) return
      const minutosPasados = (ahora - ultimaEntrega) / 60000
      if (minutosPasados >= MINUTOS_RONDA_INTELIGENTE) setMostrarPromptRonda(true)
    }
    revisar()
    const intervalo = setInterval(revisar, 60000)
    return () => clearInterval(intervalo)
  }, [mesa, pedido, ultimoPedido, snoozeRondaHasta])

  function posponerRondaInteligente() {
    setMostrarPromptRonda(false)
    setSnoozeRondaHasta(Date.now() + MINUTOS_SNOOZE_RONDA * 60000)
  }

  async function aceptarRondaInteligente() {
    setMostrarPromptRonda(false)
    await repetirPedido()
  }

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
        .select('id, nombre, logo_url, activo, llave_nequi, llave_daviplata, llave_bre_b, propinas_habilitadas, hora_pico_activa')
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

      // --- Fidelización: reconocer al cliente si ya guardó su número antes ---
      const telGuardado = localStorage.getItem(`ronda_tel_${barData.id}`)
      if (telGuardado) {
        setTelefonoCliente(telGuardado)
        const { data: clienteExistente } = await supabase
          .from('clientes_bar').select('id, visitas').eq('bar_id', barData.id).eq('telefono', telGuardado).maybeSingle()
        if (clienteExistente) {
          const nuevasVisitas = clienteExistente.visitas + 1
          await supabase.from('clientes_bar').update({ visitas: nuevasVisitas, ultima_visita: new Date().toISOString() }).eq('id', clienteExistente.id)
          setVisitasCliente(nuevasVisitas)
        }
      } else {
        setTimeout(() => setMostrarGuardarTel(true), 4000)
      }

      // --- Promociones activas del bar ---
      const { data: promosData } = await supabase.from('promociones').select('id, titulo, mensaje').eq('bar_id', barData.id).eq('activa', true).order('created_at', { ascending: false })
      setPromociones(promosData || [])
      if (promosData && promosData.length > 0) setPromoVista(promosData[0])

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
      await refrescarHistorial()
      setFase('listo')
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!mesa) return
    const canal = supabase
      .channel(`chat-mesa-${mesa.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes_chat', filter: `canal=eq.mesa-${mesa.id}` }, (payload) => {
        setMensajesChat((m) => [...m, payload.new])
        if (payload.new.de !== 'cliente') setHayMensajesNuevos(true)
      })
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [mesa])

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

  async function guardarTelefonoCliente() {
    const tel = telefonoCliente.trim()
    if (!tel || !bar) return
    localStorage.setItem(`ronda_tel_${bar.id}`, tel)
    const { data: existente } = await supabase.from('clientes_bar').select('id, visitas').eq('bar_id', bar.id).eq('telefono', tel).maybeSingle()
    if (existente) {
      await supabase.from('clientes_bar').update({ visitas: existente.visitas + 1, ultima_visita: new Date().toISOString() }).eq('id', existente.id)
      setVisitasCliente(existente.visitas + 1)
    } else {
      await supabase.from('clientes_bar').insert({ bar_id: bar.id, telefono: tel, nombre: nombreCliente || null, visitas: 1 })
      setVisitasCliente(1)
    }
    setMostrarGuardarTel(false)
    mostrarToast('¡Listo! La próxima vez te reconocemos 🙌')
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
        setTimeout(() => { setPedido(null); refrescarTotalVisita(); refrescarHistorial() }, 1500)
      }
    }

    const channel = supabase
      .channel(`pedido-${pedido.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `id=eq.${pedido.id}` }, (payload) => {
        setPedido(payload.new)
        manejarCambio(payload.new.estado)
        refrescarTotalVisita()
        refrescarHistorial()
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
      refrescarHistorial()
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
      refrescarHistorial()
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
    setTimeout(() => {
      localStorage.removeItem(storageKey(mesa.id))
      localStorage.setItem(`ronda_ultima_entrega_${mesa.id}`, String(Date.now()))
      setPedido(null)
    }, 1800)
  }

  async function terminarSinPropina() {
    if (calificacion > 0 && pedido) {
      await supabase.from('propinas').insert({ pedido_id: pedido.id, mesero_id: pedido.mesero_id || null, monto: 0, calificacion })
    }
    localStorage.removeItem(storageKey(mesa.id))
    localStorage.setItem(`ronda_ultima_entrega_${mesa.id}`, String(Date.now()))
    setPedido(null)
  }

  async function enviarSolicitud(tipo) {
    setModalSolicitud(false)
    const { error } = await supabase.from('solicitudes').insert({ bar_id: bar.id, mesa_id: mesa.id, tipo })
    mostrarToast(error ? 'No se pudo enviar. Intenta otra vez.' : 'Ya avisamos al mesero 👍')
  }

  async function cargarChat() {
    if (!mesa) return
    const { data } = await supabase.from('mensajes_chat').select('id, de, nombre, texto, created_at').eq('canal', `mesa-${mesa.id}`).order('created_at', { ascending: true })
    setMensajesChat(data || [])
  }

  async function abrirChat() {
    setModalChat(true)
    setHayMensajesNuevos(false)
    await cargarChat()
  }

  async function enviarMensajeChat() {
    if (!textoChat.trim() || !mesa) return
    const texto = textoChat.trim()
    setTextoChat('')
    const { data, error } = await supabase.from('mensajes_chat').insert({
      bar_id: bar.id,
      canal: `mesa-${mesa.id}`,
      de: 'cliente',
      nombre: nombreCliente || 'Cliente',
      texto,
    }).select().single()
    if (error) { mostrarToast('No se pudo enviar el mensaje.'); return }
    setMensajesChat((m) => [...m, data])
  }

  async function refrescarHistorial() {
    if (!mesa) return
    setCargandoCuenta(true)
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

      {visitasCliente > 1 && (
        <div className="banner-fidelidad">🎉 ¡Bienvenido de nuevo! Ya has venido {visitasCliente} veces.</div>
      )}

      {bar?.hora_pico_activa && (
        <div className="banner-hora-pico">🔥 Esta noche está a tope — gracias por tu paciencia, puede tardar un poco más de lo normal.</div>
      )}

      {promoVista && (
        <div className="banner-promo" onClick={() => setPromoVista(null)}>
          <div>
            <div className="banner-promo-titulo">📣 {promoVista.titulo}</div>
            <div className="banner-promo-texto">{promoVista.mensaje}</div>
          </div>
          <span className="banner-promo-cerrar">✕</span>
        </div>
      )}

      <div className="total-visita" onClick={() => { setHistorialAbierto(true); document.querySelector('.historial-titulo')?.scrollIntoView({ behavior: 'smooth' }) }} style={{ cursor: 'pointer' }}>
        <span>Hoy llevas</span>
        <strong>{money(totalVisita)}</strong>
      </div>

      {pedido && (
        <div className={`banner-estado banner-${pedido.estado}`}>
          <div className="banner-icono">{ESTADO_ICONO[pedido.estado] || '🍻'}</div>
          <div className="banner-texto">
            <div className="banner-titulo">{ESTADO_LABEL[pedido.estado] || pedido.estado}</div>
            <div className="banner-total">{money(pedido.total)}</div>
            {pedidoBloqueado && <div className="banner-nota">El mesero ya lo está atendiendo — cuando lo entreguen podrás pedir otra ronda.</div>}
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

      <div className="categorias-wrap">
        <nav className="categorias">
          {categorias.map((c) => (
            <button key={c.id} className={`cat-btn ${categoriaActiva === c.id ? 'activa' : ''}`} onClick={() => setCategoriaActiva(c.id)}>
              {c.icono ? `${c.icono} ` : ''}{c.nombre}
            </button>
          ))}
        </nav>
        {categorias.length > 3 && <div className="fade-derecha" />}
      </div>

      <main className="productos">
        {productosVisibles.map((p) => (
          <div key={p.id} className={`producto-card ${carrito[p.id] > 0 ? 'en-carrito' : ''}`}>
            {p.foto_url ? (
              <img src={p.foto_url} alt={p.nombre} className="producto-foto" onClick={() => setFotoAmpliada(p.foto_url)} />
            ) : (
              <div className="producto-icono">{categorias.find((c) => c.id === p.categoria_id)?.icono || '🍸'}</div>
            )}
            <div className="producto-info">
              <div className="producto-nombre-linea">
                <span className="producto-nombre">{p.nombre}</span>
                {p.id === topProductoId && <span className="producto-badge">🔥 Popular</span>}
              </div>
              <div className="producto-precio">{money(p.precio)}</div>
              {p.producto_sugerido_id && productos.find((x) => x.id === p.producto_sugerido_id) && (
                <div className="producto-combo">+ combina con {productos.find((x) => x.id === p.producto_sugerido_id).nombre}</div>
              )}
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
      </main>

      <div id="capaFlotante">
        <div className="fila-secundarios">
          <button className="btn-flotante-secundario" onClick={abrirChat}>
            💬 {hayMensajesNuevos && <span className="punto-nuevo" />}
          </button>
        </div>
        {totalItems > 0 && !editando && (
          <button className="cta-flotante" onClick={abrirCarritoNuevo}>
            <span>{totalItems} producto{totalItems > 1 ? 's' : ''}</span>
            <span>Revisar y enviar → {money(totalCarrito)}</span>
          </button>
        )}
        {totalItems === 0 && !pedido && ultimoPedido && (
          <button className="cta-flotante" onClick={repetirPedido} disabled={enviando}>
            <span>{enviando ? 'Enviando…' : '🔁 Otra ronda'}</span>
          </button>
        )}
      </div>

      <h2 className="historial-titulo" onClick={() => setHistorialAbierto(!historialAbierto)} style={{ cursor: 'pointer' }}>
        {historialAbierto ? '▾' : '▸'} Tu historial de esta noche
      </h2>
      {historialAbierto && (
        <>
          {cuentaPedidos.length === 0 && <p className="vacio">Aún no has pedido nada. ¡Arranca la noche! 🍻</p>}
          {cuentaPedidos.length > 0 && (
            <div className="historial-lista">
              {cuentaPedidos.map((p, i) => (
                <div key={p.id} className="cuenta-ronda">
                  <div className="cuenta-fila cuenta-fila-titulo">
                    <span>{new Date(p.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} — {p.estado === 'entregado' ? '✔ Entregado' : (ESTADO_LABEL[p.estado] || p.estado)}</span>
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
              <button className="btn-dividir" onClick={() => setModalDividir(true)}>➗ Dividir esta cuenta</button>
            </div>
          )}
        </>
      )}

      {mostrarPromptRonda && (
        <div className="modal-overlay" onClick={posponerRondaInteligente}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🍺 ¿Les traemos otra ronda?</h3>
            <p className="pago-titulo">Lo mismo de la última vez, directo a tu mesa.</p>
            <button className="btn-primario" onClick={aceptarRondaInteligente}>Sí, traigan otra</button>
            <button className="btn-secundario" onClick={posponerRondaInteligente}>Más tarde</button>
          </div>
        </div>
      )}

      {modalDividir && (
        <div className="modal-overlay" onClick={() => setModalDividir(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>➗ Dividir la cuenta</h3>
            <p className="pago-titulo">Total de la mesa: {money(cuentaPedidos.reduce((s, p) => s + Number(p.total), 0))}</p>
            <p className="pago-titulo">¿Entre cuántas personas?</p>
            <div className="pago-metodos">
              {[2, 3, 4, 5, 6].map((n) => (
                <button key={n} className={`pago-btn ${personasDividir === n ? 'activo' : ''}`} onClick={() => setPersonasDividir(n)}>{n}</button>
              ))}
            </div>
            {personasDividir > 0 && (
              <div className="pago-detalle">
                <p className="pago-numero">Cada uno paga: <strong>{money(cuentaPedidos.reduce((s, p) => s + Number(p.total), 0) / personasDividir)}</strong></p>
              </div>
            )}
            <button className="btn-secundario" onClick={() => setModalDividir(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {modalCarrito && (
        <div className="modal-overlay" onClick={() => setModalCarrito(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editando ? 'Editar tu pedido' : 'Tu pedido'}</h3>

            {!nombreCliente && (
              <div className="campo-nombre">
                <label>¿Quién de la mesa está pidiendo?</label>
                <input type="text" value={nombreCliente} onChange={(e) => guardarNombre(e.target.value)} placeholder="Ej: Santiago" maxLength={30} />
              </div>
            )}

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

      {mostrarGuardarTel && (
        <div className="modal-overlay" onClick={() => setMostrarGuardarTel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>💌 ¿Te reconocemos la próxima vez?</h3>
            <p className="ayuda-fidelidad">Guarda tu número y la próxima vez que vengas a {bar?.nombre}, te damos la bienvenida de nuevo. Es opcional.</p>
            <input
              type="tel"
              className="input-telefono"
              value={telefonoCliente}
              onChange={(e) => setTelefonoCliente(e.target.value)}
              placeholder="Tu número de celular"
            />
            <button className="btn-primario" onClick={guardarTelefonoCliente}>Guardar</button>
            <button className="btn-secundario" onClick={() => setMostrarGuardarTel(false)}>Ahora no</button>
          </div>
        </div>
      )}

      {modalChat && (
        <div className="modal-overlay" onClick={() => setModalChat(false)}>
          <div className="modal modal-chat" onClick={(e) => e.stopPropagation()}>
            <h3>✋💬 Habla con tu mesero</h3>
            <div className="contacto-rapido">
              {SOLICITUD_OPCIONES.map((o) => (
                <button key={o.tipo} onClick={() => enviarSolicitud(o.tipo)}>{o.label}</button>
              ))}
            </div>
            <div className="chat-mensajes">
              {mensajesChat.length === 0 && <p className="vacio">O escríbele directamente aquí abajo.</p>}
              {mensajesChat.map((m) => (
                <div key={m.id} className={`chat-burbuja ${m.de === 'cliente' ? 'chat-propia' : 'chat-otra'}`}>
                  <div className="chat-autor">{m.de === 'cliente' ? 'Tú' : (m.nombre || m.de)}</div>
                  {m.texto}
                </div>
              ))}
            </div>
            <div className="chat-entrada">
              <input
                type="text"
                value={textoChat}
                onChange={(e) => setTextoChat(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') enviarMensajeChat() }}
                placeholder="Escribe un mensaje…"
                maxLength={200}
              />
              <button onClick={enviarMensajeChat}>Enviar</button>
            </div>
            <button className="btn-secundario" onClick={() => setModalChat(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {fotoAmpliada && (
        <div className="lightbox-fondo" onClick={() => setFotoAmpliada(null)}>
          <img src={fotoAmpliada} alt="ampliada" className="lightbox-imagen" />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
