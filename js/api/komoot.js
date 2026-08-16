// ─────────────────────────────────────────────────────────────────────────
// Lettura anonima dei tour pianificati PUBBLICI di un utente Komoot via
// API v007 (non documentata ma stabile e con CORS aperto, verificata
// il 16/08/2026). Il paywall Komoot colpisce solo l'export .gpx: il JSON
// delle coordinate resta libero per i tour pubblici.
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

// Estrae l'id tour da un URL komoot.com/tour/123456 (o smart tour link)
export function estraiTourId(input) {
  const m = String(input || '').match(/tour\/(\d+)/);
  return m ? m[1] : null;
}

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

// Coordinate di un tour: items [{lat, lng, alt, t}]
export async function coordinateTour(tourId, fetchFn = fetch) {
  const dati = await fetchJson(`${API.komoot}/tours/${tourId}/coordinates`, fetchFn);
  const items = dati?.items || dati?._embedded?.items || [];
  if (!items.length) throw new Error('Tour senza coordinate (è pubblico?)');
  return items;
}

// Nome e metadati di un singolo tour (per l'etichetta quando l'utente
// incolla direttamente il link di un tour)
export async function dettagliTour(tourId, fetchFn = fetch) {
  const t = await fetchJson(`${API.komoot}/tours/${tourId}`, fetchFn);
  return {
    id: String(t.id ?? tourId),
    nome: t.name || `Tour ${tourId}`,
    km: Number.isFinite(t.distance) ? +(t.distance / 1000).toFixed(1) : null,
    dPlusM: Number.isFinite(t.elevation_up) ? Math.round(t.elevation_up) : null,
    sport: t.sport || null,
  };
}
