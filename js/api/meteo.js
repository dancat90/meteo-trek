// ─────────────────────────────────────────────────────────────────────────
// Client Open-Meteo (Forecast + Elevation API) per il meteo di superficie
// lungo la traccia. Derivato dal client di meteo-rotta, con tre aggiunte:
// - sanitizzazione dei token `nan` (fuori dominio i modelli regionali
//   rispondono 200 con JSON invalido);
// - parametro elevation per punto (downscaling termico alla quota vera
//   del sentiero) con rilettura della quota cella dalla risposta;
// - una chiamata per modello (campi senza suffisso, niente ambiguità).
// Dati CC-BY 4.0 © Open-Meteo.com.
// ─────────────────────────────────────────────────────────────────────────

import { API } from '../config.js';

const MAX_PUNTI_PER_CHIAMATA = 25;
const MAX_PUNTI_ELEVATION = 100;
const TIMEOUT_MS = 15000;

// ── Helper HTTP ─────────────────────────────────────────────────────────

// I modelli regionali fuori dominio emettono `nan` letterali nel corpo:
// JSON.parse esploderebbe con status 200. Si sanifica sul testo grezzo.
export function parseSanificato(testo) {
  return JSON.parse(testo.replace(/\bnan\b/gi, 'null'));
}

async function fetchJson(url, tentativi = 2) {
  let ultimoErrore = null;
  for (let i = 0; i <= tentativi; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.ok) return parseSanificato(await r.text());
      // 429/5xx: vale la pena riprovare con attesa crescente
      if ((r.status === 429 || r.status >= 500) && i < tentativi) {
        await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
        continue;
      }
      const corpo = await r.text().catch(() => '');
      ultimoErrore = new Error(`Open-Meteo HTTP ${r.status}: ${corpo.slice(0, 200)}`);
      break;
    } catch (e) {
      ultimoErrore = e;
      if (i < tentativi) await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  throw ultimoErrore || new Error('Open-Meteo non raggiungibile');
}

// Normalizzazioni geografiche: una longitudine fuori [-180, 180]
// avvelenerebbe l'intero blocco multi-località (HTTP 400).
export const wrapLon = (lon) =>
  lon >= -180 && lon <= 180 ? lon : ((lon + 540) % 360) - 180;
export const clampLat = (lat) => Math.max(-90, Math.min(90, lat));

// Chiamata multi-località a blocchi: restituisce un array di oggetti
// località nello STESSO ORDINE dei punti (il primo elemento della risposta
// non ha location_id: si usa sempre l'indice, mai quel campo).
async function chiamataMultiLocalita(endpoint, punti, parametri, quote = null) {
  const risultati = [];
  for (let i = 0; i < punti.length; i += MAX_PUNTI_PER_CHIAMATA) {
    const blocco = punti.slice(i, i + MAX_PUNTI_PER_CHIAMATA);
    const query = new URLSearchParams({
      latitude: blocco.map((p) => clampLat(p.lat)).join(','),
      longitude: blocco.map((p) => wrapLon(p.lon)).join(','),
      ...parametri,
    });
    if (quote) {
      query.set('elevation', quote.slice(i, i + MAX_PUNTI_PER_CHIAMATA).join(','));
    }
    const dati = await fetchJson(`${endpoint}?${query.toString()}`);
    const localita = Array.isArray(dati) ? dati : [dati];
    risultati.push(...localita);
  }
  return risultati;
}

// ── Parsing delle serie orarie ──────────────────────────────────────────

// Serie di una variabile: nome suffissato col modello o nome semplice
// (con una chiamata per modello arriva sempre il nome semplice)
export function serie(hourly, nomeVar, modello) {
  return hourly?.[`${nomeVar}_${modello}`] ?? hourly?.[nomeVar] ?? null;
}

