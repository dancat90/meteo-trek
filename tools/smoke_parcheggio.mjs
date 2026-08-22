// ─────────────────────────────────────────────────────────────────────────
// Smoke di rete della taratura dell'altimetro al parcheggio: quota DEM di
// Campo Imperatore, serie di pressione ICON-2I alla quota DEM (parametro
// elevation), coerenza fra la QFE del modello e la formula ipsometrica,
// righe di valutaParcheggio. Verifica ciò che i test unitari non coprono:
// che surface_pressure segua davvero la quota inviata e che le tre
// variabili arrivino senza null. Uso: node tools/smoke_parcheggio.mjs
// ─────────────────────────────────────────────────────────────────────────

import { MODELLI, VARIABILI_PARCHEGGIO } from '../js/config.js';
import { meteoSerie, quoteDem } from '../js/api/meteo.js';
import { oraApiUtc, dataLocaleAUtc, formattaOra } from '../js/tempo.js';
import { pressioneAllIstante, qfeDaQnh, valutaParcheggio, distanzaAttaccoM } from '../js/parcheggio.js';

const TZ = 'Europe/Rome';
const PARCHEGGIO = { lat: 42.4428, lon: 13.5582 }; // Campo Imperatore
const ATTACCO = { lat: 42.445, lon: 13.56, eleM: 2150 }; // attacco fittizio a ~290 m
const QUOTA_ATTESA = 2133;
const TOLLERANZA_DEM_M = 5;
const TOLLERANZA_QFE_HPA = 2;
let problemi = 0;

// Partenza domani alle 08:00 locali, arrivo 7 h 30 dopo
const domani = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const partenzaUtc = dataLocaleAUtc(domani, '08:00', TZ);
const arrivoUtc = new Date(partenzaUtc.getTime() + 7.5 * 3600000);

console.log('── DEM ──');
let quotaM = null;
try {
  const [q] = await quoteDem([PARCHEGGIO]);
  quotaM = Number.isFinite(q) ? Math.round(q) : null;
  console.log(`quota DEM: ${q} m (attesa ${QUOTA_ATTESA} ± ${TOLLERANZA_DEM_M})`);
  if (quotaM === null || Math.abs(quotaM - QUOTA_ATTESA) > TOLLERANZA_DEM_M) {
    console.error('  PROBLEMA: quota DEM fuori tolleranza');
    problemi++;
  }
} catch (e) {
  console.error(`  CHIAMATA FALLITA: ${e.message}`);
  problemi++;
}

console.log('\n── Pressione ICON-2I alla quota DEM ──');
const modello = MODELLI.italia_meteo_arpae_icon_2i;
const startHour = oraApiUtc(new Date(partenzaUtc.getTime() - 3600000));
const endHour = oraApiUtc(new Date(arrivoUtc.getTime() + 3600000), 'su');
console.log(`${modello.nome} · finestra ${startHour} → ${endHour} · elevation=${quotaM}`);
let serie = null;
try {
  const res = await meteoSerie({
    campioni: [{ ...PARCHEGGIO, eleM: quotaM }],
    modello,
    variabili: VARIABILI_PARCHEGGIO,
    startHour,
    endHour,
  });
  serie = res.perCampione[0];
  console.log(`copertura: ${Math.round(res.copertura * 100)}%`);
} catch (e) {
  console.error(`  CHIAMATA FALLITA: ${e.message}`);
  problemi++;
}
if (!serie) {
  console.error('  PROBLEMA: serie nulla (fuori dominio?)');
  problemi++;
} else {
  for (const v of VARIABILI_PARCHEGGIO) {
    const arr = serie.valori[v] || [];
    const nulli = arr.filter((x) => x === null || x === undefined).length;
    console.log(`  ${v}: ${arr.length - nulli}/${arr.length}`);
    if (!arr.length || nulli > 0) {
      console.error(`  PROBLEMA: ${v} con ${nulli} null`);
      problemi++;
    }
  }
}

const istante = (d) => {
  const v = serie ? pressioneAllIstante(serie, d.getTime(), { quotaM }) : null;
  return v ? { oraIso: d.toISOString(), oraLocale: formattaOra(d, TZ), ...v } : null;
};
const partenza = istante(partenzaUtc);
const arrivo = istante(arrivoUtc);
for (const [nome, x] of [
  ['partenza', partenza],
  ['arrivo', arrivo],
]) {
  if (!x) {
    console.error(`  PROBLEMA: valori di ${nome} non estratti`);
    problemi++;
    continue;
  }
  const ipso = qfeDaQnh(x.qnhHpa, quotaM, x.tempC);
  const scarto = ipso === null || !Number.isFinite(x.qfeHpa) ? null : Math.abs(ipso - x.qfeHpa);
  console.log(
    `  ${nome} ${x.oraLocale}: QNH ${x.qnhHpa.toFixed(1)} · QFE modello ${x.qfeHpa?.toFixed(1)} · QFE ipsometrica ${ipso?.toFixed(1)} · T ${x.tempC} °C · scarto ${scarto?.toFixed(2)} mbar${x.qfeStimata ? ' (QFE STIMATA: surface_pressure mancante)' : ''}`
  );
  if (x.qfeStimata || scarto === null || scarto > TOLLERANZA_QFE_HPA) {
    console.error(
      `  PROBLEMA: QFE modello e ipsometrica divergono oltre ${TOLLERANZA_QFE_HPA} mbar (la surface_pressure non segue la quota?)`
    );
    problemi++;
  }
}

console.log('\n── valutaParcheggio ──');
const val = valutaParcheggio({
  quotaM,
  quotaAttaccoM: ATTACCO.eleM,
  distanzaAttaccoM: distanzaAttaccoM(PARCHEGGIO, ATTACCO),
  partenza,
  arrivo,
});
for (const r of val.righe) console.log(`  ${r.etichetta}: ${r.valore}`);
for (const a of val.avvisi) console.log(`  ⚠ ${a}`);
console.log(`  deriva: ${val.derivaM === null ? 'null' : val.derivaM.toFixed(1) + ' m'} (${val.classeDeriva})`);
if (val.avvisi.some((a) => /non disponibile|non calcolabile/.test(a))) {
  console.error('  PROBLEMA: dati dichiarati mancanti con chiamate riuscite');
  problemi++;
}

console.log('');
if (problemi) {
  console.error(`SMOKE FALLITO: ${problemi} problemi rilevati`);
  process.exit(1);
}
console.log('Smoke parcheggio completato senza errori.');
