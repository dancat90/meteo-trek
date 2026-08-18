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
  puntoADistanza,
} from '../js/geo.js';
import { puntiSondaEsposizione, profiliDaQuote, fattoreEsposizione } from '../js/esposizione.js';
import { chiaveDem, cacheDemAggiorna } from '../js/api/dem.js';
import { DEM_CACHE } from '../js/config.js';
import { parseGpx } from '../js/gpx.js';
import {
  costruisciPercorso,
  percorsoDaGpx,
  percorsoDaKomoot,
  campioniPerQuota,
  applicaQuote,
} from '../js/percorso.js';
import {
  velocitaPianoKmh,
  tempoNomogrammaMin,
  tempoSvizzeroMin,
  calcolaEta,
  tempoAllaDistanza,
} from '../js/eta.js';
import { scegliModelli, dentroBox, quindiciMinDisponibile, motivoNiente15Min, modelliConfronto } from '../js/api/modelli.js';
import { MODELLI } from '../js/config.js';
import { fascia, classeDispersione } from '../js/dispersione.js';
import {
  parseSanificato,
  serie,
  valoreVicino,
  indiceOrario,
  wrapLon,
  clampLat,
} from '../js/api/meteo.js';
import { dataLocaleAUtc, offsetMinuti, oraApiUtc } from '../js/tempo.js';
import { affidabilita, etichettaAffidabilita, affidabilitaGlobale, classificaAffidabilitaGlobale } from '../js/affidabilita.js';
import { scoreCanali, fusione, canaliAttivi } from '../js/rischio.js';
import { percepita, utciDaValori, fondiWindchill, percepitaOperativa } from '../js/percepita.js';
import { puntiControllo } from '../js/marcia.js';
import { preparaGriglia, stimaRete, classificaCopertura } from '../js/copertura.js';
import { puntiSonda, abbinaRegole } from '../js/api/areeprotette.js';
import { puntoRugiada, baseNuvolosa, intensitaSolare, tipologiaNubi, classificaVisibilita } from '../js/nuvole.js';
import { cellaSole, cellaNuvole } from '../js/ui/tabella.js';
import { cronologiaAggiungi, cronologiaLeggi, cronologiaRimuovi, cronologiaSvuota } from '../js/storage.js';
import { estraiTour, estraiTourId } from '../js/api/komoot.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { albaTramontoUtc } from '../js/sole.js';
import { puntoDaTraccia, mercatorPx, scegliZoom, raggruppaPunti } from '../js/ui/marcia.js';
import { windchillC, classeCongelamento } from '../js/windchill.js';
import { mrtDiNapoli, cosszaDaToa, giornoAnnoUtc } from '../js/radiante.js';
import { stUtci } from '../js/utci-poly.js';

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

  // Regressioni dalla review adversariale
  const gpxNs = `<ns0:gpx xmlns:ns0="http://www.topografix.com/GPX/1/1"><ns0:trk>
    <ns0:name>Con namespace</ns0:name><ns0:trkseg>
    <ns0:trkpt lat="46.5" lon="11.3"><ns0:ele>2100</ns0:ele></ns0:trkpt>
    <ns0:trkpt lat="46.51" lon="11.3"><ns0:ele>2150</ns0:ele></ns0:trkpt>
  </ns0:trkseg></ns0:trk></ns0:gpx>`;
  const pNs = parseGpx(gpxNs);
  test('namespace prefissato accettato', pNs.punti.length === 2 && pNs.punti[0].eleM === 2100);
  test('nome con namespace', pNs.nome === 'Con namespace');

  const gpxEleRotto = `<gpx><trk><trkseg>
    <trkpt lat="46.0" lon="11.0"><ele>.</ele></trkpt>
    <trkpt lat="46.01" lon="11.0"><ele>1000</ele></trkpt>
  </trkseg></trk></gpx>`;
  const pRotto = parseGpx(gpxEleRotto);
  test('ele degenere "." diventa null, mai NaN', pRotto.punti[0].eleM === null);

  const gpxCdata = `<gpx><trk><name><![CDATA[Anello del Gr&#xE8;s]]></name><trkseg>
    <trkpt lat="46.0" lon="11.0"/><trkpt lat="46.01" lon="11.0"/>
  </trkseg></trk></gpx>`;
  test('CDATA nel nome ripulito', parseGpx(gpxCdata).nome === 'Anello del Grès',
    parseGpx(gpxCdata).nome);
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
  // Ancoraggi del nomogramma Schweizer Wanderwege 1996 (i punti
  // leggibili con certezza dal diagramma ufficiale)
  test('piano: 4,2 km/h', velocitaPianoKmh(0) === 4.2 && velocitaPianoKmh(0.1) === 4.2);
  test('spinta massima in discesa dolce', vicino(velocitaPianoKmh(-0.065), 4.83, 0.03), String(velocitaPianoKmh(-0.065)));
  test('spinta spenta sul ripido', vicino(velocitaPianoKmh(-0.4), 4.2, 0.01));
  test('piano 2,1 km = 30 min', vicino(tempoNomogrammaMin(2.1, 0), 30, 0.1));
  test('salita pura 300 m ≈ 45 min', vicino(tempoNomogrammaMin(0.01, 300), 45, 0.5), String(tempoNomogrammaMin(0.01, 300)));
  test('discesa pura 300 m ≈ 22,5 min', vicino(tempoNomogrammaMin(0.01, -300), 22.5, 0.5));
  const t5su = tempoNomogrammaMin(5, 300);
  test('5 km +300 m ≈ 80 min (nomogramma, non 116 additivi)', t5su >= 76 && t5su <= 84, String(t5su));
  const t5giu = tempoNomogrammaMin(5, -300);
  test('5 km −300 m ≈ 62-66 min (più veloce del piano)', t5giu >= 58 && t5giu <= 68, String(t5giu));
  test('ripido: quasi additivo', vicino(tempoNomogrammaMin(0.5, 300), 45.5, 1.5), String(tempoNomogrammaMin(0.5, 300)));
  test('monotono nella distanza', tempoNomogrammaMin(4, 300) < tempoNomogrammaMin(5, 300));
  test('monotono nel dislivello', tempoNomogrammaMin(5, 200) < tempoNomogrammaMin(5, 300));

  // La vecchia regola additiva resta come riferimento della guardia
  test('additiva 12 km +400 = 240 min', tempoSvizzeroMin(12, 400, 0, 400) === 240);
  test('additiva discesa 8 km -400 = 150 min', tempoSvizzeroMin(8, 0, 400, 400) === 150);

  const punti = tracciaSintetica({ n: 121, passoKm: 0.1, dTot: 400 });
  const perc = costruisciPercorso({ nome: null, fonte: 'gpx', punti });
  const eta = calcolaEta(perc, { mhSalita: 400, pausaMinOra: 0 });
  test(
    'movimento = nomogramma personalizzato (per costruzione)',
    vicino(eta.durataMovimentoMin, eta.tNomogrammaMin, 0.01),
    String(eta.durataMovimentoMin)
  );
  test('sintetica 12 km +400 dolce ≈ 176 min', vicino(eta.durataTotaleMin, 176, 6), String(eta.durataTotaleMin));
  const etaLento = calcolaEta(perc, { mhSalita: 300, pausaMinOra: 0 });
  test('passo 300 → ×4/3 sul totale', vicino(etaLento.durataTotaleMin, eta.durataTotaleMin * 4 / 3, 0.5));
  test('k dentro la guardia', eta.k >= 0.45 && eta.k <= 1.1, String(eta.k));
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
  test('motivo 15 min: area al Gran Sasso', motivoNiente15Min(granSasso, lead24) === 'area');
  test('motivo 15 min: orizzonte sulle Alpi a +4 gg', motivoNiente15Min(alpi, 96) === 'orizzonte');
  test('motivo 15 min: null quando disponibile', motivoNiente15Min(alpi, lead24) === null);
}

