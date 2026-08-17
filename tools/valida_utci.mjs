// ─────────────────────────────────────────────────────────────────────────
// Validazione del polinomio UTCI (js/utci-poly.js) contro i valori di
// riferimento generati con pythermalcomfort (tools/utci_riferimento.json,
// 720 casi su tutto il dominio del modello). Stessa metodologia usata
// per meteo-casa. Uso: node tools/valida_utci.mjs
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stUtci } from '../js/utci-poly.js';

const qui = dirname(fileURLToPath(import.meta.url));
const { n, casi } = JSON.parse(readFileSync(join(qui, 'utci_riferimento.json'), 'utf8'));

// Note sul confronto:
// - i riferimenti sono generati chiamando il polinomio interno di
//   pythermalcomfort con la pressione di vapore della formula ufficiale
//   Fortran a0.002: la utci() pubblica della 4.4.0 ha un difetto
//   (np.log1p al posto di np.log) che sposterebbe i casi umidi di
//   0,1-1 °C. Accordo atteso: esatto (soglia 0,06 per margine).
// - i casi oltre 50 hPa di vapore stanno fuori dal dominio dichiarato
//   del modello: riportati a parte per trasparenza, non bocciano.
const pressioneVaporeHpa = (ta, rh) =>
  (rh / 100) * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta));

let max = 0;
let peggiore = null;
let inDominio = 0;
let fuoriDominio = 0;
let maxFuori = 0;
for (const [ta, tr, v, rh, atteso] of casi) {
  const nostro = stUtci(ta, tr, v, rh);
  const scarto = Math.abs(nostro - atteso);
  if (pressioneVaporeHpa(ta, rh) > 50) {
    fuoriDominio++;
    maxFuori = Math.max(maxFuori, scarto);
    continue;
  }
  inDominio++;
  if (scarto > max) {
    max = scarto;
    peggiore = { ta, tr, v, rh, atteso, nostro };
  }
}

console.log(
  `casi nel dominio ufficiale: ${inDominio}/${n} — scarto massimo: ${max.toFixed(4)} °C`
);
if (fuoriDominio) {
  console.log(
    `casi oltre 50 hPa di vapore (tropicali, non bocciano): ${fuoriDominio} — scarto max ${maxFuori.toFixed(2)} °C`
  );
}
if (max > 0.06) {
  console.error('FALLITA: scarto oltre 0,06 °C nel dominio', JSON.stringify(peggiore));
  process.exit(1);
}
console.log('Validazione UTCI superata.');
