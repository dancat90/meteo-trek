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
// Il windchill puro NON sta qui: è un indice separato (js/windchill.js)
// mostrato nel dettaglio nei casi invernali.
// ─────────────────────────────────────────────────────────────────────────

import { stUtci } from './utci-poly.js';
import { mrtDiNapoli, cosszaDaToa } from './radiante.js';

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

export const FONTE_UTCI =
  'UTCI (polinomio Broede su MRT Di Napoli: vento + umidità + sole)';
export const FONTE_STEADMAN =
  'apparent_temperature Open-Meteo (Steadman: vento + umidità + sole)';
// Alias storico (v1), usato come ripiego
export const FONTE_PERCEPITA = FONTE_STEADMAN;