console.log('── Fascia multi-modello (dispersione) ──');
{
  const f3 = fascia([14, 16.6, 13.7]);
  test('mediana dispari', vicino(f3.mediana, 14, 0.001), String(f3.mediana));
  test('min-max e spread', f3.min === 13.7 && f3.max === 16.6 && vicino(f3.spread, 2.9, 0.001));

  const f4 = fascia([14, 16.6, 13.7, 15.8]);
  test('mediana pari interpola', vicino(f4.mediana, 14.9, 0.001), String(f4.mediana));
  test('n conta i validi', f4.n === 4);

  const conBuchi = fascia([14, null, NaN, 16, undefined]);
  test('ignora i non finiti', conBuchi.n === 2 && conBuchi.spread === 2);
  test('null sotto 2 valori', fascia([14]) === null && fascia([]) === null && fascia(null) === null);

  test('accordo alto a 2 °C', classeDispersione(2) === 'alta');
  test('accordo medio a 3 °C', classeDispersione(3) === 'media');
  test('accordo medio a 4 °C', classeDispersione(4) === 'media');
  test('accordo basso oltre 4 °C', classeDispersione(4.1) === 'bassa');
  test('classe null senza spread', classeDispersione(null) === null);

  const alpi = { latMin: 46.4, latMax: 46.6, lonMin: 11.2, lonMax: 11.4 };
  const s = scegliModelli(alpi, 24);
  test(
    'confronto = ECMWF + GFS',
    s.confronto.length === 2 &&
      s.confronto[0].id === 'ecmwf_ifs025' &&
      s.confronto[1].id === 'gfs_seamless',
    JSON.stringify(s.confronto.map((m) => m.id))
  );
  const sLunga = scegliModelli(alpi, 300);
  test(
    'confronto a +300 h: solo GFS (ECMWF si ferma a 240 h)',
    sLunga.confronto.length === 1 && sLunga.confronto[0].id === 'gfs_seamless',
    JSON.stringify(sLunga.confronto.map((m) => m.id))
  );
  const dedup = modelliConfronto(MODELLI.ecmwf_ifs025, null, 24);
  test('confronto non duplica il primario', dedup.every((m) => m.id !== 'ecmwf_ifs025'));
  const oltre = scegliModelli(alpi, 500);
  test('oltre ogni orizzonte: confronto vuoto', oltre.primario === null && oltre.confronto.length === 0);
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

  // Affidabilità complessiva della previsione (badge globale)
  test('globale = media dei tratti', affidabilitaGlobale([80, 60, null, 70]) === 70);
  test('globale senza dati → null', affidabilitaGlobale([null, undefined]) === null);
  test('fascia 85 → molto elevata verde', classificaAffidabilitaGlobale(85).etichetta === 'molto elevata' && classificaAffidabilitaGlobale(85).colore === '#2ea043');
  test('fascia 70 → elevata', classificaAffidabilitaGlobale(70).etichetta === 'elevata');
  test('fascia 50 → media', classificaAffidabilitaGlobale(50).etichetta === 'media');
  test('fascia 30 → bassa', classificaAffidabilitaGlobale(30).etichetta === 'bassa');
  test('fascia 29 → molto bassa rossa', classificaAffidabilitaGlobale(29).colore === '#da3633');
  test('fascia null → null', classificaAffidabilitaGlobale(null) === null);
}

