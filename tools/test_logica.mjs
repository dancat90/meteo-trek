// ─────────────────────────────────────────────────────────────────────────
// Test di sanità della logica pura (senza rete, senza DOM).
// Uso: node tools/test_logica.mjs
// ─────────────────────────────────────────────────────────────────────────

import {
  distanzaKm,
  lunghezzaPolilinea,
  puntoLungoPolilinea,
  lisciaQuote,
  quotaLungoTraccia,
  campionaTraccia,
  bboxPunti,
} from '../js/geo.js';
import { parseGpx } from '../js/gpx.js';
import {
  costruisciPercorso,
  percorsoDaGpx,
  percorsoDaKomoot,
  campioniPerQuota,
  applicaQuote,
} from '../js/percorso.js';
import {
  velocitaTobler,
  tempoSvizzeroMin,
  calcolaEta,
  tempoAllaDistanza,
} from '../js/eta.js';
import { scegliModelli, dentroBox, quindiciMinDisponibile } from '../js/api/modelli.js';
import {
  parseSanificato,
  serie,
  valoreVicino,
  indiceOrario,
  wrapLon,
  clampLat,
} from '../js/api/meteo.js';
import { dataLocaleAUtc, offsetMinuti, oraApiUtc } from '../js/tempo.js';
import { affidabilita, etichettaAffidabilita } from '../js/affidabilita.js';
import { scoreCanali, fusione, canaliAttivi } from '../js/rischio.js';
import { percepita } from '../js/percepita.js';

let falliti = 0;
function test(nome, condizione, dettaglio = '') {
  if (condizione) console.log(`  ok  ${nome}`);
  else {
    console.error(`FAIL  ${nome} ${dettaglio}`);
    falliti++;
  }
}
function vicino(a, b, tolleranza) {
  return Math.abs(a - b) <= tolleranza;
}

// ── Fixture: traccia sintetica lineare verso nord ───────────────────────
// n punti a passo passoKm, quota da quota0 con dislivello totale dPlus
function tracciaSintetica({ n, passoKm, quota0 = 1000, dTot = 0, lat0 = 46, lon = 11 }) {
  const punti = [];
  for (let i = 0; i < n; i++) {
    punti.push({
      lat: lat0 + (i * passoKm) / 111.2,
      lon,
      eleM: quota0 + (dTot * i) / (n - 1),
    });
  }
  return punti;
}

console.log('── Geometria ──');
{
  const a = { lat: 46, lon: 11 };
  const b = { lat: 47, lon: 11 };
  test('1 grado di lat ≈ 111 km', vicino(distanzaKm(a, b), 111.2, 0.5), String(distanzaKm(a, b)));
  const punti = tracciaSintetica({ n: 121, passoKm: 0.1, dTot: 400 });
  const { tot, cum } = lunghezzaPolilinea(punti);
  test('lunghezza sintetica ≈ 12 km', vicino(tot, 12, 0.05), String(tot));
  const meta = puntoLungoPolilinea(punti, cum, tot / 2);
  test('punto a metà ≈ lat centrale', vicino(meta.lat, punti[60].lat, 0.001));
  const q = quotaLungoTraccia(punti, cum, tot / 2);
  test('quota a metà ≈ 1200', vicino(q, 1200, 5), String(q));
  const campioni = campionaTraccia(punti, cum);
  test('campioni fra 2 e 25', campioni.length >= 2 && campioni.length <= 25, String(campioni.length));
  test('primo campione a 0 km', campioni[0].dCumKm === 0);
  test('ultimo campione a fine traccia', vicino(campioni[campioni.length - 1].dCumKm, tot, 0.01));
  test('campioni con quota', campioni.every((c) => Number.isFinite(c.eleM)));
  const bbox = bboxPunti(punti);
  test('bbox coerente', bbox.latMin === punti[0].lat && bbox.lonMin === 11 && bbox.lonMax === 11);
  const liscie = lisciaQuote([100, 200, 100, 200, 100]);
  test('liscia quote media centrata', vicino(liscie[2], 140, 1), String(liscie[2]));
  const conNull = lisciaQuote([100, null, 100]);
  test('liscia quote conserva i null', conNull[1] === null);
}

