// ─────────────────────────────────────────────────────────────────────────
// Esposizione orografica al vento: euristica geometrica sul DEM, NON CFD.
// Per ogni campione si sondano 8 direzioni di bussola a 3 raggi; da lì un
// fattore moltiplicativo sul vento del modello, per direzione da cui
// soffia:
// - barriera sopravento che domina il punto → RIPARO (fino a fMin);
// - terreno che scende da entrambi i lati → CRESTA (fino a fMax);
// - terreno che scende solo sopravento → PENDIO ESPOSTO (moderato).
// Il profilo a 8 settori dipende solo dal terreno: si precalcola una
// volta per percorso, il fattore si risolve per campione sulla direzione
// oraria del vento (interpolata fra i due settori adiacenti).
// Modulo puro: il DEM arriva come array di quote, niente rete.
// ─────────────────────────────────────────────────────────────────────────

import { puntoADistanza } from './geo.js';
import { ESPOSIZIONE } from './config.js';

const DIREZIONI = 8; // rombi da 45°, 0 = Nord, orario

const sondePerCampione = () => 1 + DIREZIONI * ESPOSIZIONE.raggiM.length;

// Sonde in ordine DETERMINISTICO, condiviso con profiliDaQuote:
// per campione [centro, poi direzione 0..7 × raggio 0..2]
export function puntiSondaEsposizione(campioni) {
  const punti = [];
  for (const c of campioni) {
    punti.push({ lat: c.lat, lon: c.lon });
    for (let di = 0; di < DIREZIONI; di++) {
      for (const r of ESPOSIZIONE.raggiM) {
        punti.push(puntoADistanza(c, r, di * 45));
      }
    }
  }
  return punti;
}

// Profili a 8 settori dai risultati delle sonde. quote: array allineato
// a puntiSondaEsposizione (null sui buchi DEM). Ritorna un profilo
// { f8, classi8 } per campione; null se quote non è un array.
export function profiliDaQuote(campioni, quote) {
  if (!Array.isArray(quote)) return null;
  const per = sondePerCampione();
  const nRaggi = ESPOSIZIONE.raggiM.length;
  const profili = [];
  for (let i = 0; i < campioni.length; i++) {
    const base = i * per;
    // Il centro viene dal DEM: i delta devono essere DEM-contro-DEM (un
    // offset barometrico del GPX avvelenerebbe tutti i confronti).
    // Ripiego su eleM solo se la sonda centrale è nulla.
    let centro = quote[base];
    if (!Number.isFinite(centro)) centro = campioni[i]?.eleM;
    if (!Number.isFinite(centro)) {
      profili.push({ f8: Array(DIREZIONI).fill(1), classi8: Array(DIREZIONI).fill(null) });
      continue;
    }
    // Pendenze normalizzate per direzione: sSu = barriera sopravento,
    // sGiu = terreno che scende; franchigia contro il rumore del DEM
    const sSu = Array(DIREZIONI).fill(null);
    const sGiu = Array(DIREZIONI).fill(null);
    for (let di = 0; di < DIREZIONI; di++) {
      for (let ri = 0; ri < nRaggi; ri++) {
        const q = quote[base + 1 + di * nRaggi + ri];
        if (!Number.isFinite(q)) continue; // buco DEM: il raggio si salta
        const r = ESPOSIZIONE.raggiM[ri];
        const dH = q - centro;
        const vSu = (dH - ESPOSIZIONE.franchigiaM) / r;
        const vGiu = (-dH - ESPOSIZIONE.franchigiaM) / r;
        if (vSu > 0) sSu[di] = sSu[di] === null ? vSu : Math.max(sSu[di], vSu);
        if (vGiu > 0) sGiu[di] = sGiu[di] === null ? vGiu : Math.max(sGiu[di], vGiu);
      }
    }
    const f8 = [];
    const classi8 = [];
    for (let di = 0; di < DIREZIONI; di++) {
      const opp = (di + DIREZIONI / 2) % DIREZIONI;
      let f = 1;
      let classe = null;
      if (sSu[di] !== null) {
        f = 1 - (1 - ESPOSIZIONE.fMin) * Math.min(1, sSu[di] / ESPOSIZIONE.pendRiparo);
        classe = 'riparo';
      } else if (sGiu[di] !== null) {
        if (sGiu[opp] !== null) {
          f =
            1 +
            ESPOSIZIONE.ampCresta *
              Math.min(1, Math.min(sGiu[di], sGiu[opp]) / ESPOSIZIONE.pendCresta);
          classe = 'cresta';
        } else {
          f = 1 + ESPOSIZIONE.ampPendio * Math.min(1, sGiu[di] / ESPOSIZIONE.pendCresta);
          classe = 'pendio';
        }
      }
      f8.push(Math.min(ESPOSIZIONE.fMax, Math.max(ESPOSIZIONE.fMin, f)));
      classi8.push(classe);
    }
    profili.push({ f8, classi8 });
  }
  return profili;
}

// Fattore per la direzione REALE del vento (gradi da cui soffia):
// interpolazione lineare fra i due settori adiacenti, con wrap a 360°.
// La classe è quella del settore dominante.
export function fattoreEsposizione(profilo, gradi) {
  if (!profilo || !Number.isFinite(gradi)) return { fattore: 1, classe: null };
  const g = ((gradi % 360) + 360) % 360;
  const k = Math.floor(g / 45) % DIREZIONI;
  const k2 = (k + 1) % DIREZIONI;
  const t = (g - k * 45) / 45;
  const fattore = profilo.f8[k] * (1 - t) + profilo.f8[k2] * t;
  const classe = t < 0.5 ? profilo.classi8[k] : profilo.classi8[k2];
  return { fattore, classe };
}