console.log('── Tabella di marcia e tramonto ──');
{
  const punti = tracciaSintetica({ n: 121, passoKm: 0.1, dTot: 400 });
  const perc = costruisciPercorso({ nome: null, fonte: 'gpx', punti });
  const eta = calcolaEta(perc, { mhSalita: 400, pausaMinOra: 10 });
  const pc = puntiControllo(perc, eta, 15);
  test('numero punti = durata/15 arrotondato', pc.length === Math.ceil(eta.durataTotaleMin / 15), `${pc.length} vs ${eta.durataTotaleMin}`);
  test('tempi a passo 15 min', pc.slice(0, -1).every((p, i) => p.tMin === (i + 1) * 15));
  test('ultimo punto = arrivo', vicino(pc[pc.length - 1].tMin, eta.durataTotaleMin, 0.01));
  test('distanze crescenti', pc.every((p, i) => i === 0 || p.dKm > pc[i - 1].dKm));
  test('ultimo punto a fine traccia', vicino(pc[pc.length - 1].dKm, perc.totKm, 0.05), String(pc[pc.length - 1].dKm));
  test('quote presenti', pc.every((p) => Number.isFinite(p.quotaM)));
  // Traccia sintetica in salita costante ~3,3%: la pendenza media dei
  // tratti deve stare lì (bordi lisciati esclusi)
  const pendCentro = pc.slice(1, -1).map((p) => p.pendenzaPct);
  test('pendenza media ≈ +3,3%', pendCentro.every((x) => x > 1.5 && x < 5), JSON.stringify(pendCentro.slice(0, 3)));

  // Tramonto: effemeridi note di Roma (41.9 N, 12.5 E), tolleranza 10 min
  const estate = albaTramontoUtc(new Date(Date.UTC(2026, 7, 17, 12)), 41.9, 12.5);
  test('Roma 17/08: tramonto ~18:10Z', Math.abs(estate.tramontoUtc.getTime() - Date.UTC(2026, 7, 17, 18, 10)) < 10 * 60000, estate.tramontoUtc.toISOString());
  test('Roma 17/08: alba ~04:21Z', Math.abs(estate.albaUtc.getTime() - Date.UTC(2026, 7, 17, 4, 21)) < 10 * 60000);
  const inverno = albaTramontoUtc(new Date(Date.UTC(2026, 11, 21, 12)), 41.9, 12.5);
  test('Roma 21/12: tramonto ~15:42Z', Math.abs(inverno.tramontoUtc.getTime() - Date.UTC(2026, 11, 21, 15, 42)) < 10 * 60000, inverno.tramontoUtc.toISOString());
  test('notte polare → null', albaTramontoUtc(new Date(Date.UTC(2026, 11, 21, 12)), 78, 15) === null);

  // Mappa dei punti di controllo: geometria pura
  const traccia = [
    { lat: 46.0, lon: 11.0, d: 0 },
    { lat: 46.1, lon: 11.0, d: 11.1 },
  ];
  const meta = puntoDaTraccia(traccia, 5.55);
  test('punto a metà traccia interpolato', vicino(meta.lat, 46.05, 0.001) && meta.lon === 11.0, JSON.stringify(meta));
  test('oltre la fine → ultimo punto', puntoDaTraccia(traccia, 99).lat === 46.1);
  test('prima dell\'inizio → primo punto', puntoDaTraccia(traccia, -1).lat === 46.0);

  const m1 = mercatorPx(46, 11, 10);
  const m2 = mercatorPx(46.1, 11.1, 10);
  test('mercator: lon cresce → x cresce', m2.x > m1.x);
  test('mercator: lat cresce → y cala', m2.y < m1.y);
  const zb = scegliZoom({ latMin: 46, latMax: 46.1, lonMin: 11, lonMax: 11.15 }, 1100);
  const a = mercatorPx(46.1, 11, zb);
  const b = mercatorPx(46, 11.15, zb);
  test('zoom scelto: riquadro entro il lato massimo', b.x - a.x <= 1100 && b.y - a.y <= 1100, String(zb));
  test('zoom più stretto sforerebbe', (() => { const a2 = mercatorPx(46.1, 11, zb + 1); const b2 = mercatorPx(46, 11.15, zb + 1); return b2.x - a2.x > 1100 || b2.y - a2.y > 1100; })());

  // Raggruppamento dei pallini sovrapposti (andata e ritorno)
  const proietta = (p) => ({ x: p.lon * 1000, y: p.lat * 1000 });
  const quattro = [
    { lat: 0, lon: 0 },      // 1
    { lat: 0, lon: 0.01 },   // 2, a 10 px dal n.1 → stesso pallino
    { lat: 0, lon: 1 },      // 3, lontano
    { lat: 0, lon: 0.005 },  // 4, di nuovo vicino al n.1
  ];
  const gruppi = raggruppaPunti(quattro, 26, proietta);
  test('sovrapposti → 2 pallini', gruppi.length === 2, JSON.stringify(gruppi.map((g) => g.indici)));
  test('pallino con 1, 2 e 4', JSON.stringify(gruppi[0].indici) === '[0,1,3]');
  test('numeri in ordine crescente', gruppi.every((g) => g.indici.every((v, k) => k === 0 || v > g.indici[k - 1])));
  const sparsi = raggruppaPunti(quattro, 2, proietta);
  test('soglia stretta → nessuna fusione', sparsi.length === 4);
  test('punti nulli ignorati', raggruppaPunti([null, { lat: 0, lon: 0 }], 26, proietta).length === 1);
}

