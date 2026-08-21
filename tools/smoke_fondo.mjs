// ─────────────────────────────────────────────────────────────────────────
// Smoke di rete dello stato del fondo: scarica le serie RETROSPETTIVE
// reali (120 h prima) su tre aree con modelli diversi e stampa fango,
// neve e ghiaccio tratto per tratto. Verifica ciò che i test unitari non
// possono coprire: che i giorni passati arrivino davvero, su ogni modello
// primario, con le sei variabili non-null.
// Uso: node tools/smoke_fondo.mjs
// ─────────────────────────────────────────────────────────────────────────

import { MODELLI, VARIABILI_FONDO, FONDO, FONDO_CLASSI } from '../js/config.js';
import { meteoSerie } from '../js/api/meteo.js';
import { preparaFondo, statoFondo, sintesiFondo } from '../js/fondo.js';
import { oraApiUtc } from '../js/tempo.js';

// Tre aree, tre modelli primari diversi: Appennino (ICON-2I), Dolomiti
// (MeteoSwiss ICON-CH2), Boemia fuori Alpi (ICON-EU)
const AREE = [
  {
    nome: 'Gran Sasso (Appennino)',
    modello: MODELLI.italia_meteo_arpae_icon_2i,
    campioni: [
      { lat: 42.45, lon: 13.55, eleM: 1200, dCumKm: 0 },
      { lat: 42.47, lon: 13.57, eleM: 1900, dCumKm: 4 },
      { lat: 42.49, lon: 13.57, eleM: 2400, dCumKm: 8 },
    ],
  },
  {
    nome: 'Dolomiti (Alpi)',
    modello: MODELLI.meteoswiss_icon_ch2,
    campioni: [
      { lat: 46.5, lon: 11.85, eleM: 1500, dCumKm: 0 },
      { lat: 46.53, lon: 11.87, eleM: 2200, dCumKm: 5 },
      { lat: 46.55, lon: 11.88, eleM: 2900, dCumKm: 9 },
    ],
  },
  {
    nome: 'Boemia (fuori Alpi)',
    modello: MODELLI.icon_eu,
    campioni: [
      { lat: 50.73, lon: 15.74, eleM: 700, dCumKm: 0 },
      { lat: 50.75, lon: 15.73, eleM: 1200, dCumKm: 4 },
    ],
  },
];

// Partenza fittizia: domani alle 07:00 UTC, arrivo 5 ore dopo
const partenzaMs = Date.now() + 24 * 3600000;
const durataMin = 300;

let problemi = 0;

for (const area of AREE) {
  console.log(`\n── ${area.nome} — ${area.modello.nome} ──`);
  const orari = area.campioni.map(
    (_, i) => new Date(partenzaMs + (i * durataMin * 60000) / area.campioni.length)
  );
  const startHour = oraApiUtc(new Date(partenzaMs - FONDO.oreNeve * 3600000));
  const endHour = oraApiUtc(new Date(partenzaMs + durataMin * 60000 + 3600000), 'su');
  console.log(`finestra retrospettiva: ${startHour} → ${endHour}`);

  let res;
  try {
    res = await meteoSerie({
      campioni: area.campioni,
      modello: area.modello,
      variabili: VARIABILI_FONDO,
      startHour,
      endHour,
    });
  } catch (e) {
    console.error(`  CHIAMATA FALLITA: ${e.message}`);
    problemi++;
    continue;
  }

  console.log(`copertura: ${Math.round(res.copertura * 100)}%`);
  if (res.copertura < 0.5) {
    console.error('  PROBLEMA: copertura sotto il 50%, il ripiego globale scatterebbe');
    problemi++;
    continue;
  }

  // Controllo che le sei variabili arrivino davvero popolate: una serie
  // tutta null passerebbe la copertura ma renderebbe lo stato «ignoto»
  const s0 = res.perCampione[0]?.valori || {};
  for (const v of VARIABILI_FONDO) {
    const arr = s0[v] || [];
    const pieni = arr.filter((x) => x !== null && x !== undefined).length;
    const marchio = pieni === 0 ? 'VUOTA' : `${pieni}/${arr.length}`;
    console.log(`  ${v}: ${marchio}`);
    if (pieni === 0) problemi++;
  }

  const stati = area.campioni.map((c, i) =>
    statoFondo(preparaFondo(res.perCampione[i]), {
      istanteMs: orari[i].getTime(),
      quotaM: c.eleM,
      versante: null,
    })
  );
  for (let i = 0; i < stati.length; i++) {
    const st = stati[i];
    const cl = FONDO_CLASSI[st.classe]?.etichetta ?? st.classe;
    console.log(`  km ${area.campioni[i].dCumKm} (${area.campioni[i].eleM} m): ${cl} — ${st.testo}`);
    if (st.classe === 'ignoto') {
      console.error('    PROBLEMA: stato ignoto con copertura piena');
      problemi++;
    }
  }
  const sint = sintesiFondo(stati, area.campioni);
  console.log(`  sintesi: ${sint.classe} su ${sint.trattiClasse}/${sint.totale} tratti`);
}

console.log('');
if (problemi) {
  console.error(`SMOKE FALLITO: ${problemi} problemi rilevati`);
  process.exit(1);
}
console.log('Smoke fondo completato senza errori.');
