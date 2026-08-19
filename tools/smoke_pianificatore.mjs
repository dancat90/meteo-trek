// ─────────────────────────────────────────────────────────────────────────
// Smoke di rete del pianificatore: serie orarie reali (Gran Sasso, area
// ICON-2I → esercita anche la PoP d'ensemble per ora) e valutazione delle
// finestre. Uso: node tools/smoke_pianificatore.mjs
// ─────────────────────────────────────────────────────────────────────────

import { MODELLI, VARIABILI_PIANIFICATORE, PIANIFICATORE } from '../js/config.js';
import { meteoSerie } from '../js/api/meteo.js';
import { ensemblePopSerie } from '../js/api/ensemble.js';
import { candidatiPartenza, valutaFinestre } from '../js/pianificatore.js';
import { oraApiUtc } from '../js/tempo.js';

const campioni = [
  { lat: 42.45, lon: 13.55, eleM: 1200, dCumKm: 0 },
  { lat: 42.47, lon: 13.57, eleM: 1900, dCumKm: 4 },
  { lat: 42.49, lon: 13.57, eleM: 2400, dCumKm: 8 },
];
const offsetMin = [0, 150, 330];
const durataTotaleMin = 330;
const modello = MODELLI.italia_meteo_arpae_icon_2i;

const adessoMs = Date.now();
const candidati = candidatiPartenza({ adessoMs, tz: 'Europe/Rome' });
console.log(`candidati: ${candidati.length} (primo ${candidati[0]?.dataIso} ${candidati[0]?.oraLocale})`);

const ultimoArrivoMs = candidati[candidati.length - 1].partenzaUtcMs + durataTotaleMin * 60000;
const startHour = oraApiUtc(new Date(candidati[0].partenzaUtcMs - 3600000));
const endHour = oraApiUtc(new Date(ultimoArrivoMs + 3600000), 'su');
console.log(`finestra API: ${startHour} → ${endHour}`);

const [serieRes, popRes] = await Promise.all([
  meteoSerie({ campioni, modello, variabili: VARIABILI_PIANIFICATORE, startHour, endHour }),
  ensemblePopSerie({ campioni, startHour, endHour }),
]);
console.log(`serie: copertura ${Math.round(serieRes.copertura * 100)}%`);
const ore0 = serieRes.perCampione[0]?.valori?.temperature_2m?.length ?? 0;
console.log(`ore per campione: ${ore0}`);
console.log(`ensemble PoP: ${popRes ? `${popRes.modello}, prime ore campione 0: ${popRes.perCampione[0]?.popKN?.slice(0, 6).join(',')}` : 'NON disponibile'}`);

const finestre = valutaFinestre({
  candidati,
  offsetMin,
  campioni,
  serieCampioni: serieRes.perCampione,
  profiliEspo: null,
  popSerie: popRes?.perCampione ?? null,
  orizzonteMs: adessoMs + modello.orizzonteOre * 3600000,
  arrivoLatLon: { lat: 42.49, lon: 13.57 },
  durataTotaleMin,
});

let ok = 0;
let grigi = 0;
for (const f of finestre) {
  if (f.stato === 'ok' || f.stato === 'datiParziali') ok++;
  else grigi++;
}
console.log(`finestre valutate: ${finestre.length} (${ok} con score, ${grigi} grigie)`);
for (const f of finestre.slice(0, 5)) {
  console.log(
    `  ${f.dataIso} ${f.oraLocale}: stato=${f.stato} score=${f.scoreMax} distr=${JSON.stringify(f.distribuzione)} tramonto=${f.tramonto?.classe ?? 'n/d'}${f.peggior?.canali?.length ? ' peggior=' + f.peggior.canali.map((k) => `${k.nome}(${k.score})`).join(',') : ''}`
  );
}
if (!finestre.length || !ok) {
  console.error('SMOKE FALLITO: nessuna finestra con score');
  process.exit(1);
}
console.log('Smoke pianificatore completato senza errori.');