console.log('── Windchill (tabella Environment Canada) ──');
{
  // Celle della tabella di riferimento dell'utente (arrotondate al grado)
  const celle = [
    [5, 5, 4], [0, 15, -4], [-10, 20, -18], [-20, 30, -33],
    [-30, 50, -49], [-50, 80, -81],
  ];
  for (const [t, v, atteso] of celle) {
    test(`windchill T=${t} v=${v} → ${atteso}`, Math.round(windchillC(t, v)) === atteso,
      String(windchillC(t, v)));
  }
  test('fuori dominio: T > 10', windchillC(12, 20) === null);
  test('fuori dominio: vento < 4,8', windchillC(0, 3) === null);
  test('classe: basso a −20', classeCongelamento(-20).livello === 0);
  test('classe: soglia −28', classeCongelamento(-28).livello === 1);
  test('classe: −40 → 5-10 min', classeCongelamento(-40).livello === 2);
  test('classe: −48 → 2-5 min', classeCongelamento(-48).livello === 3);
  test('classe: −55 → <2 min', classeCongelamento(-55).livello === 4);
  test('classe: −27,9 resta bassa', classeCongelamento(-27.9).livello === 0);
}

console.log('── Radiante e UTCI ──');
{
  // Notte coperta: cielo ~corpo nero e suolo alla T dell'aria → MRT = T
  const mrtCoperto = mrtDiNapoli({ tC: 10, rh: 70, nuvole: 100, ssrd: 0, fdir: 0, dsrp: null, cossza: 0 });
  test('notte coperta: MRT = T aria', vicino(mrtCoperto, 10, 0.05), String(mrtCoperto));
  const mrtSereno = mrtDiNapoli({ tC: 10, rh: 40, nuvole: 0, ssrd: 0, fdir: 0, dsrp: null, cossza: 0 });
  test('notte serena: MRT sotto la T aria', mrtSereno < 9, String(mrtSereno));
  const mrtSole = mrtDiNapoli({ tC: 20, rh: 40, nuvole: 0, ssrd: 800, fdir: 600, dsrp: 900, cossza: 0.7 });
  test('pieno sole: MRT sopra la T aria', mrtSole > 30, String(mrtSole));

  test('cossza nullo di notte', cosszaDaToa(0, 180) === 0);
  test('cossza ~1 a mezzogiorno equatoriale', cosszaDaToa(1330, 172) > 0.95);
  test('giorno anno: 1 gennaio', giornoAnnoUtc(new Date(Date.UTC(2026, 0, 1))) === 1);
  test('giorno anno: 31 dicembre', giornoAnnoUtc(new Date(Date.UTC(2026, 11, 31))) === 365);

  // Proprietà fisiche del polinomio UTCI (il valore assoluto è validato
  // a parte contro pythermalcomfort, vedi tools/valida_utci.mjs)
  test('UTCI neutro ≈ T in condizioni miti', vicino(stUtci(20, 20, 0.5, 50), 20, 2.5), String(stUtci(20, 20, 0.5, 50)));
  test('UTCI: il vento raffredda al freddo', stUtci(-5, -5, 10, 70) < stUtci(-5, -5, 1, 70) - 5);
  test('UTCI: l\'umidità pesa nel caldo', stUtci(32, 32, 1, 80) > stUtci(32, 32, 1, 30) + 2);
  test('UTCI: il sole scalda', stUtci(10, 40, 2, 50) > stUtci(10, 10, 2, 50) + 5);

  // utciDaValori: catena completa dai valori orari del modello
  const valoriSole = {
    temperature_2m: 15, relative_humidity_2m: 45, wind_speed_10m: 18,
    cloud_cover: 10, shortwave_radiation: 700, direct_radiation: 520,
    direct_normal_irradiance: 800, terrestrial_radiation: 1000,
  };
  const uSole = utciDaValori(valoriSole, 200);
  test('utciDaValori calcola con ingressi pieni', Number.isFinite(uSole), String(uSole));
  const uSenzaRad = utciDaValori({ temperature_2m: 15, relative_humidity_2m: 45 }, 200);
  test('utciDaValori null senza vento', uSenzaRad === null);
  test('percepita ripiega su Steadman senza radiazione', percepita({ apparent_temperature: 21.5 }) === 21.5);
}

