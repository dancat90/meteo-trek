// ─────────────────────────────────────────────────────────────────────────
// Temperatura percepita. v2 (17/08/2026): UTCI titolare.
//
// UTCI = polinomio di Broede a 364 termini (js/utci-poly.js, generato e
// validato in meteo-casa contro ladybug-comfort/pythermalcomfort) su
// temperatura media radiante alla Di Napoli (js/radiante.js). Integra
// vento, umidità e radiazione con la fisiologia del modello Fiala: è il
// riferimento moderno, corretto anche nel ramo freddo con vento forte.
//
// Fallback dichiarato: se mancano gli ingressi radiativi del modello,
// si torna alla apparent_temperature di Open-Meteo (Steadman) della v1.
//
// v3 (18/08/2026): fusione prudente col windchill JAG/TI (js/windchill.js).
// La percepita operativa è min(indice termico, windchill) quando il
// windchill esiste (T ≤ 10 °C, vento ≥ 4,8 km/h): non è mai più mite del
// windchill. Fatti numerici che orientano la politica:
// - nel freddo ventoso l'UTCI è quasi sempre PIÙ severo del windchill
//   (riferimento a 0,5 m/s: penalizza il vento circa il doppio della
//   JAG/TI), quindi la fusione di rado cambia il numero UTCI;
// - il windchill governa soprattutto nel ripiego Steadman e nelle
//   giornate serene con vento debole, dove per prudenza il sole non
//   alza la percepita sopra il windchill;
// - oltre 61,2 km/h il polinomio UTCI satura il vento (clamp 17 m/s in
//   utci-poly.js) ma resta comunque più severo del windchill: la
//   saturazione NON attiva la fusione.
// ─────────────────────────────────────────────────────────────────────────

import { stUtci } from './utci-poly.js';
import { mrtDiNapoli, cosszaDaToa } from './radiante.js';
import { windchillC } from './windchill.js';

// UTCI [°C] dai valori orari di un modello, oppure null se mancano gli
// ingressi. giornoAnno serve alla correzione della distanza Terra-Sole.
export function utciDaValori(valori, giornoAnno) {
  const t = valori?.temperature_2m;
  const rh = valori?.relative_humidity_2m;
  const vKmh = valori?.wind_speed_10m;
  if (!Number.isFinite(t) || !Number.isFinite(rh) || !Number.isFinite(vKmh)) return null;
  const cossza = cosszaDaToa(valori.terrestrial_radiation, giornoAnno);
  const mrt = mrtDiNapoli({
    tC: t,
    rh,
    nuvole: valori.cloud_cover,
    ssrd: valori.shortwave_radiation,
    fdir: valori.direct_radiation,
    dsrp: valori.direct_normal_irradiance,
    cossza,
  });
  if (mrt == null) return null;
  // Il vento arriva in km/h (wind_speed_unit=kmh): il polinomio vuole m/s
  return stUtci(t, mrt, vKmh / 3.6, rh);
}

// Percepita titolare: UTCI se calcolabile, altrimenti Steadman
export function percepita(valori, giornoAnno) {
  const u = utciDaValori(valori, giornoAnno);
  if (Number.isFinite(u)) return u;
  const v = valori?.apparent_temperature;
  return Number.isFinite(v) ? v : null;
}

// ── Fusione prudente col windchill ───────────────────────────────────────

// min(indice, windchill) con gestione dei null. `governa` dice quale dei
// due detta il valore: 'windchill' solo se STRETTAMENTE sotto l'indice
// (a parità l'etichetta resta sull'indice).
export function fondiWindchill(indiceC, wcC) {
  const iOk = Number.isFinite(indiceC);
  const wOk = Number.isFinite(wcC);
  if (!iOk && !wOk) return { valore: null, governa: null };
  if (!iOk) return { valore: wcC, governa: 'windchill' };
  if (!wOk) return { valore: indiceC, governa: 'indice' };
  return wcC < indiceC
    ? { valore: wcC, governa: 'windchill' }
    : { valore: indiceC, governa: 'indice' };
}

// Percepita operativa per campione: indice termico fuso col windchill.
// `metro` serve alla fascia multi-modello per applicare a ogni modello lo
// stesso metro del titolare: 'auto' = UTCI se calcolabile poi Steadman,
// 'utci' = solo UTCI (null se mancano i radiativi), 'steadman' = solo
// apparent_temperature. Il vento arriva già eventualmente corretto per
// esposizione: questa funzione non sa nulla della correzione.
export function percepitaOperativa(valori, giornoAnno, { metro = 'auto' } = {}) {
  let indice = null;
  let nomeIndice = null;
  if (metro !== 'steadman') {
    const u = utciDaValori(valori, giornoAnno);
    if (Number.isFinite(u)) {
      indice = u;
      nomeIndice = 'utci';
    }
  }
  if (indice === null && metro !== 'utci') {
    const a = valori?.apparent_temperature;
    if (Number.isFinite(a)) {
      indice = a;
      nomeIndice = 'steadman';
    }
  }
  const wc = windchillC(valori?.temperature_2m, valori?.wind_speed_10m);
  const fusa = fondiWindchill(indice, wc);
  return {
    valore: fusa.valore,
    indice: nomeIndice,
    governa: fusa.governa === 'windchill' ? 'windchill' : nomeIndice,
    indiceC: indice,
    windchillC: wc,
  };
}

export const FONTE_UTCI =
  'UTCI (polinomio Broede su MRT Di Napoli: vento + umidità + sole)';
export const FONTE_STEADMAN =
  'apparent_temperature Open-Meteo (Steadman: vento + umidità + sole)';
// Alias storico (v1), usato come ripiego
export const FONTE_PERCEPITA = FONTE_STEADMAN;
// Fonti della percepita quando il windchill governa il numero mostrato
export const FONTE_WINDCHILL_SU_UTCI =
  "windchill Environment Canada (vince sull'UTCI per prudenza)";
export const FONTE_WINDCHILL_SU_STEADMAN =
  'windchill Environment Canada (vince sulla apparent_temperature per prudenza)';
