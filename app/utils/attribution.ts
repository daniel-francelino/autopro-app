import { buildTouch, hasSignal, type Attribution, type Touch } from '../../lib/analytics/attribution'

// Atribuição de origem no navegador: first touch e last touch por 90 dias em localStorage.
// Só utm_* saneados e o host do referrer. Remove os utm_* da URL depois de ler.

const STORAGE_KEY = 'autopro.attribution'
const TTL_MS = 90 * 24 * 60 * 60 * 1000

interface Stored {
  first?: Touch & { at: number }
  last?: Touch & { at: number }
}

function readStored(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Stored
    const now = Date.now()
    return {
      first: parsed.first && now - parsed.first.at < TTL_MS ? parsed.first : undefined,
      last: parsed.last && now - parsed.last.at < TTL_MS ? parsed.last : undefined
    }
  } catch {
    return {}
  }
}

function stripUtm(search: URLSearchParams) {
  let changed = false
  for (const key of [...search.keys()]) {
    if (key.startsWith('utm_')) {
      search.delete(key)
      changed = true
    }
  }
  if (!changed) return
  const query = search.toString()
  const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
  history.replaceState(history.state, '', url)
}

/** Lê UTM/referrer da visita atual, atualiza first/last touch e devolve a atribuição para enviar. */
export function captureAttribution(ownHosts: readonly string[]): Attribution | undefined {
  try {
    const search = new URLSearchParams(location.search)
    const current = buildTouch(search, document.referrer, ownHosts)
    const stored = readStored()
    const now = Date.now()

    const next: Stored = { ...stored }
    if (hasSignal(current)) {
      next.last = { ...current, at: now }
      if (!next.first) next.first = { ...current, at: now }
    }
    if (!next.first) next.first = { ...current, at: now }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    stripUtm(search)

    const { at: _firstAt, ...first } = next.first
    const last = next.last ? (({ at: _lastAt, ...touch }) => touch)(next.last) : current
    return { first, last }
  } catch {
    return undefined
  }
}

/** Atribuição atual salva (sem alterar nada), para o início do checkout. */
export function readAttribution(): Attribution | undefined {
  try {
    const { first, last } = readStored()
    if (!first && !last) return undefined
    const strip = (touch?: Touch & { at: number }) => touch ? (({ at: _at, ...rest }) => rest)(touch) : undefined
    return { ...(first ? { first: strip(first) } : {}), ...(last ? { last: strip(last) } : {}) } as Attribution
  } catch {
    return undefined
  }
}