console.log('── Fusione percepita-windchill ──');
{
  // Primitiva: min prudente con gestione dei null
  const f1 = fondiWindchill(-9, -11.05);
  test('fusione: windchill sotto → governa', f1.valore === -11.05 && f1.governa === 'windchill');
  const f2 = fondiWindchill(-20, -14.08);
  test('fusione: indice già più severo → resta', f2.valore === -20 && f2.governa === 'indice');
  test('fusione: parità → governa l\'indice', fondiWindchill(-10, -10).governa === 'indice');
  const f4 = fondiWindchill(null, -5.91);
  test('fusione: indice null → copre il windchill', f4.valore === -5.91 && f4.governa === 'windchill');
  const f5 = fondiWindchill(7, null);
  test('fusione: windchill null → resta l\'indice', f5.valore === 7 && f5.governa === 'indice');
  const f6 = fondiWindchill(null, null);
  test('fusione: tutto null', f6.valore === null && f6.governa === null);

  // Orchestratore, ramo Steadman: T=−4 v=25 → wc JAG/TI −11,05
  const opSt = percepitaOperativa(
    { temperature_2m: -4, wind_speed_10m: 25, apparent_temperature: -6.5 },
    15
  );
  test('operativa Steadman: windchill governa', opSt.governa === 'windchill' && opSt.indice === 'steadman');
  test('operativa Steadman: valore = windchill', vicino(opSt.valore, -11.05, 0.01), String(opSt.valore));
  test('operativa Steadman: indice pre-fusione conservato', opSt.indiceC === -6.5);
  test('operativa Steadman: windchill esposto', vicino(opSt.windchillC, -11.05, 0.01));

  // Ramo UTCI, zona di saturazione del vento (clamp a 61,2 km/h): l'UTCI
  // saturo resta PIÙ severo del windchill → la fusione non scatta
  const opSat = percepitaOperativa(
    {
      temperature_2m: -5, relative_humidity_2m: 70, wind_speed_10m: 90,
      cloud_cover: 100, shortwave_radiation: 0, direct_radiation: 0,
      direct_normal_irradiance: 0, terrestrial_radiation: 0,
    },
    15
  );
  test('saturazione: governa l\'UTCI', opSat.governa === 'utci', JSON.stringify(opSat));
  test('saturazione: UTCI saturo ≈ −47,3', vicino(opSat.valore, -47.28, 0.6), String(opSat.valore));
  test('saturazione: windchill −17,42 nel dettaglio', vicino(opSat.windchillC, -17.42, 0.01), String(opSat.windchillC));
  test('saturazione: percepita sotto il windchill', opSat.valore < opSat.windchillC);

  // Giornata mite serena con vento debole: la fusione toglie il beneficio
  // del sole (trade-off prudenziale dichiarato). wc(5, 10) = +2,66
  const opSole = percepitaOperativa(
    {
      temperature_2m: 5, relative_humidity_2m: 40, wind_speed_10m: 10,
      cloud_cover: 0, shortwave_radiation: 700, direct_radiation: 520,
      direct_normal_irradiance: 800, terrestrial_radiation: 1000,
    },
    200
  );
  test('mite serena: windchill governa', opSole.governa === 'windchill', JSON.stringify(opSole));
  test('mite serena: valore = wc(5,10)', vicino(opSole.valore, 2.66, 0.01), String(opSole.valore));
  test('mite serena: UTCI soleggiato era più alto', opSole.indiceC > opSole.valore + 3, String(opSole.indiceC));

  // Fuori dominio windchill: T > 10 °C → resta l'indice
  const opFuori = percepitaOperativa(
    { temperature_2m: 12, apparent_temperature: 9, wind_speed_10m: 50 },
    15
  );
  test('fuori dominio: windchill null', opFuori.windchillC === null);
  test('fuori dominio: governa Steadman', opFuori.governa === 'steadman' && opFuori.valore === 9);

  // Metro forzato (fascia multi-modello)
  const opMetroSt = percepitaOperativa(
    { temperature_2m: 15, apparent_temperature: 14, wind_speed_10m: 20 },
    200,
    { metro: 'steadman' }
  );
  test('metro steadman: usa apparent_temperature', opMetroSt.indice === 'steadman' && opMetroSt.valore === 14);
  const opMetroUtci = percepitaOperativa(
    { temperature_2m: -4, wind_speed_10m: 25, apparent_temperature: -6.5 },
    15,
    { metro: 'utci' }
  );
  test('metro utci senza radiativi: copre il windchill',
    opMetroUtci.indice === null && opMetroUtci.governa === 'windchill' && vicino(opMetroUtci.valore, -11.05, 0.01));

  // End-to-end sul canale rischio freddo: la fusione può solo alzare lo score
  const vBase = { precipitation: 0, precipitation_probability: 0, wind_gusts_10m: 10, weather_code: 1, cape: 0, uv_index: 1 };
  test('rischio freddo: −6,5 → score 2', scoreCanali(vBase, -6.5).freddo === 2);
  test('rischio freddo: −11,05 → score 3', scoreCanali(vBase, -11.05).freddo === 3);
}

