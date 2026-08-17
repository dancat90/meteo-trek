// ─────────────────────────────────────────────────────────────────────────
// Stima della copertura mobile Vodafone per tratto, da una mappa statica
// derivata da OpenCelliD (dati celle © OpenCelliD, CC-BY-SA 4.0):
// dati/copertura-vodafone.json, due bitmap su griglia 0,01° (~1 km) —
// celle Vodafone (222-10) e celle di QUALUNQUE operatore (le chiamate di
// emergenza 112 passano su ogni rete disponibile). Rigenerazione:
// tools/genera_copertura.mjs.
//
// ATTENZIONE dichiarata in UI/README: è una STIMA per distanza dalla
// cella nota più vicina. L'orografia scherma il segnale e il database è
// crowdsourced (in Italia ~118k celle note, 27k Vodafone): dove passa
// poca gente mancano segnalazioni. Indicazione, non garanzia.
// ─────────────────────────────────────────────────────────────────────────

import { SOGLIE_COPERTURA } from './config.js';
import { distanzaKm } from './geo.js';

let cache = null;

// Base64 → Uint8Array, sia browser sia Node (per i test)
function decodificaB64(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// Esposta anche ai test: dal JSON parsato alla griglia pronta
export function preparaGriglia(d) {
  return { ...d, bitV: decodificaB64(d.vodafone), bitT: decodificaB64(d.tutte) };
}

// Carica la mappa statica (passa dal service worker: offline compresa)
export async function caricaGriglia(url = './dati/copertura-vodafone.json') {
  if (cache) return cache;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`mappa copertura HTTP ${r.status}`);
  cache = preparaGriglia(await r.json());
  return cache;
}

const getBit = (arr, idx) => (arr[idx >> 3] >> (idx & 7)) & 1;

// Distanza minima (km) dal punto alle celle della bitmap entro raggioKm,
// null se nessuna: scansione locale della griglia, costo trascurabile
function distanzaBitmapKm(g, bit, punto, raggioKm) {
  const rLat = Math.ceil(raggioKm / (111 * g.passo));
  const cosLat = Math.max(0.2, Math.cos((punto.lat * Math.PI) / 180));
  const rLon = Math.ceil(raggioKm / (111 * cosLat * g.passo));
  const i0 = Math.floor((punto.lat - g.lat0) / g.passo);
  const j0 = Math.floor((punto.lon - g.lon0) / g.passo);
  let min = null;
  for (let i = i0 - rLat; i <= i0 + rLat; i++) {
    if (i < 0 || i >= g.righe) continue;
    for (let j = j0 - rLon; j <= j0 + rLon; j++) {
      if (j < 0 || j >= g.colonne) continue;
      if (!getBit(bit, i * g.colonne + j)) continue;
      const d = distanzaKm(punto, {
        lat: g.lat0 + (i + 0.5) * g.passo,
        lon: g.lon0 + (j + 0.5) * g.passo,
      });
      if (d <= raggioKm && (min === null || d < min)) min = d;
    }
  }
  return min;
}

// Classificazione dichiarata (soglie in config):
//   ≤ 2 km  → 'probabile'   (verde)
//   ≤ 6 km  → 'incerta'     (ambra: dipende dall'orografia)
//   oltre / nessuna cella nota → 'assente' (rosso)
export function classificaCopertura(distKm) {
  if (!Number.isFinite(distKm)) return { classe: 'assente', etichetta: 'probabilmente assente' };
  if (distKm <= SOGLIE_COPERTURA.probabileKm) return { classe: 'probabile', etichetta: 'probabile' };
  if (distKm <= SOGLIE_COPERTURA.incertaKm) return { classe: 'incerta', etichetta: 'incerta (orografia)' };
  return { classe: 'assente', etichetta: 'probabilmente assente' };
}

// Stima per un punto: classe Vodafone + eventuale altra rete vicina
// (con Vodafone assente ma un'altra rete entro la soglia "probabile",
// la chiamata al 112 resta possibile)
export function stimaRete(g, punto) {
  const raggio = SOGLIE_COPERTURA.incertaKm + 1;
  const dV = distanzaBitmapKm(g, g.bitV, punto, raggio);
  const cl = classificaCopertura(dV);
  let emergenzaAltraRete = false;
  if (cl.classe === 'assente') {
    emergenzaAltraRete =
      distanzaBitmapKm(g, g.bitT, punto, SOGLIE_COPERTURA.probabileKm) !== null;
  }
  return { distKm: dV, ...cl, emergenzaAltraRete };
}
