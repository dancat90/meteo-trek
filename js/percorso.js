// ─────────────────────────────────────────────────────────────────────────
// Modello interno unificato del percorso, qualunque sia la sorgente
// (GPX, Komoot, Outdooractive):
//   { nome, fonte, punti: [{lat, lon, eleM|null, dCumKm}],
//     cum, totKm, dPlusM, dMinusM, serveElevation }
// Modulo puro, testabile in Node.
// ─────────────────────────────────────────────────────────────────────────

import { lunghezzaPolilinea, lisciaQuote } from './geo.js';
import { parseGpx } from './gpx.js';

// Oltre questo numero di trackpoint la traccia viene decimata (le tracce
// registrate arrivano a decine di migliaia di punti: inutili per ETA e
// meteo, pesanti per la mappa)
const MAX_PUNTI = 2400;

function decima(punti) {
  if (punti.length <= MAX_PUNTI) return punti;
  const passo = Math.ceil(punti.length / MAX_PUNTI);
  const uscita = [];
  for (let i = 0; i < punti.length; i += passo) uscita.push(punti[i]);
  if (uscita[uscita.length - 1] !== punti[punti.length - 1]) {
    uscita.push(punti[punti.length - 1]);
  }
  return uscita;
}

// Costruisce il modello a partire dai punti grezzi {lat, lon, eleM|null}
export function costruisciPercorso({ nome, fonte, punti }) {
  const validi = punti.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (validi.length < 2) {
    throw new Error('Percorso con meno di due punti validi');
  }
  const ridotti = decima(validi);
  const { tot, cum } = lunghezzaPolilinea(ridotti);

  // Quote lisciate per dislivelli e pendenze (i GPX rumorosi li gonfiano)
  const quote = lisciaQuote(ridotti.map((p) => p.eleM ?? null));
  let dPlus = 0;
  let dMinus = 0;
  for (let i = 1; i < quote.length; i++) {
    if (quote[i] === null || quote[i - 1] === null) continue;
    const dz = quote[i] - quote[i - 1];
    if (dz > 0) dPlus += dz;
    else dMinus -= dz;
  }

  const senzaQuota = quote.filter((q) => q === null).length;
  const puntiFinali = ridotti.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    eleM: quote[i] === null ? null : +quote[i].toFixed(1),
    dCumKm: +cum[i].toFixed(3),
  }));

  return {
    nome: nome || null,
    fonte: fonte || 'gpx',
    punti: puntiFinali,
    cum,
    totKm: +tot.toFixed(2),
    dPlusM: Math.round(dPlus),
    dMinusM: Math.round(dMinus),
    serveElevation: senzaQuota / puntiFinali.length > 0.2,
  };
}

// Da testo GPX (upload manuale o download Outdooractive)
export function percorsoDaGpx(testo, { nomeFallback = null, fonte = 'gpx' } = {}) {
  const { nome, punti } = parseGpx(testo);
  return costruisciPercorso({ nome: nome || nomeFallback, fonte, punti });
}

// Dal JSON coordinate di Komoot: items [{lat, lng, alt, t}]
export function percorsoDaKomoot(items, { nome = null } = {}) {
  if (!Array.isArray(items)) throw new Error('Coordinate Komoot non valide');
  const punti = items
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({
      lat: p.lat,
      lon: p.lng,
      eleM: Number.isFinite(p.alt) ? p.alt : null,
    }));
  return costruisciPercorso({ nome, fonte: 'komoot', punti });
}

// Campioni per la ricostruzione delle quote dal DEM (GPX senza <ele>):
// un punto ogni ~200 m, max 300 campioni (3 batch della Elevation API)
export function campioniPerQuota(percorso, passoKm = 0.2) {
  const n = Math.min(300, Math.max(2, Math.floor(percorso.totKm / passoKm) + 1));
  const indici = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * percorso.totKm;
    // Indice del trackpoint più vicino alla distanza x
    let j = 0;
    while (j < percorso.cum.length - 1 && percorso.cum[j] < x) j++;
    if (!indici.includes(j)) indici.push(j);
  }
  return indici.map((j) => ({
    idx: j,
    lat: percorso.punti[j].lat,
    lon: percorso.punti[j].lon,
    dCumKm: percorso.punti[j].dCumKm,
  }));
}

// Applica le quote DEM ricevute per i campioni {idx, eleM} e ricostruisce
// il percorso con le quote interpolate linearmente su tutti i punti
export function applicaQuote(percorso, campioniQuota) {
  const validi = campioniQuota
    .filter((c) => Number.isFinite(c.eleM))
    .sort((a, b) => a.idx - b.idx);
  if (validi.length < 2) return percorso;
  const punti = percorso.punti.map((p, i) => {
    // Coppia di campioni che racchiude l'indice i
    let a = validi[0];
    let b = validi[validi.length - 1];
    for (let k = 0; k < validi.length - 1; k++) {
      if (validi[k].idx <= i && validi[k + 1].idx >= i) {
        a = validi[k];
        b = validi[k + 1];
        break;
      }
    }
    const l = percorso.cum[b.idx] - percorso.cum[a.idx];
    const f = l > 0 ? (percorso.cum[i] - percorso.cum[a.idx]) / l : 0;
    const ele = a.eleM + (b.eleM - a.eleM) * Math.min(1, Math.max(0, f));
    return { ...p, eleM: +ele.toFixed(1) };
  });
  return costruisciPercorso({
    nome: percorso.nome,
    fonte: percorso.fonte,
    punti,
  });
}

// Punto di quota massima del percorso (per la sosta «in vetta»): primo
// punto col massimo in caso di plateau, punti senza quota saltati (dopo
// un DEM parzialmente fallito le quote possono essere miste). Null se
// nessun punto ha una quota.
export function kmQuotaMassima(percorso) {
  let migliore = null;
  for (let i = 0; i < percorso.punti.length; i++) {
    const p = percorso.punti[i];
    if (!Number.isFinite(p.eleM)) continue;
    if (!migliore || p.eleM > migliore.eleM) {
      migliore = { dKm: p.dCumKm, eleM: p.eleM, idx: i };
    }
  }
  return migliore;
}