console.log('── Esposizione orografica ──');
{
  // Geometria: punto di destinazione su sfera
  const nord = puntoADistanza({ lat: 46, lon: 11 }, 1000, 0);
  test('puntoADistanza nord: +0,009° lat', vicino(nord.lat, 46.00899, 2e-4) && vicino(nord.lon, 11, 1e-6), JSON.stringify(nord));
  const est = puntoADistanza({ lat: 46, lon: 11 }, 1000, 90);
  test('puntoADistanza est: +0,013° lon', vicino(est.lon, 11.01295, 2e-4) && vicino(est.lat, 46, 2e-4), JSON.stringify(est));
  const ritorno = puntoADistanza(est, 1000, 270);
  test('andata e ritorno ≈ identità', vicino(ritorno.lat, 46, 1e-4) && vicino(ritorno.lon, 11, 1e-4));

  // Sonde: numero e ordine deterministico
  const camp = [{ lat: 46, lon: 11, eleM: 2000 }];
  const sonde = puntiSondaEsposizione(camp);
  test('25 sonde per campione', sonde.length === 25, String(sonde.length));
  test('prima sonda = centro', sonde[0].lat === 46 && sonde[0].lon === 11);

  // Griglie sintetiche: quote nell'ordine [centro, 8 direzioni × 3 raggi]
  const quoteUniformi = (centro, dH1, dH2, dH3) =>
    [centro, ...Array.from({ length: 8 }, () => [centro + dH1, centro + dH2, centro + dH3]).flat()];

  // Cresta: il terreno scende in ogni direzione da entrambi i lati
  const cresta = profiliDaQuote(camp, quoteUniformi(2000, -100, -200, -300));
  test('cresta: fattore 1,3 ovunque', cresta[0].f8.every((f) => vicino(f, 1.3, 1e-9)), JSON.stringify(cresta[0].f8));
  test('cresta: classe cresta', cresta[0].classi8.every((cl) => cl === 'cresta'));

  // Conca: il terreno sale in ogni direzione → riparo pieno
  const conca = profiliDaQuote(camp, quoteUniformi(2000, 150, 150, 150));
  test('conca: fattore 0,6 ovunque', conca[0].f8.every((f) => vicino(f, 0.6, 1e-9)), JSON.stringify(conca[0].f8));

  // Franchigia: dislivelli sotto i 30 m sono rumore del DEM
  const piatto = profiliDaQuote(camp, quoteUniformi(2000, 25, 25, 25));
  test('franchigia: ±25 m → neutro', piatto[0].f8.every((f) => f === 1));

  // Sottovento asimmetrico: barriera +250 m a 600 m SOLO a NO (settore 7)
  const qAsim = quoteUniformi(2000, 0, 0, 0);
  qAsim[1 + 7 * 3 + 1] = 2250;
  const asim = profiliDaQuote(camp, qAsim);
  test('barriera a NO: vento da NO → 0,6', vicino(asim[0].f8[7], 0.6, 1e-9), String(asim[0].f8[7]));
  test('barriera a NO: vento da SE → neutro', asim[0].f8[3] === 1);
  test('barriera a NO: classe riparo', asim[0].classi8[7] === 'riparo');

  // Pendio esposto: scende solo verso Est (settore 2), Ovest piatto
  const qPendio = quoteUniformi(2000, 0, 0, 0);
  qPendio[1 + 2 * 3 + 0] = 1850; // −150 m a 300 m
  const pendio = profiliDaQuote(camp, qPendio);
  test('pendio esposto: 1,15 (non 1,3)', vicino(pendio[0].f8[2], 1.15, 1e-9), String(pendio[0].f8[2]));
  test('pendio esposto: classe pendio', pendio[0].classi8[2] === 'pendio');

  // Clamp: dislivelli estremi non escono dal range [0,6, 1,3]
  const estremo = profiliDaQuote(camp, quoteUniformi(2000, 900, 900, 900));
  test('clamp: mai sotto 0,6', estremo[0].f8.every((f) => f >= 0.6));

  // Interpolazione fra settori adiacenti, con wrap a 360°
  const profilo = { f8: [1, 0.6, 1, 1, 1, 1, 1, 1], classi8: [null, 'riparo', null, null, null, null, null, null] };
  test('interpolazione 22,5° fra N e NE', vicino(fattoreEsposizione(profilo, 22.5).fattore, 0.8, 1e-9));
  const wrapP = { f8: [1, 1, 1, 1, 1, 1, 1, 0.6], classi8: Array(8).fill(null) };
  test('wrap 337,5° fra NO e N', vicino(fattoreEsposizione(wrapP, 337.5).fattore, 0.8, 1e-9));
  test('direzione null → fattore 1', fattoreEsposizione(profilo, null).fattore === 1);
  test('profilo null → fattore 1', fattoreEsposizione(null, 90).fattore === 1);

  // Degradazione: buchi DEM e centri nulli
  const quoteBuche = quoteUniformi(2000, -100, -200, -300);
  quoteBuche[0] = null;
  const conEle = profiliDaQuote(camp, quoteBuche);
  test('centro null: ripiega su eleM', conEle[0].f8.every((f) => vicino(f, 1.3, 1e-9)));
  const neutro = profiliDaQuote([{ lat: 46, lon: 11, eleM: null }], quoteBuche);
  test('centro e eleM null → neutro', neutro[0].f8.every((f) => f === 1));
  test('quote non array → null', profiliDaQuote(camp, null) === null);

  // Cache DEM: chiave per cella e FIFO
  test('chiave a 3 decimali', chiaveDem(46.0004, 11.0004) === chiaveDem(46.0001, 11.0001));
  test('celle diverse → chiavi diverse', chiaveDem(46.001, 11) !== chiaveDem(46.002, 11));
  const tante = Array.from({ length: DEM_CACHE.maxVoci + 1 }, (_, i) => [`k${i}`, i]);
  const dopo = cacheDemAggiorna(tante);
  test('FIFO: tetto rispettato', dopo.ordine.length === DEM_CACHE.maxVoci, String(dopo.ordine.length));
  test('FIFO: la più vecchia esce', !('k0' in dopo.quote) && 'k1' in dopo.quote);
}

