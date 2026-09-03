// Reconoce el tipo de bebida por palabras clave en el nombre del producto,
// para mostrar un ícono representativo cuando el dueño todavía no subió su propia foto.
// A propósito NO son fotos de marcas reales (Águila, Poker, etc.) — eso tiene
// derechos de autor. Son íconos genéricos por tipo de bebida, seguros de usar.

const GRUPOS = [
  { icono: '🍺', claves: ['cerveza', 'aguila', 'águila', 'poker', 'club colombia', 'corona', 'budweiser', 'heineken', 'costeña', 'costena', 'pilsen', 'stella', 'michelob', 'redds', 'red d'] },
  { icono: '🍷', claves: ['vino', 'sangria', 'sangría', 'champaña', 'champagne', 'espumante'] },
  { icono: '🥃', claves: ['whisky', 'whiskey', 'ron', 'aguardiente', 'vodka', 'tequila', 'ginebra', 'gin', 'brandy', 'old fashioned'] },
  { icono: '🍹', claves: ['mojito', 'margarita', 'daiquiri', 'piña colada', 'pina colada', 'cóctel', 'coctel', 'cuba libre', 'sex on the beach', 'cosmopolitan'] },
  { icono: '🍸', claves: ['martini'] },
  { icono: '🥤', claves: ['gaseosa', 'coca cola', 'coca-cola', 'jugo', 'limonada', 'malta', 'refresco', 'soda'] },
  { icono: '💧', claves: ['agua'] },
  { icono: '🧊', claves: ['hielo'] },
  { icono: '🍢', claves: ['picada', 'pasabocas', 'boquita', 'papas', 'alitas', 'salchipapa'] },
]

export function iconoPorNombreProducto(nombre) {
  if (!nombre) return null
  const texto = nombre.toLowerCase()
  for (const grupo of GRUPOS) {
    if (grupo.claves.some((clave) => texto.includes(clave))) return grupo.icono
  }
  return null
}
