// ─────────────────────────────────────────────────────────────────────────
// Scorciatoia Outdooractive: da un link pubblico incollato dall'utente
// scarica il GPX anonimo (endpoint verificato il 16/08/2026, CORS aperto).
// Il download parte SOLO su azione esplicita dell'utente, mai in
// automatico: robots.txt del sito lo vieta ai crawler e l'app non è un
// crawler, ma il volume resta comunque minimo per scelta.
// Se il server nega (403/captcha), la UI rimanda all'export GPX manuale.
// ─────────────────────────────────────────────────────────────────────────

import { API } from '../config.js';

const TIMEOUT_MS = 12000;

// Prima sequenza di 6+ cifre nell'URL: è l'id del contenuto
export function estraiIdOa(input) {
  const m = String(input || '').match(/(\d{6,})/);
  return m ? m[1] : null;
}

export async function scaricaGpxOa(idOUrl, fetchFn = fetch) {
  const id = /^\d+$/.test(String(idOUrl)) ? String(idOUrl) : estraiIdOa(idOUrl);
  if (!id) throw new Error('Nel link non c’è un id Outdooractive riconoscibile');
  const url = `${API.outdooractiveGpx}?i=${id}&project=outdooractive`;
  const r = await fetchFn(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/gpx+xml,application/xml,text/xml' },
  });
  if (!r.ok) {
    const err = new Error(
      `Outdooractive ha risposto ${r.status}: scarica il GPX dal sito e caricalo qui`
    );
    err.status = r.status;
    throw err;
  }
  const testo = await r.text();
  if (!testo.includes('<gpx')) {
    throw new Error('La risposta non è un GPX: il percorso è privato o rimosso');
  }
  return testo;
}