console.log('── Parser GPX ──');
{
  const gpxEle = `<?xml version="1.0"?><gpx><trk><name>Anello di prova</name><trkseg>
    <trkpt lat="46.0" lon="11.0"><ele>1000</ele></trkpt>
    <trkpt lat="46.01" lon="11.0"><ele>1100</ele></trkpt>
    <trkpt lon="11.0" lat="46.02"><ele>1200</ele></trkpt>
  </trkseg></trk></gpx>`;
  const p1 = parseGpx(gpxEle);
  test('trkpt con ele: 3 punti', p1.punti.length === 3);
  test('attributi in ordine qualunque', p1.punti[2].lat === 46.02);
  test('nome dal trk', p1.nome === 'Anello di prova');
  test('serveElevation falso con ele', p1.serveElevation === false);

  const gpxSenzaEle = `<gpx><trk><trkseg>
    <trkpt lat="46.0" lon="11.0"/><trkpt lat="46.01" lon="11.0"/>
  </trkseg></trk></gpx>`;
  const p2 = parseGpx(gpxSenzaEle);
  test('self-closing senza ele', p2.punti.length === 2 && p2.punti[0].eleM === null);
  test('serveElevation vero senza ele', p2.serveElevation === true);

  const gpxMulti = `<gpx><trk><trkseg>
    <trkpt lat="46.0" lon="11.0"><ele>1000</ele></trkpt>
    <trkpt lat="46.01" lon="11.0"><ele>1010</ele></trkpt>
  </trkseg><trkseg>
    <trkpt lat="46.02" lon="11.0"><ele>1020</ele></trkpt>
  </trkseg></trk></gpx>`;
  test('trkseg multipli concatenati', parseGpx(gpxMulti).punti.length === 3);

  const gpxRte = `<gpx><rte>
    <rtept lat="46.0" lon="11.0"/><rtept lat="46.01" lon="11.0"/>
  </rte></gpx>`;
  test('fallback rtept', parseGpx(gpxRte).punti.length === 2);

  let errore = null;
  try {
    parseGpx('<gpx></gpx>');
  } catch (e) {
    errore = e;
  }
  test('GPX vuoto lancia errore', errore !== null);
}

console.log('── Percorso ──');
{
  const punti = tracciaSintetica({ n: 121, passoKm: 0.1, dTot: 400 });
  const perc = costruisciPercorso({ nome: 'Salita', fonte: 'gpx', punti });
  test('totKm ≈ 12', vicino(perc.totKm, 12, 0.05), String(perc.totKm));
  test('D+ ≈ 400 (bordi lisciati)', perc.dPlusM >= 380 && perc.dPlusM <= 400, String(perc.dPlusM));
  test('D- ≈ 0', perc.dMinusM <= 5, String(perc.dMinusM));
  test('dCumKm monotona', perc.punti.every((p, i) => i === 0 || p.dCumKm >= perc.punti[i - 1].dCumKm));

  const items = [
    { lat: 46, lng: 11, alt: 1000, t: 0 },
    { lat: 46.01, lng: 11, alt: 1050, t: 60000 },
    { lat: 46.02, lng: 11 }, // alt mancante: tollerata
  ];
  const komoot = percorsoDaKomoot(items, { nome: 'Tour K' });
  test('normalizzazione Komoot lng→lon', komoot.punti[0].lon === 11);
  test('Komoot 3 punti', komoot.punti.length === 3);
  test('fonte komoot', komoot.fonte === 'komoot');

  // Ricostruzione quote dal DEM
  const senzaQuote = tracciaSintetica({ n: 51, passoKm: 0.1 }).map((p) => ({
    ...p,
    eleM: null,
  }));
  const percSQ = costruisciPercorso({ nome: null, fonte: 'gpx', punti: senzaQuote });
  test('serveElevation sul percorso', percSQ.serveElevation === true);
  const campQ = campioniPerQuota(percSQ);
  test('campioni quota ≤ 300', campQ.length <= 300 && campQ.length >= 2, String(campQ.length));
  const conQuote = applicaQuote(
    percSQ,
    campQ.map((c) => ({ idx: c.idx, eleM: 1000 + c.dCumKm * 100 }))
  );
  test('quote applicate ovunque', conQuote.punti.every((p) => Number.isFinite(p.eleM)));
  test('D+ ricostruito ≈ 500', vicino(conQuote.dPlusM, 500, 25), String(conQuote.dPlusM));
}

