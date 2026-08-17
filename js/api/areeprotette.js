// ─────────────────────────────────────────────────────────────────────────
// Aree protette attraversate dal percorso (parchi, riserve) da
// OpenStreetMap via Overpass (CORS aperto verificato), più le regole
// sull'accesso dei cani: tag OSM quando esiste, altrimenti tabella
// curata dei parchi nazionali (dati/parchi-cani.json, con data di
// verifica e fonte ufficiale). ATTENZIONE dichiarata in UI: le regole
// cambiano e possono variare per zona e stagione — fa fede l'ente.
// ─────────────────────────────────────────────────────────────────────────

import { API } from '../config.js';

// Fino a n punti sonda equidistanti lungo i campioni: bastano per
// intercettare le aree attraversate senza appesantire Overpass
export function puntiSonda(campioni, n = 8) {
  if (!campioni?.length) return [];
  if (campioni.length <= n) return [...campioni];
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push(campioni[Math.round((k * (campioni.length - 1)) / (n - 1))]);
  }
  return out;
}

// Interroga Overpass: una sola chiamata con tutti i punti sonda.
// Restituisce [{ nome, tipo, sito, caneOsm }] deduplicato.
export async function areeProtette(campioni) {
  const punti = puntiSonda(campioni);
  if (!punti.length) return [];
  const dichiarazioni = punti
    .map((p, k) => `is_in(${p.lat.toFixed(5)},${p.lon.toFixed(5)})->.p${k};`)
    .join('');
  const pivot = punti
    .map(
      (_, k) =>
        `rel(pivot.p${k})["boundary"~"protected_area|national_park"];` +
        `rel(pivot.p${k})["leisure"="nature_reserve"];`
    )
    .join('');
  const query = `[out:json][timeout:20];${dichiarazioni}(${pivot});out tags;`;
  // Il server principale a volte rifiuta (406 su euristiche anti-bot) o
  // limita (429): si prova la catena di mirror prima di arrendersi
  let dati = null;
  let ultimoErrore = null;
  for (const endpoint of API.overpass) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
      dati = await r.json();
      break;
    } catch (e) {
      ultimoErrore = e;
    }
  }
  if (!dati) throw ultimoErrore || new Error('Overpass non raggiungibile');

  const viste = new Map();
  for (const e of dati.elements || []) {
    const t = e.tags || {};
    if (viste.has(e.id) || !t.name) continue;
    viste.set(e.id, {
      nome: t.name,
      tipo:
        t.protection_title ||
        (t.boundary === 'national_park'
          ? 'Parco nazionale'
          : t.leisure === 'nature_reserve'
            ? 'Riserva naturale'
            : 'Area protetta'),
      sito: t.website || t['contact:website'] || null,
      // Tag OSM sui cani (raro ma prezioso): yes | no | leashed
      caneOsm: t.dog || null,
    });
  }
  return [...viste.values()];
}

// Abbina la tabella curata dei parchi nazionali: una voce vale se il
// nome OSM (minuscolo) contiene una delle sue chiavi
export function abbinaRegole(aree, tabella) {
  return aree.map((a) => {
    const nomeMin = a.nome.toLowerCase();
    const voce = (tabella || []).find((v) => v.chiavi?.some((c) => nomeMin.includes(c)));
    let cani = voce
      ? { classe: voce.classe, nota: voce.nota, fonte: voce.fonte, verificato: voce.verificato }
      : null;
    // Il tag OSM esplicito vince sull'assenza di voce curata
    if (!cani && a.caneOsm) {
      const mappa = {
        no: { classe: 'vietato', nota: 'Cani vietati (dato OpenStreetMap)' },
        leashed: { classe: 'guinzaglio', nota: 'Cani al guinzaglio (dato OpenStreetMap)' },
        yes: { classe: 'guinzaglio', nota: 'Cani ammessi (dato OpenStreetMap): tieni comunque il guinzaglio' },
      };
      cani = mappa[a.caneOsm] || null;
    }
    return { ...a, cani, sito: a.sito || voce?.sito || null };
  });
}

// Rilevazione + regole in un colpo solo (la tabella statica passa dal
// service worker: offline compresa)
export async function areeConRegole(campioni, urlTabella = './dati/parchi-cani.json') {
  const [aree, tabella] = await Promise.all([
    areeProtette(campioni),
    fetch(urlTabella)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  return abbinaRegole(aree, tabella?.parchi || []);
}
