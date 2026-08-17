// ─────────────────────────────────────────────────────────────────────────
// Lettura anonima dei tour PUBBLICI Komoot via API v007 (non documentata
// ma stabile e con CORS aperto, verificata il 16/08/2026): tour
// pianificati di un utente (`tours`) e smart tour suggeriti
// (`smart_tours`, verificato il 17/08/2026 — il path dei tour classici
// risponde 406 sugli id smart). Il paywall Komoot colpisce solo
// l'export .gpx: il JSON delle coordinate resta libero.
// Se l'endpoint cambia, l'app degrada all'upload GPX manuale.
// ─────────────────────────────────────────────────────────────────────────

import { API } from '../config.js';

const TIMEOUT_MS = 10000;
const MAX_PAGINE = 4; // 4 × 50 = 200 tour: oltre è un caso irreale

async function fetchJson(url, fetchFn = fetch) {
  const r = await fetchFn(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/hal+json,application/json' },
  });
  if (!r.ok) {
    const err = new Error(`Komoot ha risposto ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// Estrae lo user id da un URL profilo (anche con prefisso lingua tipo
// it-it) o restituisce l'input ripulito se è già un id/username
export function estraiUserId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/komoot\.[a-z.]+\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?user\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  if (/^https?:/i.test(s)) return null; // URL ma non di profilo
  return s;
}

// Estrae id e tipo da un URL tour: komoot.com/tour/123456 (pianificato)
// oppure komoot.com/it-it/smarttour/123456 (smart tour suggerito, che
// vive su un endpoint diverso). Restituisce { id, smart } o null.
export function estraiTour(input) {
  const m = String(input || '').match(/(smarttour|tour)\/(\d+)/i);
  return m ? { id: m[2], smart: m[1].toLowerCase() === 'smarttour' } : null;
}

// Wrapper storico: solo l'id (compatibilità)
export function estraiTourId(input) {
  return estraiTour(input)?.id ?? null;
}

// Base path per tipo di tour
const baseTour = (smart) => (smart ? 'smart_tours' : 'tours');

// Elenco dei tour pianificati pubblici: [{id, nome, km, sport, dPlusM}]
export async function elencaTourPianificati(userId, fetchFn = fetch) {
  const tours = [];
  for (let pagina = 0; pagina < MAX_PAGINE; pagina++) {
    const url =
      `${API.komoot}/users/${encodeURIComponent(userId)}/tours/` +
      `?type=tour_planned&status=public&limit=50&page=${pagina}`;
    const dati = await fetchJson(url, fetchFn);
    const voci = dati?._embedded?.tours || [];
    for (const t of voci) {
      tours.push({
        id: String(t.id),
        nome: t.name || `Tour ${t.id}`,
        km: Number.isFinite(t.distance) ? +(t.distance / 1000).toFixed(1) : null,
        dPlusM: Number.isFinite(t.elevation_up) ? Math.round(t.elevation_up) : null,
        sport: t.sport || null,
      });
    }
    const totPagine = dati?.page?.totalPages ?? dati?.totalPages ?? 1;
    if (pagina + 1 >= totPagine || !voci.length) break;
  }
  return tours;
}

// Coordinate di un tour (pianificato o smart): items [{lat, lng, alt, t}]
export async function coordinateTour(tourId, smart = false, fetchFn = fetch) {
  const dati = await fetchJson(
    `${API.komoot}/${baseTour(smart)}/${tourId}/coordinates`,
    fetchFn
  );
  const items = dati?.items || dati?._embedded?.items || [];
  if (!items.length) throw new Error('Tour senza coordinate (è pubblico?)');
  return items;
}

// Nome e metadati di un singolo tour (per l'etichetta quando l'utente
// incolla direttamente il link di un tour)
export async function dettagliTour(tourId, smart = false, fetchFn = fetch) {
  const t = await fetchJson(`${API.komoot}/${baseTour(smart)}/${tourId}`, fetchFn);
  return {
    id: String(t.id ?? tourId),
    nome: t.name || `Tour ${tourId}`,
    km: Number.isFinite(t.distance) ? +(t.distance / 1000).toFixed(1) : null,
    dPlusM: Number.isFinite(t.elevation_up) ? Math.round(t.elevation_up) : null,
    sport: t.sport || null,
  };
}
