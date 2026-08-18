// ─────────────────────────────────────────────────────────────────────────
// Quote DEM con cache persistente. Il terreno è statico: le quote già
// scaricate si riusano per sempre (chiave lat,lon arrotondata alla cella
// GLO-90). I miss vanno alla Elevation API in blocchi da 100 con un
// piccolo pool di concorrenza (quoteDem da solo è sequenziale).
// ─────────────────────────────────────────────────────────────────────────

import { leggi, scrivi } from '../storage.js';
import { quoteDem } from './meteo.js';
import { DEM_CACHE } from '../config.js';

const CHIAVE_STORAGE = 'mt:dem';
const PUNTI_PER_BLOCCO = 100; // = MAX_PUNTI_ELEVATION di api/meteo.js
const CONCORRENZA = 3; // pool: rispetta il rate limit free di Open-Meteo

export const chiaveDem = (lat, lon) =>
  `${lat.toFixed(DEM_CACHE.decimali)},${lon.toFixed(DEM_CACHE.decimali)}`;

function cacheLeggi() {
  const c = leggi(CHIAVE_STORAGE, null);
  return c && c.v === 1 && c.quote && Array.isArray(c.ordine)
    ? c
    : { v: 1, ordine: [], quote: {} };
}

// Inserisce coppie [chiave, quotaIntera] con eviction FIFO oltre il tetto.
// Esportata per i test; la scrittura inghiotte la quota piena (storage.js).
export function cacheDemAggiorna(coppie) {
  const c = cacheLeggi();
  for (const [k, q] of coppie) {
    if (!(k in c.quote)) c.ordine.push(k);
    c.quote[k] = q;
  }
  const eccesso = c.ordine.length - DEM_CACHE.maxVoci;
  if (eccesso > 0) {
    for (const k of c.ordine.splice(0, eccesso)) delete c.quote[k];
  }
  scrivi(CHIAVE_STORAGE, c);
  return c;
}

// Come quoteDem (array di quote allineato ai punti, null sui buchi), ma
// con cache: due previsioni sullo stesso percorso non riscaricano nulla
export async function quoteDemCached(punti) {
  const cache = cacheLeggi();
  const risultato = new Array(punti.length).fill(null);
  const miss = new Map(); // chiave → indici dei punti che la condividono
  punti.forEach((p, i) => {
    const k = chiaveDem(p.lat, p.lon);
    if (k in cache.quote) {
      risultato[i] = cache.quote[k];
    } else {
      if (!miss.has(k)) miss.set(k, []);
      miss.get(k).push(i);
    }
  });
  const chiaviMiss = [...miss.keys()];
  if (!chiaviMiss.length) return risultato;

  // Un punto rappresentante per cella mancante
  const puntiMiss = chiaviMiss.map((k) => {
    const i = miss.get(k)[0];
    return { lat: punti[i].lat, lon: punti[i].lon };
  });
  const blocchi = [];
  for (let i = 0; i < puntiMiss.length; i += PUNTI_PER_BLOCCO) {
    blocchi.push([i, puntiMiss.slice(i, i + PUNTI_PER_BLOCCO)]);
  }
  const quoteMiss = new Array(puntiMiss.length).fill(null);
  let prossimo = 0;
  const lavoratore = async () => {
    while (prossimo < blocchi.length) {
      const [base, blocco] = blocchi[prossimo++];
      const q = await quoteDem(blocco);
      for (let k = 0; k < blocco.length; k++) quoteMiss[base + k] = q[k];
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCORRENZA, blocchi.length) }, lavoratore)
  );

  const coppie = [];
  chiaviMiss.forEach((k, j) => {
    const q = quoteMiss[j];
    const qInt = Number.isFinite(q) ? Math.round(q) : null;
    for (const i of miss.get(k)) risultato[i] = qInt;
    if (qInt !== null) coppie.push([k, qInt]);
  });
  if (coppie.length) cacheDemAggiorna(coppie);
  return risultato;
}