console.log('── Copertura Vodafone (stima OpenCelliD) ──');
{
  test('classe: 1 km → probabile', classificaCopertura(1).classe === 'probabile');
  test('classe: 2 km → probabile', classificaCopertura(2).classe === 'probabile');
  test('classe: 4 km → incerta', classificaCopertura(4).classe === 'incerta');
  test('classe: 6 km → incerta', classificaCopertura(6).classe === 'incerta');
  test('classe: 6,1 km → assente', classificaCopertura(6.1).classe === 'assente');
  test('classe: senza celle → assente', classificaCopertura(null).classe === 'assente');

  // Griglia REALE inclusa nel repo (dati OpenCelliD)
  const quiDir = dirname(fileURLToPath(import.meta.url));
  const g = preparaGriglia(
    JSON.parse(readFileSync(join(quiDir, '../dati/copertura-vodafone.json'), 'utf8'))
  );
  test('griglia: celle Vodafone caricate', g.nCelleVodafone > 10000, String(g.nCelleVodafone));
  const roma = stimaRete(g, { lat: 41.8586, lon: 12.5505 });
  test('Roma Capannelle → probabile', roma.classe === 'probabile', JSON.stringify(roma));
  const mare = stimaRete(g, { lat: 40.2, lon: 11.5 });
  test('Tirreno aperto → assente', mare.classe === 'assente', JSON.stringify(mare));
  test('Tirreno aperto: nemmeno altre reti', mare.emergenzaAltraRete === false);
}

console.log('── Link Komoot (tour e smart tour) ──');
{
  const classico = estraiTour('https://www.komoot.com/tour/123456');
  test('tour classico', classico.id === '123456' && classico.smart === false);
  const lingua = estraiTour('https://www.komoot.com/it-it/tour/123456?share=x');
  test('tour con prefisso lingua', lingua.id === '123456' && lingua.smart === false);
  const smart = estraiTour(
    'https://www.komoot.com/it-it/smarttour/20476259?ref=wdd&t_s=referral&t_cid=route_share&t_ref_username=3810961348669'
  );
  test('smart tour (link reale utente)', smart.id === '20476259' && smart.smart === true, JSON.stringify(smart));
  test('input non URL → null', estraiTour('ciao') === null && estraiTour('') === null);
  test('wrapper storico invariato', estraiTourId('https://www.komoot.com/tour/9') === '9');
}

console.log('── Nuvole (base nuvolosa) ──');
{
  test('rugiada satura = T', vicino(puntoRugiada(20, 100), 20, 0.01));
  test('rugiada 20°/50% ≈ 9,3°', vicino(puntoRugiada(20, 50), 9.3, 0.2), String(puntoRugiada(20, 50)));
  test('rugiada senza dati → null', puntoRugiada(null, 50) === null && puntoRugiada(20, 0) === null);

  const modello = baseNuvolosa({ baseModelloM: 3200, tC: 10, rh: 80, quotaM: 2000, coperturaPct: 80 });
  test('base dal modello quando c\'è', modello.baseM === 3200 && modello.stima === false);
  test('sereno → base null', baseNuvolosa({ baseModelloM: 3200, tC: 10, rh: 80, quotaM: 2000, coperturaPct: 5 }) === null);
  const stima = baseNuvolosa({ baseModelloM: null, tC: 15, rh: 70, quotaM: 2000, coperturaPct: 80 });
  test('stima LCL ≈ quota + 125·spread', stima.stima === true && vicino(stima.baseM, 2680, 40), String(stima.baseM));
  const saturo = baseNuvolosa({ baseModelloM: null, tC: 8, rh: 100, quotaM: 1500, coperturaPct: 100 });
  test('aria satura → base alla quota (nebbia)', vicino(saturo.baseM, 1500, 5), String(saturo.baseM));
  // Stima soppressa quando le nubi basse sono scarse (velo alto): il
  // caso «97% alte con base 2453 m» segnalato dall'utente
  test('velo alto → stima base soppressa', baseNuvolosa({ baseModelloM: null, tC: 15, rh: 70, quotaM: 2000, coperturaPct: 97, bassePct: 10 }) === null);
  test('nubi basse consistenti → stima presente', baseNuvolosa({ baseModelloM: null, tC: 15, rh: 70, quotaM: 2000, coperturaPct: 90, bassePct: 60 }) !== null);
  test('base dal modello resta anche con basse scarse', baseNuvolosa({ baseModelloM: 4500, tC: 15, rh: 70, quotaM: 2000, coperturaPct: 97, bassePct: 10 }).baseM === 4500);

  // Intensità solare qualitativa: bordi esatti delle soglie
  test('sole 9 → nulla', intensitaSolare(9).etichetta === 'nulla');
  test('sole 10 → scarsa', intensitaSolare(10).etichetta === 'scarsa');
  test('sole 150 → media', intensitaSolare(150).etichetta === 'media');
  test('sole 400 → forte', intensitaSolare(400).etichetta === 'forte');
  test('sole 700 → molto forte', intensitaSolare(700).etichetta === 'molto forte');
  test('sole 950 → molto forte', intensitaSolare(950).livello === 4);
  test('sole senza dato → null', intensitaSolare(null) === null);

  // Piano di nubi dominante
  test('velo di cirri → alte', tipologiaNubi({ basse: 49, medie: 0, alte: 100, totale: 100 }) === 'alte');
  test('strato basso → basse', tipologiaNubi({ basse: 90, medie: 10, alte: 20, totale: 95 }) === 'basse');
  test('pareggio → basse (prudente)', tipologiaNubi({ basse: 50, medie: 20, alte: 50, totale: 80 }) === 'basse');
  test('quasi sereno → null', tipologiaNubi({ basse: 10, medie: 5, alte: 10, totale: 20 }) === null);
  test('piani mancanti → null', tipologiaNubi({ basse: null, medie: 0, alte: 0, totale: 90 }) === null);

  // Visibilità
  test('500 m → scarsa', classificaVisibilita(500).etichetta === 'scarsa');
  test('1 km → ridotta', classificaVisibilita(1000).etichetta === 'ridotta');
  test('4 km → discreta', classificaVisibilita(4000).etichetta === 'discreta');
  test('10 km → buona', classificaVisibilita(10000).etichetta === 'buona');
  test('24 km → ottima', classificaVisibilita(24100).etichetta === 'ottima');
  test('visibilità senza dato → null', classificaVisibilita(null) === null);

  // Cella sole: (velato) solo con sole forte sotto copertura quasi totale
  test('forte + 99% → velato', cellaSole(500, 99).includes('velato'));
  test('forte + 50% → niente velato', !cellaSole(500, 50).includes('velato'));
  test('media + 99% → niente velato', !cellaSole(200, 99).includes('velato'));
  test('cella nuvole porta il piano', cellaNuvole({ coperturaPct: 97, tipologia: 'alte', baseM: 4500, stima: false, inNube: false }).includes('alte'));
}

