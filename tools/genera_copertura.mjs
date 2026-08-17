// ─────────────────────────────────────────────────────────────────────────
// Genera dati/copertura-vodafone.json dal dump OpenCelliD dell'Italia
// (MCC 222). Due bitmap su griglia 0,01° (~1 km): celle Vodafone (222-10)
// e celle di QUALUNQUE operatore (per le chiamate di emergenza 112, che
// passano su ogni rete disponibile).
//
// Uso: node tools/genera_copertura.mjs <percorso 222.csv>
// Il CSV si scarica da opencellid.org (account gratuito):
//   https://opencellid.org/ocid/downloads?token=<chiave>&type=mcc&file=222.csv.gz
// Dati celle © OpenCelliD, licenza CC-BY-SA 4.0.
// ─────────────────────────────────────────────────────────────────────────

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const csv = process.argv[2];
if (!csv) {
  console.error('Uso: node tools/genera_copertura.mjs <222.csv>');
  process.exit(1);
}

// Griglia: Italia + margine (isole comprese)
const LAT0 = 35.4;
const LAT1 = 47.2;
const LON0 = 6.5;
const LON1 = 18.7;
const PASSO = 0.01;
const RIGHE = Math.ceil((LAT1 - LAT0) / PASSO);
const COLONNE = Math.ceil((LON1 - LON0) / PASSO);

const bitV = new Uint8Array(Math.ceil((RIGHE * COLONNE) / 8));
const bitT = new Uint8Array(Math.ceil((RIGHE * COLONNE) / 8));
const setBit = (arr, idx) => {
  arr[idx >> 3] |= 1 << (idx & 7);
};

let righeCsv = 0;
let vodafone = 0;
let totali = 0;
const rl = createInterface({ input: createReadStream(csv, 'utf8') });
for await (const l of rl) {
  righeCsv++;
  // radio,mcc,net,area,cell,unit,lon,lat,range,samples,...
  const p = l.split(',');
  if (p.length < 9 || p[1] !== '222') continue;
  const lon = Number(p[6]);
  const lat = Number(p[7]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (lat < LAT0 || lat >= LAT1 || lon < LON0 || lon >= LON1) continue;
  const idx = Math.floor((lat - LAT0) / PASSO) * COLONNE + Math.floor((lon - LON0) / PASSO);
  setBit(bitT, idx);
  totali++;
  if (p[2] === '10') {
    setBit(bitV, idx);
    vodafone++;
  }
}

const out = {
  v: 1,
  generato: new Date().toISOString().slice(0, 10),
  fonte: 'OpenCelliD (CC-BY-SA 4.0)',
  lat0: LAT0,
  lon0: LON0,
  passo: PASSO,
  righe: RIGHE,
  colonne: COLONNE,
  nCelleVodafone: vodafone,
  nCelleTotali: totali,
  vodafone: Buffer.from(bitV).toString('base64'),
  tutte: Buffer.from(bitT).toString('base64'),
};
writeFileSync(new URL('../dati/copertura-vodafone.json', import.meta.url), JSON.stringify(out));
console.log(
  `righe csv: ${righeCsv} — celle in griglia: ${totali} (Vodafone ${vodafone}) — griglia ${RIGHE}×${COLONNE}`
);