console.log('── Motore ETA ──');
{
  test('Tobler in piano ≈ 5 km/h', vicino(velocitaTobler(0), 5.037, 0.01));
  test('Tobler massimo a -5%', velocitaTobler(-0.05) === 6);
  test('àncora svizzera 12 km +400 = 240 min', tempoSvizzeroMin(12, 400, 0, 400) === 240);
  test('discesa 8 km -400 = 150 min', tempoSvizzeroMin(8, 0, 400, 400) === 150);
  test('passo 300 → ×4/3', vicino(tempoSvizzeroMin(12, 400, 0, 300), 320, 0.01));
  test('passo 600 → ×2/3', vicino(tempoSvizzeroMin(12, 400, 0, 600), 160, 0.01));

  const punti = tracciaSintetica({ n: 121, passoKm: 0.1, dTot: 400 });
  const perc = costruisciPercorso({ nome: null, fonte: 'gpx', punti });
  const eta = calcolaEta(perc, { mhSalita: 400, pausaMinOra: 0 });
  test(
    'movimento = svizzero personalizzato (per costruzione)',
    vicino(eta.durataMovimentoMin, tempoSvizzeroMin(perc.totKm, perc.dPlusM, perc.dMinusM, 400), 0.5),
    String(eta.durataMovimentoMin)
  );
  test('àncora sintetica ≈ 4 h', vicino(eta.durataTotaleMin, 240, 4), String(eta.durataTotaleMin));
  test('k dentro la guardia', eta.k >= 0.5 && eta.k <= 2.5, String(eta.k));
  test('nessun avviso su traccia sana', eta.avvisi.length === 0);
  test('tCum monotona', eta.tCumMin.every((t, i) => i === 0 || t >= eta.tCumMin[i - 1]));

  const conPause = calcolaEta(perc, { mhSalita: 400, pausaMinOra: 10 });
  test(
    'pause 10 min/h → ×7/6',
    vicino(conPause.durataTotaleMin, eta.durataTotaleMin * (7 / 6), 0.5)
  );

  const conSosta = calcolaEta(perc, {
    mhSalita: 400,
    pausaMinOra: 0,
    sosta: { dopoOre: 2, durataMin: 45 },
  });
  test(
    'sosta pranzo additiva',
    vicino(conSosta.durataTotaleMin, eta.durataTotaleMin + 45, 0.5)
  );
  const tMeta = tempoAllaDistanza(perc.cum, eta.tCumMin, perc.totKm / 2);
  test('tempo a metà fra 40% e 60% del totale',
    tMeta > eta.durataTotaleMin * 0.4 && tMeta < eta.durataTotaleMin * 0.6,
    String(tMeta)
  );

  // Guardia: dislivello assurdo rispetto alla distanza (monotono, quindi
  // la lisciatura non lo attenua: +2000 m in 1 km) → k fuori intervallo.
  // Gli spike alternati NON servono al test: la media mobile li spegne
  // apposta prima che arrivino al motore.
  const assurdi = tracciaSintetica({ n: 21, passoKm: 0.05, dTot: 2000 });
  const percAssurdo = costruisciPercorso({ nome: null, fonte: 'gpx', punti: assurdi });
  const etaAssurdo = calcolaEta(percAssurdo, { mhSalita: 400, pausaMinOra: 0 });
  test('quote assurde → avviso guardia', etaAssurdo.avvisi.length > 0, JSON.stringify({ k: etaAssurdo.k }));
}

