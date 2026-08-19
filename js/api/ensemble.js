// ─────────────────────────────────────────────────────────────────────────
// Open-Meteo Ensemble API: probabilità di precipitazione "k su N" e
// forbice delle quantità dai membri dell'ensemble, più lo spread di
// temperatura per l'affidabilità.
//
// Perché: la precipitation_probability della Forecast API è null sui
// deterministici regionali (ICON-2I, AROME) e comunque la dispersione fra
// modelli è enorme (14% contro 73% nella stessa ora, misurato): la
// seconda voce k/N con soglia anti-drizzle rende l'incertezza visibile.
// ─────────────────────────────────────────────────────────────────────────

import { API, MODELLI_ENSEMBLE, SOGLIA_DRIZZLE_MM } from '../config.js';
import { valoreVicino, indiceOrario, wrapLon, clampLat } from './meteo.js';

const TIMEOUT_MS = 15000;
const MAX_PUNTI_PER_CHIAMATA = 25;

function parseSanificato(testo) {
  return JSON.parse(testo.replace(/\bnan\b/gi, 'null'));
}

function percentile(ordinati, p) {
  if (!ordinati.length) return null;
  const i = Math.min(
    ordinati.length - 1,
    Math.max(0, Math.round((p / 100) * (ordinati.length - 1)))
  );
  return ordinati[i];
}

// campioni: [{lat, lon}]; orari: [Date UTC] allineati.
// Restituisce { modello, perCampione: [{n, popKN, mmMediana, mmMin, mmMax,
// sigmaTemp}] } oppure null (l'app degrada senza seconda voce).
export async function ensemblePrecipitazione({ campioni, orari, startHour, endHour }) {
  for (const modello of MODELLI_ENSEMBLE) {
    try {
      const perCampione = await unEnsemble(modello, campioni, orari, startHour, endHour);
      if (perCampione) return { modello, perCampione };
    } catch {
      // si passa al modello ensemble successivo
    }
  }
  return null;
}

// PoP k/N per ORA (non al solo passaggio): per il pianificatore in area
// ICON-2I. hourly: solo precipitation. Restituisce { modello,
// perCampione: [{t0Ms, popKN: number[]} | null] } oppure null.
export async function ensemblePopSerie({ campioni, startHour, endHour }) {
  for (const modello of MODELLI_ENSEMBLE) {
    try {
      const perCampione = await unEnsemblePopSerie(modello, campioni, startHour, endHour);
      if (perCampione) return { modello, perCampione };
    } catch {
      // si passa al modello ensemble successivo
    }
  }
  return null;
}

async function unEnsemblePopSerie(modello, campioni, startHour, endHour) {
  const localita = [];
  for (let i = 0; i < campioni.length; i += MAX_PUNTI_PER_CHIAMATA) {
    const blocco = campioni.slice(i, i + MAX_PUNTI_PER_CHIAMATA);
    const query = new URLSearchParams({
      latitude: blocco.map((p) => clampLat(p.lat)).join(','),
      longitude: blocco.map((p) => wrapLon(p.lon)).join(','),
      models: modello,
      hourly: 'precipitation',
      timezone: 'UTC',
      start_hour: startHour,
      end_hour: endHour,
    });
    const r = await fetch(`${API.openMeteoEnsemble}?${query.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const dati = parseSanificato(await r.text());
    localita.push(...(Array.isArray(dati) ? dati : [dati]));
  }

  let validi = 0;
  const perCampione = campioni.map((c, i) => {
    const hourly = localita[i]?.hourly;
    if (!hourly?.time?.length) return null;
    const t0Ms = Date.parse(hourly.time[0] + 'Z');
    if (!Number.isFinite(t0Ms)) return null;
    // Colonne membro: k/N calcolato colonna per colonna, stessa soglia
    // anti-drizzle della voce puntuale
    const membri = Object.keys(hourly).filter((k) => k.startsWith('precipitation'));
    if (membri.length < 3) return null;
    const nOre = hourly.time.length;
    const popKN = new Array(nOre).fill(null);
    for (let h = 0; h < nOre; h++) {
      let n = 0;
      let sopra = 0;
      for (const m of membri) {
        const v = hourly[m]?.[h];
        if (v === null || v === undefined) continue;
        n++;
        if (v >= SOGLIA_DRIZZLE_MM) sopra++;
      }
      if (n >= 3) popKN[h] = Math.round((100 * sopra) / n);
    }
    validi++;
    return { t0Ms, popKN };
  });

  return validi / campioni.length >= 0.5 ? perCampione : null;
}

async function unEnsemble(modello, campioni, orari, startHour, endHour) {
  const localita = [];
  for (let i = 0; i < campioni.length; i += MAX_PUNTI_PER_CHIAMATA) {
    const blocco = campioni.slice(i, i + MAX_PUNTI_PER_CHIAMATA);
    const query = new URLSearchParams({
      latitude: blocco.map((p) => clampLat(p.lat)).join(','),
      longitude: blocco.map((p) => wrapLon(p.lon)).join(','),
      models: modello,
      hourly: 'precipitation,temperature_2m',
      timezone: 'UTC',
      start_hour: startHour,
      end_hour: endHour,
    });
    const r = await fetch(`${API.openMeteoEnsemble}?${query.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const dati = parseSanificato(await r.text());
    localita.push(...(Array.isArray(dati) ? dati : [dati]));
  }

  let validi = 0;
  const perCampione = campioni.map((c, i) => {
    const hourly = localita[i]?.hourly;
    if (!hourly?.time?.length) return null;
    const idx = indiceOrario(hourly.time, orari[i]);

    // Colonne membro: "precipitation_member01", ...; il controllo può
    // comparire senza suffisso. Stessa logica per la temperatura.
    const mm = [];
    const temp = [];
    for (const chiave of Object.keys(hourly)) {
      if (chiave.startsWith('precipitation')) {
        const v = valoreVicino(hourly[chiave], idx);
        if (v !== null) mm.push(v);
      } else if (chiave.startsWith('temperature_2m')) {
        const v = valoreVicino(hourly[chiave], idx);
        if (v !== null) temp.push(v);
      }
    }
    if (mm.length < 3) return null;
    validi++;

    const sopra = mm.filter((v) => v >= SOGLIA_DRIZZLE_MM).length;
    const ordinati = [...mm].sort((a, b) => a - b);
    const usaPercentili = mm.length >= 30;

    let sigmaTemp = null;
    if (temp.length >= 3) {
      const media = temp.reduce((s, v) => s + v, 0) / temp.length;
      sigmaTemp = Math.sqrt(
        temp.reduce((s, v) => s + (v - media) ** 2, 0) / temp.length
      );
    }

    return {
      n: mm.length,
      popKN: Math.round((100 * sopra) / mm.length),
      mmMediana: +percentile(ordinati, 50).toFixed(1),
      mmMin: +(usaPercentili ? percentile(ordinati, 10) : ordinati[0]).toFixed(1),
      mmMax: +(usaPercentili
        ? percentile(ordinati, 90)
        : ordinati[ordinati.length - 1]
      ).toFixed(1),
      sigmaTemp,
    };
  });

  // Ensemble fuori dominio o rotto: inutile tenerlo
  return validi / campioni.length >= 0.5 ? perCampione : null;
}