console.log('── Cronologia (rimozione voce) ──');
{
  cronologiaSvuota();
  cronologiaAggiungi({ id: 'a', fonte: 'gpx', nome: 'Alfa' });
  cronologiaAggiungi({ id: 'b', fonte: 'komoot', nome: 'Beta' });
  cronologiaAggiungi({ id: 'c', fonte: 'gpx', nome: 'Gamma' });
  cronologiaRimuovi('b');
  const voci = cronologiaLeggi();
  test('la voce rimossa sparisce', !voci.some((v) => v.id === 'b'));
  test('le altre restano (ordine invariato)', voci.map((v) => v.id).join(',') === 'c,a');
  cronologiaRimuovi('inesistente');
  test('rimozione di id inesistente innocua', cronologiaLeggi().length === 2);
  cronologiaSvuota();
}

console.log('── Aree protette (regole cani) ──');
{
  const molti = Array.from({ length: 25 }, (_, i) => ({ lat: 42 + i * 0.01, lon: 13 }));
  const sonde = puntiSonda(molti, 8);
  test('8 sonde da 25 campioni', sonde.length === 8);
  test('sonde: prima e ultima agli estremi', sonde[0].lat === 42 && vicino(sonde[7].lat, 42.24, 1e-9));
  test('pochi campioni → tutti sonda', puntiSonda([{ lat: 1, lon: 1 }], 8).length === 1);
  test('nessun campione → vuoto', puntiSonda([], 8).length === 0);

  const tabella = [
    { chiavi: ['gran paradiso'], classe: 'vietato', nota: 'Vietati sui sentieri', fonte: 'x', sito: 'https://pngp.it', verificato: '2026-08-17' },
  ];
  const aree = [
    { nome: 'Parco Nazionale Gran Paradiso', tipo: 'Parco nazionale', sito: null, caneOsm: null },
    { nome: 'Riserva Sconosciuta', tipo: 'Riserva naturale', sito: 'https://ente.it', caneOsm: null },
    { nome: 'Oasi Taggata', tipo: 'Area protetta', sito: null, caneOsm: 'leashed' },
  ];
  const esito = abbinaRegole(aree, tabella);
  test('abbinamento per chiave nel nome', esito[0].cani?.classe === 'vietato');
  test('sito preso dalla tabella se OSM non ce l\'ha', esito[0].sito === 'https://pngp.it');
  test('area non censita → cani null', esito[1].cani === null);
  test('tag OSM leashed → guinzaglio', esito[2].cani?.classe === 'guinzaglio');

  // Tabella REALE inclusa nel repo: copertura e abbinamenti campione
  const quiDirAree = dirname(fileURLToPath(import.meta.url));
  const reale = JSON.parse(
    readFileSync(join(quiDirAree, '../dati/parchi-cani.json'), 'utf8')
  );
  test('tabella: almeno 24 parchi censiti', reale.parchi.length >= 24, String(reale.parchi.length));
  test('tabella: ogni voce ha classe valida', reale.parchi.every((p) => ['vietato', 'guinzaglio', 'parziale', 'verifica'].includes(p.classe)));
  test('tabella: ogni voce ha fonte e sito', reale.parchi.every((p) => p.fonte && p.sito && p.chiavi?.length));
  const osmNomi = [
    ['Parco Nazionale del Gran Sasso e Monti della Laga', 'verifica'],
    ['Parco Nazionale Gran Paradiso', 'vietato'],
    ['Parco nazionale d\'Abruzzo, Lazio e Molise', 'parziale'],
    ['Parco Nazionale delle Cinque Terre', 'guinzaglio'],
  ];
  for (const [nome, attesa] of osmNomi) {
    const [m] = abbinaRegole([{ nome, tipo: 'Parco nazionale', sito: null, caneOsm: null }], reale.parchi);
    test(`abbinamento reale: ${nome.slice(0, 30)}… → ${attesa}`, m.cani?.classe === attesa, JSON.stringify(m.cani));
  }
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

  test('percepita null senza dato', percepita({}) === null);
}

console.log('');
if (falliti) {
  console.error(`${falliti} test FALLITI`);
  process.exit(1);
} else {
  console.log('Tutti i test sono verdi.');
}