console.log('── Selezione modello ──');
{
  const lead24 = 24;
  const alpi = { latMin: 46.4, latMax: 46.6, lonMin: 11.2, lonMax: 11.4 };
  const s1 = scegliModelli(alpi, lead24);
  test('Alpi → primario ch2', s1.primario.id === 'meteoswiss_icon_ch2', s1.primario.id);
  test('Alpi → secondario icon_d2', s1.secondario.id === 'icon_d2', s1.secondario?.id);

  const appNord = { latMin: 44.0, latMax: 44.2, lonMin: 10.6, lonMax: 10.8 };
  const s2 = scegliModelli(appNord, lead24);
  test('Appennino nord → icon_2i forzato', s2.primario.id === 'italia_meteo_arpae_icon_2i', s2.primario.id);
  test('Appennino nord → secondario icon_d2', s2.secondario.id === 'icon_d2', s2.secondario?.id);

  const granSasso = { latMin: 42.4, latMax: 42.5, lonMin: 13.5, lonMax: 13.6 };
  const s3 = scegliModelli(granSasso, lead24);
  test('Gran Sasso → icon_2i', s3.primario.id === 'italia_meteo_arpae_icon_2i', s3.primario.id);
  test('Gran Sasso → secondario icon_eu (d2 fuori box)', s3.secondario.id === 'icon_eu', s3.secondario?.id);

  const pirenei = { latMin: 42.5, latMax: 42.7, lonMin: 0.4, lonMax: 0.6 };
  const s4 = scegliModelli(pirenei, lead24);
  test('Pirenei → niente icon_2i', s4.primario.id === 'icon_eu', s4.primario.id);

  const s5 = scegliModelli(alpi, 96);
  test('Alpi +4 gg → resta ch2', s5.primario.id === 'meteoswiss_icon_ch2', s5.primario.id);
  test('Alpi +4 gg → secondario oltre d2 e 2i', s5.secondario.id === 'icon_eu', s5.secondario?.id);

  const s6 = scegliModelli(alpi, 144);
  test('Alpi +6 gg → best_match con avviso', s6.primario.id === 'best_match' && s6.avvisi.length > 0, s6.primario.id);

  test('15 min nativi sulle Alpi entro 48 h', quindiciMinDisponibile(alpi, lead24) === true);
  test('15 min non nativi al Gran Sasso', quindiciMinDisponibile(granSasso, lead24) === false);
  test('15 min oltre orizzonte d2', quindiciMinDisponibile(alpi, 96) === false);
  test('dentroBox mondo con box null', dentroBox(alpi, null) === true);
}

console.log('── Client meteo (parsing puro) ──');
{
  const conNan = '{"hourly":{"temperature_2m":[nan, 5.2, nan]}}';
  const p = parseSanificato(conNan);
  test('nan → null senza eccezioni', p.hourly.temperature_2m[0] === null && p.hourly.temperature_2m[1] === 5.2);

  const hourly = { time: ['2026-08-20T06:00', '2026-08-20T07:00', '2026-08-20T08:00'], temperature_2m: [10, null, 12] };
  test('serie nome semplice', serie(hourly, 'temperature_2m', 'icon_d2')[0] === 10);
  const suffissata = { temperature_2m_icon_d2: [7] };
  test('serie suffissata', serie(suffissata, 'temperature_2m', 'icon_d2')[0] === 7);
  // L'ordine dei delta è [0, +1, -1, ...]: sul null all'indice 1 vince
  // il vicino successivo (12), come nell'originale di meteo-rotta
  test('valoreVicino scavalca i null', valoreVicino(hourly.temperature_2m, 1) === 12);
  const idx = indiceOrario(hourly.time, new Date(Date.UTC(2026, 7, 20, 7, 10)));
  test('indiceOrario arrotonda all’ora', idx === 1, String(idx));
  const idxFuori = indiceOrario(hourly.time, new Date(Date.UTC(2026, 7, 21, 0, 0)));
  test('indiceOrario clampa ai bordi', idxFuori === 2);

  test('wrapLon conserva le valide', wrapLon(12.24) === 12.24);
  test('wrapLon riporta nel dominio', wrapLon(190) === -170);
  test('clampLat', clampLat(95) === 90);
}