// Valore non-null più vicino all'indice (±3 ore): tollera i buchi e i
// null di bordo finestra
export function valoreVicino(serieArr, idx) {
  if (!serieArr) return null;
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const v = serieArr[idx + delta];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// Indice dell'ora di passaggio nella griglia oraria (timezone=UTC).
// Nota semantica Open-Meteo: il valore etichettato H descrive H-1 → H.
export function indiceOrario(times, date) {
  if (!times || !times.length) return 0;
  const t0 = Date.parse(times[0] + 'Z');
  const idx = Math.round((date.getTime() - t0) / 3600000);
  return Math.min(times.length - 1, Math.max(0, idx));
}

// ── Chiamata a un modello sui campioni della traccia ────────────────────
//
// campioni: [{lat, lon, eleM, dCumKm}]; orari: [Date UTC] allineati.
// Restituisce { perCampione: [...], copertura } dove ogni elemento è
// { valori: {nomeVar: valore}, quotaCella, precip15Max } oppure null.

export async function meteoModello({
  campioni,
  orari,
  modello,
  variabili,
  startHour,
  endHour,
  quindici = false,
}) {
  const parametri = {
    models: modello.id,
    hourly: variabili.join(','),
    wind_speed_unit: 'kmh',
    timezone: 'UTC',
    start_hour: startHour,
    end_hour: endHour,
    cell_selection: 'land',
  };
  if (quindici) parametri.minutely_15 = 'precipitation';

  // Downscaling alla quota del sentiero: solo se TUTTI i campioni hanno
  // quota (altrimenti Open-Meteo usa il suo DEM a 90 m, che va benissimo)
  const quote = campioni.every((c) => Number.isFinite(c.eleM))
    ? campioni.map((c) => Math.round(c.eleM))
    : null;

  const localita = await chiamataMultiLocalita(API.openMeteo, campioni, parametri, quote);

  let coperti = 0;
  const perCampione = campioni.map((c, i) => {
    const loc = localita[i];
    const hourly = loc?.hourly;
    if (!hourly || !hourly.time?.length) return null;
    const idx = indiceOrario(hourly.time, orari[i]);
    const valori = {};
    let almenoUno = false;
    for (const v of variabili) {
      const val = valoreVicino(serie(hourly, v, modello.id), idx);
      valori[v] = val;
      if (val !== null) almenoUno = true;
    }
    if (!almenoUno) return null; // località fuori dominio (tutta null)
    coperti++;

    // Dettaglio 15 minuti: massimo mm/15min nella finestra ±30 minuti
    // attorno all'orario di passaggio
    let precip15Max = null;
    const m15 = loc?.minutely_15;
    if (quindici && m15?.time?.length && m15.precipitation) {
      const t0 = Date.parse(m15.time[0] + 'Z');
      if (Number.isFinite(t0)) {
        const idx15 = Math.round((orari[i].getTime() - t0) / 900000);
        for (let d = -2; d <= 2; d++) {
          const v = m15.precipitation[idx15 + d];
          if (v !== null && v !== undefined) {
            precip15Max = precip15Max === null ? v : Math.max(precip15Max, v);
          }
        }
      }
    }

    return {
      valori,
      // La cella può stare a una quota molto diversa dal sentiero: la si
      // rilegge dalla risposta e la UI avvisa oltre soglia
      quotaCella: Number.isFinite(loc.elevation) ? Math.round(loc.elevation) : null,
      precip15Max,
    };
  });

  return { perCampione, copertura: coperti / campioni.length };
}

// ── Serie orarie complete per campione (pianificatore) ──────────────────
//
// A differenza di meteoModello NON collassa le serie al solo orario di
// passaggio: restituisce le serie intere della finestra, che il
// pianificatore ricampiona su ogni orario di partenza candidato.
// Nota: con più di 25 campioni chiamataMultiLocalita spezza in blocchi
// sequenziali e il pianificatore rallenta linearmente (oggi CAMPIONI_MAX
// è 25: un solo blocco).

// Normalizzazione pura di una località: { t0Ms, valori: {var: array} }
// oppure null (fuori dominio: hourly assente o serie tutte null)
export function serieNormalizzate(loc, variabili, modelloId) {
  const hourly = loc?.hourly;
  if (!hourly || !hourly.time?.length) return null;
  const t0Ms = Date.parse(hourly.time[0] + 'Z');
  if (!Number.isFinite(t0Ms)) return null;
  const valori = {};
  let almenoUno = false;
  for (const v of variabili) {
    const arr = serie(hourly, v, modelloId);
    valori[v] = arr;
    if (arr && arr.some((x) => x !== null && x !== undefined)) almenoUno = true;
  }
  return almenoUno ? { t0Ms, valori } : null;
}

export async function meteoSerie({ campioni, modello, variabili, startHour, endHour }) {
  const parametri = {
    models: modello.id,
    hourly: variabili.join(','),
    wind_speed_unit: 'kmh',
    timezone: 'UTC',
    start_hour: startHour,
    end_hour: endHour,
    cell_selection: 'land',
  };
  const quote = campioni.every((c) => Number.isFinite(c.eleM))
    ? campioni.map((c) => Math.round(c.eleM))
    : null;
  const localita = await chiamataMultiLocalita(API.openMeteo, campioni, parametri, quote);
  let coperti = 0;
  const perCampione = campioni.map((c, i) => {
    const s = serieNormalizzate(localita[i], variabili, modello.id);
    if (s) coperti++;
    return s;
  });
  return { perCampione, copertura: coperti / campioni.length };
}

// ── Chiamata unica ai modelli di confronto (fascia multi-modello) ───────
//
// Più modelli in una sola HTTP: la risposta arriva con i campi suffissati
// (`temperature_2m_<id>`) e `serie()` li risolve già. Stesso downscaling
// alla quota sentiero della chiamata principale. Restituisce
// [{ modello, perCampione: [{valori}|null], copertura }] allineato a
// `modelli`, oppure lancia (il chiamante degrada con avviso).

export async function meteoConfronto({
  campioni,
  orari,
  modelli,
  variabili,
  startHour,
  endHour,
}) {
  const parametri = {
    models: modelli.map((m) => m.id).join(','),
    hourly: variabili.join(','),
    timezone: 'UTC',
    start_hour: startHour,
    end_hour: endHour,
    cell_selection: 'land',
  };
  const quote = campioni.every((c) => Number.isFinite(c.eleM))
    ? campioni.map((c) => Math.round(c.eleM))
    : null;

  const localita = await chiamataMultiLocalita(API.openMeteo, campioni, parametri, quote);

  return modelli.map((modello) => {
    let coperti = 0;
    const perCampione = campioni.map((c, i) => {
      const hourly = localita[i]?.hourly;
      if (!hourly || !hourly.time?.length) return null;
      const idx = indiceOrario(hourly.time, orari[i]);
      const valori = {};
      let almenoUno = false;
      for (const v of variabili) {
        const val = valoreVicino(serie(hourly, v, modello.id), idx);
        valori[v] = val;
        if (val !== null) almenoUno = true;
      }
      if (!almenoUno) return null;
      coperti++;
      return { valori };
    });
    return { modello, perCampione, copertura: coperti / campioni.length };
  });
}

// ── Quota reale delle celle di griglia del modello ──────────────────────
// Con `elevation` esplicito la risposta fa ECO del valore inviato
// (verificato live): per conoscere la quota VERA della cella serve una
// chiamata separata con elevation=nan (downscaling disattivato → il campo
// elevation della risposta è l'altezza media della cella). Chiamata
// leggera: una variabile, un giorno. Null in caso di fallimento: l'app
// rinuncia all'avviso di scostamento, senza mostrare dati fittizi.
export async function quoteCelle(campioni, modello) {
  try {
    const localita = await chiamataMultiLocalita(
      API.openMeteo,
      campioni,
      {
        models: modello.id,
        hourly: 'temperature_2m',
        forecast_days: '1',
        timezone: 'UTC',
        cell_selection: 'land',
        elevation: campioni.map(() => 'nan').join(','),
      }
    );
    return campioni.map((_, i) =>
      Number.isFinite(localita[i]?.elevation) ? Math.round(localita[i].elevation) : null
    );
  } catch {
    return null;
  }
}

// ── Fuso orario IANA del punto di partenza ──────────────────────────────
// Micro-chiamata con timezone=auto. Null in caso di fallimento: il
// chiamante degrada a Europe/Rome con avviso.
export async function fusoOrario(punto) {
  try {
    const localita = await chiamataMultiLocalita(API.openMeteo, [punto], {
      hourly: 'temperature_2m',
      forecast_days: '1',
      timezone: 'auto',
    });
    return localita[0]?.timezone || null;
  } catch {
    return null;
  }
}

// ── Elevation API: quote DEM (Copernicus GLO-90) per punti senza <ele> ──
// punti: [{lat, lon}] → array di quote (m) allineato, null sui buchi
export async function quoteDem(punti) {
  const quote = [];
  for (let i = 0; i < punti.length; i += MAX_PUNTI_ELEVATION) {
    const blocco = punti.slice(i, i + MAX_PUNTI_ELEVATION);
    const query = new URLSearchParams({
      latitude: blocco.map((p) => clampLat(p.lat)).join(','),
      longitude: blocco.map((p) => wrapLon(p.lon)).join(','),
    });
    const dati = await fetchJson(`${API.openMeteoElevation}?${query.toString()}`);
    const arr = dati?.elevation || [];
    for (let k = 0; k < blocco.length; k++) {
      quote.push(Number.isFinite(arr[k]) ? arr[k] : null);
    }
  }
  return quote;
}
