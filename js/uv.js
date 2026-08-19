// ─────────────────────────────────────────────────────────────────────────
// Indice UV: correzione per quota e neve + classificazione OMS a 5 fasce.
// Modulo puro: nessun accesso al DOM, importabile da Node per i test.
// L'UV di Open-Meteo è null su tutti i primari regionali (verificato
// 08/2026): arriva dal ponte GFS della chiamata di confronto, riferito
// alla quota della cella del modello. La correzione di quota si applica
// quindi sul DELTA sentiero−cella, mai sulla quota assoluta.
// ─────────────────────────────────────────────────────────────────────────

import { UV_SCALA, UV_CORREZIONE } from './config.js';

// uvGrezzo: indice UV del modello (alla quota della cella).
// ctx: { quotaSentieroM, quotaCellaM, nevePrevista }.
// Ritorna { uv, fattoreQuota, fattoreNeve, deltaM } oppure null.
export function correggiUv(uvGrezzo, { quotaSentieroM, quotaCellaM, nevePrevista = false } = {}) {
  if (!Number.isFinite(uvGrezzo) || uvGrezzo < 0) return null;
  // Senza quota della cella la correzione si RINUNCIA, non si inventa
  const deltaM =
    Number.isFinite(quotaSentieroM) && Number.isFinite(quotaCellaM)
      ? quotaSentieroM - quotaCellaM
      : 0;
  let fattoreQuota = 1 + (UV_CORREZIONE.pctPer1000m / 100) * (deltaM / 1000);
  const [fMin, fMax] = UV_CORREZIONE.clampFattore;
  fattoreQuota = Math.min(fMax, Math.max(fMin, fattoreQuota));
  const fattoreNeve = nevePrevista ? UV_CORREZIONE.fattoreNeve : 1;
  const uv = Math.max(0, Math.round(uvGrezzo * fattoreQuota * fattoreNeve * 10) / 10);
  return { uv, fattoreQuota, fattoreNeve, deltaM };
}

// uv → { fascia: 0-4, etichetta, colore } secondo la scala OMS, o null
export function classificaUv(uv) {
  if (!Number.isFinite(uv) || uv < 0) return null;
  let fascia = 0;
  for (let i = 0; i < UV_SCALA.soglie.length; i++) {
    if (uv >= UV_SCALA.soglie[i]) fascia = i + 1;
  }
  return { fascia, etichetta: UV_SCALA.etichette[fascia], colore: UV_SCALA.colori[fascia] };
}