console.log('── Tempo e fusi ──');
{
  const estate = dataLocaleAUtc('2026-07-01', '12:00', 'Europe/Rome');
  test('estate: 12:00 Roma = 10:00Z', estate.getUTCHours() === 10);
  const inverno = dataLocaleAUtc('2026-12-01', '12:00', 'Europe/Rome');
  test('inverno: 12:00 Roma = 11:00Z', inverno.getUTCHours() === 11);
  // Cambio ora legale → solare 2026: notte del 25 ottobre
  const cambioDopo = dataLocaleAUtc('2026-10-25', '12:00', 'Europe/Rome');
  test('dopo il cambio: 12:00 = 11:00Z', cambioDopo.getUTCHours() === 11);
  const cambioPrima = dataLocaleAUtc('2026-10-24', '12:00', 'Europe/Rome');
  test('prima del cambio: 12:00 = 10:00Z', cambioPrima.getUTCHours() === 10);
  test('oraApiUtc arrotonda giù', oraApiUtc(new Date(Date.UTC(2026, 7, 20, 7, 40))) === '2026-08-20T07:00');
  test('oraApiUtc arrotonda su', oraApiUtc(new Date(Date.UTC(2026, 7, 20, 7, 40)), 'su') === '2026-08-20T08:00');
}

console.log('── Affidabilità ──');
{
  const alta = affidabilita({ sigmaTempC: 0.5, diffTempC: 0.5, diffRaffKmh: 3, leadGiorni: 0.5 });
  test('accordo alto → pct alta', alta.pct >= 75, String(alta.pct));
  const bassa = affidabilita({ sigmaTempC: 4, diffTempC: 5, diffRaffKmh: 30, leadGiorni: 5 });
  test('disaccordo + lead → pct bassa', bassa.pct <= 40, String(bassa.pct));
  const soloLead = affidabilita({ sigmaTempC: null, diffTempC: null, diffRaffKmh: null, leadGiorni: 1 });
  test('solo lead → flag', soloLead.soloLead === true);
  test('etichetta alta', etichettaAffidabilita(80) === 'alta');
}

console.log('── Rischio ──');
{
  const sereno = scoreCanali(
    { precipitation: 0, precipitation_probability: 5, wind_gusts_10m: 15, weather_code: 1, cape: 100, uv_index: 4 },
    18
  );
  test('sereno → fusione 0', fusione(sereno) === 0, JSON.stringify(sereno));

  const temporale = scoreCanali(
    { precipitation: 1, precipitation_probability: 80, wind_gusts_10m: 30, weather_code: 95, cape: 3000, uv_index: 5 },
    15
  );
  test('weather_code 95 → temporale 3', temporale.temporale === 3);
  test('fusione = max', fusione(temporale) === 3);

  const soloCape = scoreCanali(
    { precipitation: 0, precipitation_probability: 10, wind_gusts_10m: 20, weather_code: 2, cape: 3000, uv_index: 5 },
    20
  );
  test('CAPE da solo cap a 2', soloCape.temporale === 2, String(soloCape.temporale));

  const raffiche = scoreCanali(
    { precipitation: 0, precipitation_probability: 0, wind_gusts_10m: 85, weather_code: 1, cape: 0, uv_index: 2 },
    10
  );
  test('raffiche 85 km/h → vento 3', raffiche.vento === 3);

  const freddo = scoreCanali(
    { precipitation: 0, precipitation_probability: 0, wind_gusts_10m: 10, weather_code: 1, cape: 0, uv_index: 1 },
    -9
  );
  test('percepita -9 → freddo 3', freddo.freddo === 3);

  const drizzle = scoreCanali(
    { precipitation: 0.05, precipitation_probability: 30, wind_gusts_10m: 10, weather_code: 51, cape: 0, uv_index: 3 },
    15
  );
  test('drizzle sotto soglia → pioggia 0', drizzle.pioggia === 0);

  const attivi = canaliAttivi(temporale);
  test('canali attivi ordinati', attivi[0].nome === 'temporale' && attivi[0].score === 3);

  test('percepita passa apparent_temperature', percepita({ apparent_temperature: 21.5 }) === 21.5);
  test('percepita null senza dato', percepita({}) === null);
}

console.log('');
if (falliti) {
  console.error(`${falliti} test FALLITI`);
  process.exit(1);
} else {
  console.log('Tutti i test sono verdi.');
}
