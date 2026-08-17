// ─────────────────────────────────────────────────────────────────────────
// Copertura nuvolosa e quota della base delle nubi. Modulo puro.
//
// Base nuvolosa: il valore nativo del modello quando esiste (variabile
// cloud_base, oggi solo MeteoSwiss ICON-CH2 — quota sul livello del
// mare, VERIFICATO empiricamente: celle adiacenti a 272 e 1946 m danno
// la stessa base). Altrove stima LCL (livello di condensazione):
// ~125 m di risalita per ogni grado di scarto fra temperatura e punto
// di rugiada, sopra la quota del sentiero. La stima è buona per nubi
// convettive, indicativa per quelle stratificate: dichiarata in UI.
// ─────────────────────────────────────────────────────────────────────────

import {
  SOGLIE_SOLE,
  ETICHETTE_SOLE,
  SOGLIE_VISIBILITA_KM,
  ETICHETTE_VISIBILITA,
} from './config.js';

// Piano di nubi dominante: 'basse' | 'medie' | 'alte', null se il cielo
// è quasi sereno (<30% totale) o i piani mancano. In pareggio vince il
// piano più basso (lettura prudente per chi cammina).
export function tipologiaNubi({ basse, medie, alte, totale }) {
  if (!Number.isFinite(totale) || totale < 30) return null;
  if (![basse, medie, alte].every(Number.isFinite)) return null;
  if (basse >= medie && basse >= alte) return 'basse';
  if (medie >= alte) return 'medie';
  return 'alte';
}

// Classe di visibilità dai metri previsti (fonte tipica: GFS)
export function classificaVisibilita(metri) {
  if (!Number.isFinite(metri) || metri < 0) return null;
  const km = metri / 1000;
  let livello = 0;
  while (livello < SOGLIE_VISIBILITA_KM.length && km >= SOGLIE_VISIBILITA_KM[livello]) livello++;
  return { km, livello, etichetta: ETICHETTE_VISIBILITA[livello] };
}

// Intensità solare qualitativa dalla radiazione globale al suolo:
// il filtro delle nubi è già dentro il valore previsto dal modello
export function intensitaSolare(wm2) {
  if (!Number.isFinite(wm2)) return null;
  let livello = 0;
  while (livello < SOGLIE_SOLE.length && wm2 >= SOGLIE_SOLE[livello]) livello++;
  return { livello, etichetta: ETICHETTE_SOLE[livello] };
}

// Punto di rugiada [°C] da temperatura e umidità relativa (Magnus)
export function puntoRugiada(tC, rh) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh) || rh <= 0) return null;
  const g = Math.log(Math.min(100, rh) / 100) + (17.625 * tC) / (243.04 + tC);
  return (243.04 * g) / (17.625 - g);
}

// Base nuvolosa in metri sul livello del mare, oppure null con cielo
// quasi sereno (base senza senso) o ingressi mancanti.
// Restituisce { baseM, stima } — stima=true quando è LCL, non modello.
// La stima LCL descrive solo le nubi BASSE: con nubi basse scarse
// (bassePct < 30) il numero non corrisponde a nessuna nube reale
// (es. velo di cirri a 8000 m con LCL a 2450 m) e viene soppresso.
// Il valore del modello (base reale dello strato più basso presente)
// resta sempre visibile.
export function baseNuvolosa({ baseModelloM, tC, rh, quotaM, coperturaPct, bassePct }) {
  if (!Number.isFinite(coperturaPct) || coperturaPct < 10) return null;
  if (Number.isFinite(baseModelloM) && baseModelloM > 0) {
    return { baseM: Math.round(baseModelloM), stima: false };
  }
  if (Number.isFinite(bassePct) && bassePct < 30) return null;
  const td = puntoRugiada(tC, rh);
  if (td === null || !Number.isFinite(quotaM)) return null;
  return { baseM: Math.round(quotaM + 125 * Math.max(0, tC - td)), stima: true };
}
