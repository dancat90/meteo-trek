// ─────────────────────────────────────────────────────────────────────────
// Smoke test DI RETE (non incluso nella suite): verifica dal vivo
// selezione modello, chiamata primario, quota cella ed ensemble su un
// punto alpino e uno appenninico. Uso: node tools/smoke_meteo.mjs
// ─────────────────────────────────────────────────────────────────────────

import { scegliModelli, quindiciMinDisponibile } from '../js/api/modelli.js';
import { meteoModello } from '../js/api/meteo.js';
import { ensemblePrecipitazione } from '../js/api/ensemble.js';
import { VARIABILI_PRIMARIO } from '../js/config.js';
import { oraApiUtc } from '../js/tempo.js';

const domani10 = new Date(Date.now() + 24 * 3600000);
domani10.setUTCHours(8, 0, 0, 0);

const CASI = [
  {
    nome: 'Dolomiti (Alpi)',
    campioni: [
      { lat: 46.5, lon: 11.3, eleM: 2200, dCumKm: 0 },
      { lat: 46.52, lon: 11.32, eleM: 2500, dCumKm: 3 },
    ],
  },
  {
    nome: 'Gran Sasso (Appennino)',
    campioni: [
      { lat: 42.47, lon: 13.56, eleM: 2100, dCumKm: 0 },
      { lat: 42.45, lon: 13.58, eleM: 2600, dCumKm: 3 },
    ],
  },
];

for (const caso of CASI) {
  const bbox = {
    latMin: Math.min(...caso.campioni.map((c) => c.lat)),
    latMax: Math.max(...caso.campioni.map((c) => c.lat)),
    lonMin: Math.min(...caso.campioni.map((c) => c.lon)),
    lonMax: Math.max(...caso.campioni.map((c) => c.lon)),
  };
  const orari = caso.campioni.map(
    (_, i) => new Date(domani10.getTime() + i * 3600000)
  );
  const leadOre = (orari[orari.length - 1] - Date.now()) / 3600000;
  const { primario, secondario, avvisi } = scegliModelli(bbox, leadOre);
  console.log(`\n── ${caso.nome} ──`);
  console.log(`modelli: ${primario.id} / ${secondario?.id} — avvisi: ${avvisi.length}`);
  console.log(`15 min nativi: ${quindiciMinDisponibile(bbox, leadOre)}`);

  const startHour = oraApiUtc(new Date(orari[0].getTime() - 3600000));
  const endHour = oraApiUtc(new Date(orari[1].getTime() + 3600000), 'su');

  const res = await meteoModello({
    campioni: caso.campioni,
    orari,
    modello: primario,
    variabili: VARIABILI_PRIMARIO,
    startHour,
    endHour,
    quindici: quindiciMinDisponibile(bbox, leadOre),
  });
  console.log(`copertura primario: ${(res.copertura * 100).toFixed(0)}%`);
  const c0 = res.perCampione[0];
  if (c0) {
    const v = c0.valori;
    console.log(
      `campione 0: T=${v.temperature_2m}°C perc=${v.apparent_temperature}°C ` +
        `UR=${v.relative_humidity_2m}% vento=${v.wind_speed_10m} raff=${v.wind_gusts_10m} km/h ` +
        `sole=${v.shortwave_radiation} W/m² pioggia=${v.precipitation} mm ` +
        `PoP=${v.precipitation_probability}% quotaCella=${c0.quotaCella} m ` +
        `(sentiero ${caso.campioni[0].eleM} m) 15min=${c0.precip15Max}`
    );
  } else {
    console.log('campione 0 NULL (fuori dominio?)');
  }

  const ens = await ensemblePrecipitazione({
    campioni: caso.campioni,
    orari,
    startHour,
    endHour,
  });
  if (ens) {
    const e0 = ens.perCampione[0];
    console.log(
      `ensemble ${ens.modello}: n=${e0?.n} PoP k/N=${e0?.popKN}% ` +
        `mm p10-p90=[${e0?.mmMin}, ${e0?.mmMax}] σT=${e0?.sigmaTemp?.toFixed(2)}`
    );
  } else {
    console.log('ensemble NON disponibile');
  }
}
