// ─────────────────────────────────────────────────────────────────────────
// Smoke test end-to-end DI RETE (opzionale, non nella suite): replica il
// flusso completo dell'app senza DOM su percorsi REALI di terzi.
// Attenzione: gli id possono sparire (contenuti altrui); se un caso
// fallisce con 403/404 è il contenuto, non il codice.
// Uso: node tools/smoke_e2e.mjs
// ─────────────────────────────────────────────────────────────────────────

import { coordinateTour, dettagliTour, elencaTourPianificati } from '../js/api/komoot.js';
import { scaricaGpxOa } from '../js/api/outdooractive.js';
import { percorsoDaKomoot, percorsoDaGpx } from '../js/percorso.js';
import { calcolaEta, orarioAllaDistanza } from '../js/eta.js';
import { campionaTraccia, bboxPunti } from '../js/geo.js';
import { scegliModelli, quindiciMinDisponibile } from '../js/api/modelli.js';
import { meteoModello, fusoOrario, quoteCelle } from '../js/api/meteo.js';
import { ensemblePrecipitazione } from '../js/api/ensemble.js';
import { VARIABILI_PRIMARIO } from '../js/config.js';
import { oraApiUtc, dataLocaleAUtc, formattaOra } from '../js/tempo.js';
import { percepita } from '../js/percepita.js';
import { scoreCanali, fusione } from '../js/rischio.js';

let errori = 0;

async function pipeline(nome, percorso) {
  console.log(`\n── ${nome} ──`);
  console.log(
    `percorso: ${percorso.totKm} km, +${percorso.dPlusM}/-${percorso.dMinusM} m, ` +
      `${percorso.punti.length} punti, serveElevation=${percorso.serveElevation}`
  );

  const tz = (await fusoOrario(percorso.punti[0])) || 'Europe/Rome';
  const domani = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const partenzaUtc = dataLocaleAUtc(domani, '08:00', tz);

  const eta = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 10 });
  console.log(
    `eta: ${Math.round(eta.durataTotaleMin)} min (k=${eta.k.toFixed(2)}), avvisi=${eta.avvisi.length}`
  );

  const campioni = campionaTraccia(percorso.punti, percorso.cum);
  const orari = campioni.map((c) =>
    orarioAllaDistanza(partenzaUtc, percorso.cum, eta.tCumMin, c.dCumKm)
  );
  const arrivo = orari[orari.length - 1];
  const bbox = bboxPunti(campioni);
  const leadOre = Math.max(1, (arrivo.getTime() - Date.now()) / 3600000);
  const scelta = scegliModelli(bbox, leadOre);
  const quindici = quindiciMinDisponibile(bbox, leadOre);
  console.log(
    `campioni: ${campioni.length}, arrivo ${formattaOra(arrivo, tz)} ${tz}, ` +
      `modelli ${scelta.primario.id}/${scelta.secondario?.id}, 15min=${quindici}`
  );

  const finestra = {
    startHour: oraApiUtc(new Date(orari[0].getTime() - 3600000)),
    endHour: oraApiUtc(new Date(arrivo.getTime() + 3600000), 'su'),
  };
  const [prim, ens] = await Promise.all([
    meteoModello({
      campioni,
      orari,
      modello: scelta.primario,
      variabili: VARIABILI_PRIMARIO,
      ...finestra,
      quindici: quindici && scelta.primario.id === 'icon_d2',
    }),
    ensemblePrecipitazione({ campioni, orari, ...finestra }),
  ]);
  console.log(`copertura primario: ${(prim.copertura * 100).toFixed(0)}%, ensemble: ${ens?.modello ?? 'NO'}`);
  if (prim.copertura < 0.9) {
    console.error('ERRORE: copertura primario sotto il 90%');
    errori++;
  }

  // Assemblaggio minimo: percepita + rischio su ogni campione
  let conRischio = 0;
  for (let i = 0; i < campioni.length; i++) {
    const p = prim.perCampione[i];
    if (!p) continue;
    const perc = percepita(p.valori);
    const score = fusione(scoreCanali(p.valori, perc));
    if (score >= 0) conRischio++;
  }
  console.log(`campioni assemblati: ${conRischio}/${campioni.length}`);
  if (conRischio < campioni.length * 0.9) {
    console.error('ERRORE: assemblaggio incompleto');
    errori++;
  }
  const meta = prim.perCampione[Math.floor(campioni.length / 2)];
  if (meta) {
    const v = meta.valori;
    console.log(
      `campione centrale: T=${v.temperature_2m}° perc=${percepita(v)}° ` +
        `raff=${v.wind_gusts_10m} sole=${v.shortwave_radiation} PoP=${v.precipitation_probability}% ` +
        `quotaCella=${meta.quotaCella} m`
    );
  }
}

// Caso 1: tour pianificato pubblico Komoot (Sassonia: ramo "estero" → icon_d2)
try {
  const id = '3059877742';
  const [dett, items] = await Promise.all([dettagliTour(id), coordinateTour(id)]);
  await pipeline(`Komoot ${dett.nome}`, percorsoDaKomoot(items, { nome: dett.nome }));
} catch (e) {
  console.error(`ERRORE caso Komoot: ${e.message}`);
  errori++;
}

// Caso 2: elenco tour pubblici di un utente (paginazione)
try {
  const tours = await elencaTourPianificati('2430451353906');
  console.log(`\n── Elenco utente Komoot ── ${tours.length} tour pubblici`);
  if (!tours.length) {
    console.error('ERRORE: elenco vuoto su utente con 48 tour');
    errori++;
  } else {
    console.log(`primo: ${tours[0].nome} (${tours[0].km} km)`);
  }
} catch (e) {
  console.error(`ERRORE elenco: ${e.message}`);
  errori++;
}

// Caso 3: GPX Outdooractive (Allgäu: ramo alpino → ch2)
try {
  const gpx = await scaricaGpxOa('17940759');
  await pipeline('Outdooractive Rappensee', percorsoDaGpx(gpx, { fonte: 'outdooractive' }));
} catch (e) {
  console.error(`ERRORE caso Outdooractive: ${e.message}`);
  errori++;
}

// Caso 4: quota VERA delle celle via elevation=nan (deve differire dalla
// quota sentiero, non farne eco)
try {
  const campioni = [
    { lat: 42.47, lon: 13.56, eleM: 2600 },
    { lat: 46.5, lon: 11.3, eleM: 2200 },
  ];
  const celle = await quoteCelle(campioni, { id: 'italia_meteo_arpae_icon_2i' });
  console.log(`\n── Quote celle ── sentiero [2600, 2200] → celle [${celle}]`);
  if (!celle || celle.every((q, i) => q === campioni[i].eleM)) {
    console.error('ERRORE: quote celle nulle o eco della quota inviata');
    errori++;
  }
} catch (e) {
  console.error(`ERRORE quote celle: ${e.message}`);
  errori++;
}

console.log('');
if (errori) {
  console.error(`${errori} ERRORI nello smoke e2e`);
  process.exit(1);
}
console.log('Smoke e2e completato senza errori.');
