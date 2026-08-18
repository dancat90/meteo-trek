// ─────────────────────────────────────────────────────────────────────────
// Geometria della traccia: distanze, interpolazione, quote, campionamento.
// Modulo puro, testabile in Node. Le funzioni di base vengono da
// meteo-rotta (già collaudate); campionamento e quote sono nuovi.
// ─────────────────────────────────────────────────────────────────────────

import { CAMPIONI_MAX, PASSO_CAMPIONE_KM } from './config.js';

const R_TERRA = 6371; // km
const RAD = Math.PI / 180;

export function distanzaKm(a, b) {
  // Formula dell'haversine tra due punti {lat, lon} in gradi
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolaGreatCircle(a, b, f) {
  // Interpolazione sferica (slerp) alla frazione f in [0,1]. Sui segmenti
  // GPX da 10-100 m è indistinguibile dal lineare, ma gestisce già tutti
  // i casi limite (segmenti nulli, coordinate coincidenti).
  const la1 = a.lat * RAD, lo1 = a.lon * RAD;
  const la2 = b.lat * RAD, lo2 = b.lon * RAD;
  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((la2 - la1) / 2) ** 2 +
            Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
        )
      )
    );
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / RAD,
    lon: Math.atan2(y, x) / RAD,
  };
}

// Punto di destinazione su sfera: da p {lat, lon}, distanza distM in
// metri lungo l'azimut in gradi da nord (orario). Serve alle sonde DEM
// dell'esposizione orografica.
export function puntoADistanza(p, distM, azimutGradi) {
  const d = distM / 1000 / R_TERRA; // distanza angolare
  const az = azimutGradi * RAD;
  const la1 = p.lat * RAD;
  const lo1 = p.lon * RAD;
  const sinLa2 =
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(az);
  const la2 = Math.asin(Math.min(1, Math.max(-1, sinLa2)));
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(az) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * sinLa2
    );
  return { lat: la2 / RAD, lon: ((lo2 / RAD + 540) % 360) - 180 };
}

// ── Polilinea ────────────────────────────────────────────────────────────

// Lunghezza totale e distanze cumulate (km) dei vertici di una polilinea
export function lunghezzaPolilinea(vertici) {
  const cum = [0];
  let tot = 0;
  for (let i = 1; i < vertici.length; i++) {
    tot += distanzaKm(vertici[i - 1], vertici[i]);
    cum.push(tot);
  }
  return { tot, cum };
}

// Punto alla distanza progressiva x lungo la polilinea
export function puntoLungoPolilinea(vertici, cum, x) {
  const tot = cum[cum.length - 1];
  if (tot <= 0) return { lat: vertici[0].lat, lon: vertici[0].lon };
  const xc = Math.min(tot, Math.max(0, x));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < xc) i++;
  const lSeg = cum[i] - cum[i - 1];
  const f = lSeg > 0 ? (xc - cum[i - 1]) / lSeg : 0;
  return interpolaGreatCircle(vertici[i - 1], vertici[i], f);
}

// ── Quote ────────────────────────────────────────────────────────────────

// Media mobile centrata sulle quote (finestra dispari): i GPX rumorosi
// gonfiano dislivello e pendenze. I null restano null.
export function lisciaQuote(quote, finestra = 5) {
  const meta = Math.floor(finestra / 2);
  return quote.map((q, i) => {
    if (q === null || q === undefined) return null;
    let somma = 0;
    let n = 0;
    for (let j = i - meta; j <= i + meta; j++) {
      const v = quote[j];
      if (j >= 0 && j < quote.length && v !== null && v !== undefined) {
        somma += v;
        n++;
      }
    }
    return n ? somma / n : null;
  });
}

// Quota interpolata linearmente alla distanza progressiva x. I punti con
// quota null vengono scavalcati cercando i vicini validi.
export function quotaLungoTraccia(punti, cum, x) {
  const tot = cum[cum.length - 1];
  const xc = Math.min(tot, Math.max(0, x));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < xc) i++;
  // Indietro e avanti fino a quote valide
  let a = i - 1;
  while (a > 0 && (punti[a].eleM === null || punti[a].eleM === undefined)) a--;
  let b = i;
  while (b < punti.length - 1 && (punti[b].eleM === null || punti[b].eleM === undefined)) b++;
  const qa = punti[a].eleM;
  const qb = punti[b].eleM;
  if (qa === null || qa === undefined) return qb ?? null;
  if (qb === null || qb === undefined) return qa;
  const l = cum[b] - cum[a];
  const f = l > 0 ? (xc - cum[a]) / l : 0;
  return qa + (qb - qa) * f;
}

// ── Campionamento per il meteo ───────────────────────────────────────────

// Campiona la traccia a passo regolare: passo = clamp(totKm/24, 1, 2) km
// → al massimo ~25 campioni (un solo blocco multi-località per modello).
// Primo e ultimo punto sempre inclusi. Ogni campione porta la quota
// interpolata dalla traccia e la distanza progressiva.
export function campionaTraccia(punti, cum) {
  const tot = cum[cum.length - 1];
  if (tot <= 0) {
    const p = punti[0];
    return [{ lat: p.lat, lon: p.lon, eleM: p.eleM ?? null, dCumKm: 0 }];
  }
  const [passoMin, passoMax] = PASSO_CAMPIONE_KM;
  const passo = Math.min(passoMax, Math.max(passoMin, tot / (CAMPIONI_MAX - 1)));
  const n = Math.min(CAMPIONI_MAX, Math.max(2, Math.floor(tot / passo) + 1));
  const campioni = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * tot;
    const { lat, lon } = puntoLungoPolilinea(punti, cum, x);
    const eleM = quotaLungoTraccia(punti, cum, x);
    campioni.push({
      lat: +lat.toFixed(5),
      lon: +lon.toFixed(5),
      eleM: eleM === null ? null : Math.round(eleM),
      dCumKm: +x.toFixed(2),
    });
  }
  return campioni;
}

// Longitudini "srotolate" per disegnare la polyline senza salti (le tracce
// di trekking non attraversano l'antimeridiano, ma la funzione è gratis)
export function coordinateSrotolate(punti) {
  const uscita = [];
  let precedente = null;
  for (const p of punti) {
    let lon = p.lon;
    if (precedente !== null) {
      while (lon - precedente > 180) lon -= 360;
      while (lon - precedente < -180) lon += 360;
    }
    uscita.push([p.lat, lon]);
    precedente = lon;
  }
  return uscita;
}

// Bounding box dei punti: { latMin, latMax, lonMin, lonMax }
export function bboxPunti(punti) {
  const lats = punti.map((p) => p.lat);
  const lons = punti.map((p) => p.lon);
  return {
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
    lonMin: Math.min(...lons),
    lonMax: Math.max(...lons),
  };
}
