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
  distanzaAlTempo,
  applicaSosta,
} from '../js/eta.js';
import { kmQuotaMassima } from '../js/percorso.js';
import { risolviOrarioSosta } from '../js/tempo.js';
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
import { scoreCanali, fusione, canaliAttivi, scoreConvezione, descriviConvezione } from '../js/rischio.js';
import { correggiUv, classificaUv } from '../js/uv.js';
import { numeroIt, campoCsv, rigaCsv, csvCampioni, csvAvvisi, csvCompleto, nomeFileCsv } from '../js/export-csv.js';
import { candidatiPartenza, valoriAllOra, valutaFinestre } from '../js/pianificatore.js';
import { serieNormalizzate } from '../js/api/meteo.js';
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
import { albaTramontoUtc, albaTramontoPertinenti } from '../js/sole.js';
import { puntoDaTraccia, mercatorPx, scegliZoom, raggruppaPunti } from '../js/ui/marcia.js';
import { windchillC, classeCongelamento } from '../js/windchill.js';
import { mrtDiNapoli, cosszaDaToa, giornoAnnoUtc } from '../js/radiante.js';
import { stUtci } from '../js/utci-poly.js';
import { versantiDaQuote, fattoreFusione, rombo } from '../js/versante.js';
import { preparaFondo, statoFondo, sintesiFondo, pesoPioggia, descriviFondo } from '../js/fondo.js';
import { cellaFondo, renderTabella } from '../js/ui/tabella.js';
import { bloccoFondoPdf, bloccoParcheggioPdf } from '../js/ui/marcia.js';
import {
  parseCoordinate,
  distanzaAttaccoM,
  pressioneAllIstante,
  qfeDaQnh,
  qnhStandardDaQfe,
  derivaAltimetroM,
  valutaParcheggio,
} from '../js/parcheggio.js';
import { cronologiaAggiornaParcheggio } from '../js/storage.js';
import { ALTIMETRO } from '../js/config.js';

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

console.log('── Convezione (canale temporale potenziato) ──');
{
  test('CAPE 1200 da solo → 1', scoreConvezione({ cape: 1200 }) === 1);
  test('CAPE 3000 da solo → 2', scoreConvezione({ cape: 3000 }) === 2);
  test('LI −7 da solo → 2', scoreConvezione({ lifted_index: -7 }) === 2);
  test('LI −3 da solo → 1', scoreConvezione({ lifted_index: -3 }) === 1);
  test(
    'CAPE 1200 + LI −3 concordi → 2',
    scoreConvezione({ cape: 1200, lifted_index: -3 }) === 2
  );
  test(
    'CIN 150 declassa CAPE 1200 a 1, non a 0',
    scoreConvezione({ cape: 1200, convective_inhibition: 150 }) === 1
  );
  test(
    'CIN 150 azzera il solo LI −3',
    scoreConvezione({ lifted_index: -3, convective_inhibition: 150 }) === 0
  );
  test(
    'LPI 2,5 ignora il declassamento CIN',
    scoreConvezione({ lightning_potential: 2.5, convective_inhibition: 200 }) === 2
  );
  test('LPI 1 da solo → 1', scoreConvezione({ lightning_potential: 1 }) === 1);
  test(
    'CIN sentinella −1 ignorata',
    scoreConvezione({ cape: 3000, convective_inhibition: -1 }) === 2
  );
  test('tutti null → 0', scoreConvezione({}) === 0);
  test(
    'mai 3 da evidenza indiretta',
    scoreConvezione({ cape: 9999, lifted_index: -12, lightning_potential: 9 }) === 2
  );
  const wcVince = scoreCanali(
    { precipitation: 0, weather_code: 95, cape: 500, convective_inhibition: 300, wind_gusts_10m: 10, uv_index: 2 },
    15
  );
  test('wc 95 vince sul CIN → temporale 3', wcVince.temporale === 3);
  const conCin = scoreCanali(
    { precipitation: 0, weather_code: 2, cape: 1200, convective_inhibition: 150, wind_gusts_10m: 10, uv_index: 2 },
    15
  );
  test('scoreCanali usa scoreConvezione (CIN)', conCin.temporale === 1, String(conCin.temporale));

  const descr = descriviConvezione({ cape: 1800, li: -4.2, cin: 120, lpi: 1.2, fonteLi: 'GFS (NOAA)' });
  test('descrizione contiene CAPE', descr.includes('CAPE 1800'));
  test('descrizione contiene fonte LI', descr.includes('GFS'));
  test('descrizione contiene blocco CIN', descr.includes('bloccata'));
  test('descrizione a mani vuote → null', descriviConvezione({}) === null);
  test('descrizione null → null', descriviConvezione(null) === null);
  test('CIN sentinella fuori dalla descrizione', !(descriviConvezione({ cin: -1 }) || '').includes('CIN'));
}

console.log('── UV (correzione e scala OMS) ──');
{
  const su = correggiUv(6, { quotaSentieroM: 2000, quotaCellaM: 1000 });
  test('UV 6 con +1000 m → 6,6', vicino(su.uv, 6.6, 0.01), String(su.uv));
  const giu = correggiUv(6, { quotaSentieroM: 1000, quotaCellaM: 2000 });
  test('delta negativo riduce', giu.uv < 6, String(giu.uv));
  const clamp = correggiUv(6, { quotaSentieroM: 20000, quotaCellaM: 0 });
  test('clamp del fattore quota a 1,6', vicino(clamp.fattoreQuota, 1.6, 0.001));
  const neve = correggiUv(6, { quotaSentieroM: 1000, quotaCellaM: 1000, nevePrevista: true });
  test('neve prevista ×1,25', vicino(neve.uv, 7.5, 0.01), String(neve.uv));
  const senzaCella = correggiUv(6, { quotaSentieroM: 2000, quotaCellaM: null });
  test('senza quota cella nessuna correzione', senzaCella.uv === 6 && senzaCella.deltaM === 0);
  test('UV grezzo null → null', correggiUv(null, {}) === null);

  test('UV 2,9 → basso', classificaUv(2.9).etichetta === 'basso');
  test('UV 3 → moderato', classificaUv(3).etichetta === 'moderato');
  test('UV 6 → alto', classificaUv(6).etichetta === 'alto');
  test('UV 8 → molto alto', classificaUv(8).etichetta === 'molto alto');
  test('UV 11 → estremo', classificaUv(11).etichetta === 'estremo');
  test('UV null → null', classificaUv(null) === null);
  test('fascia estremo ha il viola', classificaUv(12).colore === '#a371f7');
}

console.log('── Export CSV ──');
{
  test('numeroIt virgola decimale', numeroIt(12.34, 1) === '12,3');
  test('numeroIt non finito → vuoto', numeroIt(null) === '' && numeroIt(NaN) === '');
  test('campoCsv quota il punto e virgola', campoCsv('a;b') === '"a;b"');
  test('campoCsv raddoppia le virgolette', campoCsv('a"b') === '"a""b"');
  test('campoCsv quota gli a-capo', campoCsv('a\nb') === '"a\nb"');
  test('rigaCsv termina in CRLF', rigaCsv(['a', 'b']) === 'a;b\r\n');

  const fixture = {
    nome: 'Anello del Gran Sasso',
    fonte: 'gpx',
    totKm: 12.3456,
    dPlusM: 800,
    dMinusM: 800,
    tz: 'Europe/Rome',
    partenzaIso: '2026-08-22T06:00:00.000Z',
    arrivoIso: '2026-08-22T12:30:00.000Z',
    generatoIl: Date.parse('2026-08-19T10:00:00Z'),
    modello: { nome: 'ICON-2I (ItaliaMeteo/ARPAE)' },
    avvisi: ['avviso con ; dentro'],
    campioni: [
      {
        dCumKm: 0,
        oraLocale: '08:00',
        eleM: 1500,
        percepitaC: 12.7,
        score: 1,
        canaliAttivi: [{ nome: 'pioggia', score: 1 }],
        valori: { temperature_2m: 14.2, wind_speed_10m: 10, precipitation: 0.6 },
        convezione: { cape: 800, li: -1.5, cin: 40, lpi: null },
        uv: { uv: 7.2 },
      },
      { dCumKm: 5, oraLocale: '10:00', eleM: 2000, senzaDati: true, valori: {} },
    ],
  };
  const csv = csvCompleto(fixture);
  test('BOM in testa', csv.charCodeAt(0) === 0xfeff);
  test('sezione TRATTI presente', csv.includes('TRATTI\r\n'));
  test('sezione AVVISI presente', csv.includes('AVVISI\r\n'));
  test('virgola decimale nei km', csv.includes('12,3'));
  test('avviso con ; quotato', csv.includes('"avviso con ; dentro"'));
  test('campione senza dati → n/d', csvCampioni(fixture).includes('n/d'));
  test('UV corretto nel CSV', csvCampioni(fixture).includes('7,2'));
  test('canali nel CSV', csvCampioni(fixture).includes('pioggia 1'));
  test(
    'nome file sanificato',
    nomeFileCsv(fixture) === 'meteo-trek_anello-del-gran-sasso_2026-08-22.csv',
    nomeFileCsv(fixture)
  );
  test('avvisi vuoti → riga dedicata', csvAvvisi({ avvisi: [] }).includes('nessun avviso'));
}

console.log('── Sosta pranzo a 3 modalità ──');
{
  // Percorso sintetico: 12 km, salita fino a metà poi discesa (colmo a 6 km)
  const su = tracciaSintetica({ n: 61, passoKm: 0.1, quota0: 1000, dTot: 600 });
  const giu = tracciaSintetica({ n: 61, passoKm: 0.1, quota0: 1600, dTot: -600, lat0: su[60].lat });
  const percorso = costruisciPercorso({ nome: 'colmo', fonte: 'gpx', punti: [...su, ...giu.slice(1)] });
  const base = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: null });

  // applicaSosta: slittano solo i tempi oltre la fermata
  const arr = [0, 30, 60, 90];
  test('applicaSosta slitta solo oltre', JSON.stringify(applicaSosta(arr, 60, 45)) === '[0,30,60,135]');

  // Retrocompat: dopoMin diretto ≡ dopoOre
  const conOre = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: { dopoOre: 2, durataMin: 60 } });
  const conMin = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: { dopoMin: 120, durataMin: 60 } });
  test('dopoMin 120 ≡ dopoOre 2', JSON.stringify(conOre.tCumMin) === JSON.stringify(conMin.tCumMin));
  test('eta.sosta presente con dopoOre', conOre.sosta?.dopoMin === 120 && conOre.sosta.durataMin === 60);

  // Modalità vetta: aDistanzaKm
  const vetta = kmQuotaMassima(percorso);
  // Tolleranza 20 m: lisciaQuote smussa il colmo della fixture sintetica
  test('kmQuotaMassima trova il colmo', vicino(vetta.dKm, 6, 0.15) && vicino(vetta.eleM, 1600, 20), JSON.stringify(vetta));
  const conVetta = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: { aDistanzaKm: vetta.dKm, durataMin: 45 } });
  test('vetta: totale = base + durata', vicino(conVetta.durataTotaleMin, base.durataTotaleMin + 45, 0.01));
  test('vetta: dKm esatto nel ritorno', conVetta.sosta?.dKm === vetta.dKm);
  const iPrima = 30; // punto a 3 km, prima della vetta
  test('vetta: punti prima invariati', conVetta.tCumMin[iPrima] === base.tCumMin[iPrima]);

  // Guardie
  const aZero = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: { aDistanzaKm: 0, durataMin: 45 } });
  test('vetta alla partenza → sosta null + avviso', aZero.sosta === null && aZero.avvisi.some((a) => a.includes('partenza')));
  const oltre = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: { dopoMin: base.durataTotaleMin + 60, durataMin: 45 } });
  test('orario oltre l’arrivo → sosta null + avviso', oltre.sosta === null && oltre.avvisi.some((a) => a.includes('oltre')));
  const arrivoV = calcolaEta(percorso, { mhSalita: 400, pausaMinOra: 0, sosta: { aDistanzaKm: percorso.totKm, durataMin: 45 } });
  test('vetta all’arrivo → riga sì, orari no', arrivoV.sosta !== null && vicino(arrivoV.durataTotaleMin, base.durataTotaleMin, 0.01));

  // kmQuotaMassima: casi limite
  const nulli = { punti: [{ eleM: null, dCumKm: 0 }, { eleM: null, dCumKm: 1 }] };
  test('quote tutte null → null', kmQuotaMassima(nulli) === null);
  const misti = { punti: [{ eleM: null, dCumKm: 0 }, { eleM: 900, dCumKm: 1 }, { eleM: null, dCumKm: 2 }] };
  test('quote miste: i null si saltano', kmQuotaMassima(misti).dKm === 1);
  const plateau = { punti: [{ eleM: 100, dCumKm: 0 }, { eleM: 500, dCumKm: 1 }, { eleM: 500, dCumKm: 2 }] };
  test('plateau → primo punto', kmQuotaMassima(plateau).dKm === 1);

  // risolviOrarioSosta: fuso del percorso e giorno successivo
  const p8 = Date.parse('2026-08-22T06:00:00Z'); // 08:00 locali a Roma
  test('08→13 = 300 min', risolviOrarioSosta('2026-08-22', '13:00', 'Europe/Rome', p8) === 300);
  const p23 = Date.parse('2026-08-22T21:00:00Z'); // 23:00 locali
  test('23→01 = 120 min (giorno dopo)', risolviOrarioSosta('2026-08-22', '01:00', 'Europe/Rome', p23) === 120);
  // Notte del cambio ora solare (25/10/2026): 00:30→13:00 locali = 13,5 h reali
  const pOtt = Date.parse('2026-10-24T22:30:00Z'); // 00:30 CEST del 25/10
  test('cambio ora: 00:30→13:00 = 810 min', risolviOrarioSosta('2026-10-25', '13:00', 'Europe/Rome', pOtt) === 810, String(risolviOrarioSosta('2026-10-25', '13:00', 'Europe/Rome', pOtt)));

  // valutaFinestre: override per-candidato (sosta a orario fisso)
  const t0Ms = Date.parse('2026-08-20T00:00:00Z');
  const cost = (v) => Array(24).fill(v);
  const serie1 = [{
    t0Ms,
    valori: {
      temperature_2m: cost(15), apparent_temperature: cost(14), relative_humidity_2m: cost(50),
      precipitation: cost(0), precipitation_probability: cost(5), wind_speed_10m: cost(10),
      wind_gusts_10m: cost(20), wind_direction_10m: cost(0),
      weather_code: cost(1).map((v, h) => (h === 10 || h === 11 ? 95 : v)), cape: cost(100),
    },
  }];
  const campione1 = [{ lat: 46, lon: 11, eleM: 1500, dCumKm: 10 }];
  const candBase = { partenzaUtcMs: t0Ms, dataIso: '2026-08-20', oraLocale: '02:00' };
  const candOverride = { ...candBase, offsetMin: [720], durataTotaleMin: 780 };
  const [senza, con] = valutaFinestre({
    candidati: [candBase, candOverride],
    offsetMin: [600],
    campioni: campione1,
    serieCampioni: serie1,
    orizzonteMs: t0Ms + 96 * 3600000,
    arrivoLatLon: null,
    durataTotaleMin: 600,
  });
  test('senza override: campione nel temporale', senza.scoreMax === 3);
  test('override sposta il campione fuori dal temporale', con.scoreMax === 0, JSON.stringify(con.peggior));
  test('override cambia l’arrivo', con.arrivoUtcMs === t0Ms + 780 * 60000 && senza.arrivoUtcMs === t0Ms + 600 * 60000);

  // CSV: riga meta della sosta col motivo
  const rCsv = {
    nome: 'x', totKm: 10, dPlusM: 1, dMinusM: 1, tz: 'Europe/Rome',
    partenzaIso: '2026-08-22T06:00:00.000Z', arrivoIso: '2026-08-22T12:00:00.000Z',
    generatoIl: Date.parse('2026-08-19T10:00:00Z'), modello: { nome: 'm' }, avvisi: [], campioni: [],
    sosta: { dKm: 6, durataMin: 45, oraInizio: '12:00', oraFine: '12:45', motivo: 'in vetta (1600 m)' },
  };
  test('CSV: riga sosta col motivo', csvCompleto(rCsv).includes('in vetta (1600 m)'));
  const { sosta: _s, ...rSenza } = rCsv;
  test('CSV: risultato senza sosta invariato', !csvCompleto(rSenza).includes('sosta pranzo'));
}

console.log('── Fix review: tramonto notturno, CSV injection, GPX ──');
{
  // Arrivo alle 01:00Z a Roma: albaTramontoUtc aggancerebbe il tramonto
  // della sera SUCCESSIVA (margine +17 h); il pertinente guarda la notte
  // in corso e dà margine negativo
  const arrivoNotte = new Date('2026-08-20T01:00:00Z');
  const ingenuo = albaTramontoUtc(arrivoNotte, 41.9, 12.5);
  const pertinente = albaTramontoPertinenti(arrivoNotte, 41.9, 12.5);
  test('arrivo notturno: il tramonto ingenuo è nel futuro', ingenuo.tramontoUtc.getTime() > arrivoNotte.getTime());
  test('arrivo notturno: il tramonto pertinente è già passato', pertinente.tramontoUtc.getTime() < arrivoNotte.getTime(), pertinente.tramontoUtc.toISOString());
  // Arrivo diurno: nessun cambiamento
  const arrivoGiorno = new Date('2026-08-20T15:00:00Z');
  test(
    'arrivo diurno: pertinente = ingenuo',
    albaTramontoPertinenti(arrivoGiorno, 41.9, 12.5).tramontoUtc.getTime() ===
      albaTramontoUtc(arrivoGiorno, 41.9, 12.5).tramontoUtc.getTime()
  );

  // CSV injection: formule neutralizzate, numeri negativi intatti
  test('campoCsv neutralizza =formula', campoCsv('=1+2').startsWith("'"));
  test('campoCsv neutralizza @cmd', campoCsv('@cmd').startsWith("'"));
  test('campoCsv neutralizza -testo', campoCsv('-testo').startsWith("'"));
  test('campoCsv lascia i numeri negativi', campoCsv('-5,0') === '-5,0');
  test('numeroIt negativo resta esente', campoCsv(numeroIt(-5.04, 1)) === '-5,0');

  // Nome file con data LOCALE: partenza 23:30 locale del 21/08 = 21:30Z
  const rNotte = { nome: 'x', partenzaIso: '2026-08-21T21:30:00Z', tz: 'Europe/Rome' };
  test('nome file col giorno locale', nomeFileCsv(rNotte).includes('2026-08-21'), nomeFileCsv(rNotte));
  const rDopoMezzanotte = { nome: 'x', partenzaIso: '2026-08-21T22:30:00Z', tz: 'Europe/Rome' };
  test('partenza 00:30 locale → giorno dopo', nomeFileCsv(rDopoMezzanotte).includes('2026-08-22'));

  // GPX: traccia degenere a 1 punto + rotta completa → vince la rotta
  const gpxMisto = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="46" lon="11"></trkpt></trkseg></trk>
    <rte><rtept lat="46" lon="11"></rtept><rtept lat="46.01" lon="11"></rtept></rte></gpx>`;
  test('GPX con 1 trkpt spurio → fallback rtept', parseGpx(gpxMisto).punti.length === 2);
}

console.log('── Distanza al tempo (posizione sosta) ──');
{
  // Profilo lineare: 10 km in 200 min → a 100 min si è a 5 km
  const cum = [0, 2.5, 5, 7.5, 10];
  const lineare = [0, 50, 100, 150, 200];
  test('profilo lineare: metà tempo = metà strada', vicino(distanzaAlTempo(cum, lineare, 100), 5, 0.01));
  // Con sosta di 60 min al km 5 (salto quasi verticale fra trackpoint
  // ravvicinati, come sulle tracce reali): un istante dentro il salto
  // risolve al km della fermata
  const cumFitti = [0, 2.5, 5, 5.01, 7.5, 10];
  const conSosta = [0, 50, 100, 160.2, 210, 260];
  test('istante dentro la sosta → km della fermata', vicino(distanzaAlTempo(cumFitti, conSosta, 130), 5, 0.05), String(distanzaAlTempo(cumFitti, conSosta, 130)));
  test('oltre il totale → fine percorso', vicino(distanzaAlTempo(cum, lineare, 999), 10, 0.01));
  test('tempo zero → partenza', vicino(distanzaAlTempo(cum, lineare, 0), 0, 0.01));
}

console.log('── Pianificatore: candidati ──');
{
  // 19/08/2026 10:00Z = 12:00 locali a Roma (ora legale, UTC+2)
  const adessoMs = Date.parse('2026-08-19T10:00:00Z');
  const cand = candidatiPartenza({ adessoMs, tz: 'Europe/Rome' });
  test('nessun candidato nel passato', cand.every((c) => c.partenzaUtcMs >= adessoMs + 30 * 60000));
  test(
    'fascia 04-14 rispettata',
    cand.every((c) => {
      const h = parseInt(c.oraLocale, 10);
      return h >= 4 && h <= 14;
    })
  );
  test('ordinati e senza duplicati', cand.every((c, i) => i === 0 || c.partenzaUtcMs > cand[i - 1].partenzaUtcMs));
  test(
    'primo candidato oggi alle 13 locali',
    cand[0].dataIso === '2026-08-19' && cand[0].oraLocale === '13:00',
    JSON.stringify(cand[0])
  );
  test('tutti entro 72 h', cand.every((c) => c.partenzaUtcMs <= adessoMs + 72 * 3600000));
  // Il 20/08 alle 08:00 locali = 06:00Z (ora legale)
  const otto20 = cand.find((c) => c.dataIso === '2026-08-20' && c.oraLocale === '08:00');
  test('conversione locale→UTC (estate)', otto20?.partenzaUtcMs === Date.parse('2026-08-20T06:00:00Z'));

  // Cavallo del cambio ora legale→solare (25/10/2026): nessun duplicato,
  // le 08:00 locali del 26/10 sono le 07:00Z (UTC+1)
  const adessoOtt = Date.parse('2026-10-24T20:00:00Z');
  const candOtt = candidatiPartenza({ adessoMs: adessoOtt, tz: 'Europe/Rome' });
  const chiavi = candOtt.map((c) => `${c.dataIso}|${c.oraLocale}`);
  test('cambio ora: nessun duplicato', new Set(chiavi).size === chiavi.length);
  const otto26 = candOtt.find((c) => c.dataIso === '2026-10-26' && c.oraLocale === '08:00');
  test('cambio ora: 08:00 del 26/10 = 07:00Z', otto26?.partenzaUtcMs === Date.parse('2026-10-26T07:00:00Z'));
}

console.log('── Pianificatore: estrazione e valutazione ──');
{
  const t0Ms = Date.parse('2026-08-20T00:00:00Z');
  const nOre = 84;
  // Serie costante con override per finestre orarie [da, a)
  const costante = (v) => Array(nOre).fill(v);
  const conFinestra = (v, da, a, dentro) => {
    const arr = costante(v);
    for (let h = da; h < a; h++) arr[h] = dentro;
    return arr;
  };
  const serieBase = (override = {}) => ({
    t0Ms,
    valori: {
      temperature_2m: costante(15),
      apparent_temperature: costante(14),
      relative_humidity_2m: costante(50),
      precipitation: costante(0),
      precipitation_probability: costante(5),
      wind_speed_10m: costante(10),
      wind_gusts_10m: costante(20),
      wind_direction_10m: costante(0),
      weather_code: costante(1),
      cape: costante(100),
      ...override,
    },
  });

  // valoriAllOra: stretta, non ±3
  const conBuchi = { t0Ms, valori: { x: [1, null, null, null, 5] } };
  test('valoriAllOra indice esatto', valoriAllOra(conBuchi, t0Ms + 4 * 3600000).valori.x === 5);
  test('valoriAllOra buco singolo ±1', valoriAllOra(conBuchi, t0Ms + 1 * 3600000).valori.x === 1);
  test(
    'valoriAllOra NON eredita il ±3',
    valoriAllOra(conBuchi, t0Ms + 2 * 3600000) === null,
    JSON.stringify(valoriAllOra(conBuchi, t0Ms + 2 * 3600000))
  );
  test('valoriAllOra fuori finestra → null', valoriAllOra(conBuchi, t0Ms - 3600000) === null);

  // Scenario: temporale (wc 95) nelle ore 30-35 della serie
  const campioni = [
    { lat: 46, lon: 11, eleM: 1500, dCumKm: 0 },
    { lat: 46.05, lon: 11, eleM: 1800, dCumKm: 6 },
  ];
  const serieTemporale = [
    serieBase({ weather_code: conFinestra(1, 30, 36, 95) }),
    serieBase({ weather_code: conFinestra(1, 30, 36, 95) }),
  ];
  const candidati = [
    // attraversa la finestra: partenza ora 29, arrivo ora 33
    { partenzaUtcMs: t0Ms + 29 * 3600000, dataIso: '2026-08-21', oraLocale: '07:00' },
    // la evita del tutto
    { partenzaUtcMs: t0Ms + 40 * 3600000, dataIso: '2026-08-21', oraLocale: '18:00' },
  ];
  const finestre = valutaFinestre({
    candidati,
    offsetMin: [0, 240],
    campioni,
    serieCampioni: serieTemporale,
    orizzonteMs: t0Ms + 84 * 3600000,
    arrivoLatLon: null,
    durataTotaleMin: 240,
  });
  test('candidato nel temporale → score 3', finestre[0].scoreMax === 3, JSON.stringify(finestre[0]));
  test('canale peggiore = temporale', finestre[0].peggior?.canali?.[0]?.nome === 'temporale');
  test('candidato fuori → score 0', finestre[1].scoreMax === 0);
  test(
    'distribuzione somma ai campioni',
    finestre[0].distribuzione.reduce((s, n) => s + n, 0) === campioni.length
  );

  // Oltre orizzonte: nessuno score
  const oltre = valutaFinestre({
    candidati: [candidati[1]],
    offsetMin: [0, 240],
    campioni,
    serieCampioni: serieTemporale,
    orizzonteMs: t0Ms + 42 * 3600000, // arrivo a 44h > 42h
    arrivoLatLon: null,
    durataTotaleMin: 240,
  })[0];
  test('oltre orizzonte → stato dichiarato', oltre.stato === 'oltreOrizzonte');
  test('oltre orizzonte → niente numeri finti', oltre.scoreMax === null && oltre.distribuzione === null);

  // Bump PoP dall'ensemble con mm sotto soglia (pioggia 0,3 mm, PoP nulla)
  const seriePop = [
    serieBase({ precipitation: costante(0.3), precipitation_probability: costante(null) }),
    serieBase({ precipitation: costante(0.3), precipitation_probability: costante(null) }),
  ];
  const popSerie = [
    { t0Ms, popKN: costante(80) },
    { t0Ms, popKN: costante(80) },
  ];
  const conPop = valutaFinestre({
    candidati: [candidati[0]],
    offsetMin: [0, 240],
    campioni,
    serieCampioni: seriePop,
    popSerie,
    orizzonteMs: t0Ms + 84 * 3600000,
    arrivoLatLon: null,
    durataTotaleMin: 240,
  })[0];
  const senzaPop = valutaFinestre({
    candidati: [candidati[0]],
    offsetMin: [0, 240],
    campioni,
    serieCampioni: seriePop,
    popSerie: null,
    orizzonteMs: t0Ms + 84 * 3600000,
    arrivoLatLon: null,
    durataTotaleMin: 240,
  })[0];
  test('PoP ensemble → bump pioggia a 1', conPop.scoreMax === 1, JSON.stringify(conPop.peggior));
  test('senza PoP niente bump', senzaPop.scoreMax === 0);

  // Esposizione risolta sull'ORA: direzione del vento che cambia fra le
  // ore fa cambiare lo score fra candidati contigui (raffiche 55 km/h:
  // sotto soglia col fattore 0,6, sopra col fattore 1,3)
  const profilo = { f8: [1.3, 1.3, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6], classi8: ['cresta', 'cresta', 'riparo', 'riparo', 'riparo', 'riparo', 'riparo', 'riparo'] };
  const serieVento = [
    serieBase({ wind_gusts_10m: costante(55), wind_direction_10m: conFinestra(180, 10, 12, 0) }),
  ];
  const ventoRes = valutaFinestre({
    candidati: [
      { partenzaUtcMs: t0Ms + 10 * 3600000, dataIso: 'x', oraLocale: '10:00' }, // dir 0 → cresta 1,3
      { partenzaUtcMs: t0Ms + 14 * 3600000, dataIso: 'x', oraLocale: '14:00' }, // dir 180 → riparo 0,6
    ],
    offsetMin: [0],
    campioni: [campioni[0]],
    serieCampioni: serieVento,
    profiliEspo: [profilo],
    orizzonteMs: t0Ms + 84 * 3600000,
    arrivoLatLon: null,
    durataTotaleMin: 60,
  });
  test('esposizione oraria cambia lo score', ventoRes[0].scoreMax > ventoRes[1].scoreMax, JSON.stringify(ventoRes.map((f) => f.scoreMax)));

  // Tramonto: arrivo 30 min prima → stretto; 2 h dopo → dopo
  const tramontoRif = albaTramontoUtc(new Date('2026-08-22T12:00:00Z'), 42, 13).tramontoUtc;
  const serie84 = [serieBase()];
  const trRes = valutaFinestre({
    candidati: [
      { partenzaUtcMs: tramontoRif.getTime() - 30 * 60000 - 60 * 60000, dataIso: 'x', oraLocale: 'y' },
      { partenzaUtcMs: tramontoRif.getTime() + 2 * 3600000 - 60 * 60000, dataIso: 'x', oraLocale: 'y' },
    ],
    offsetMin: [0],
    campioni: [{ lat: 42, lon: 13, eleM: 1000, dCumKm: 0 }],
    serieCampioni: serie84,
    orizzonteMs: Number.POSITIVE_INFINITY,
    arrivoLatLon: { lat: 42, lon: 13 },
    durataTotaleMin: 60,
  });
  test('arrivo a 30 min dal tramonto → stretto', trRes[0].tramonto?.classe === 'stretto', JSON.stringify(trRes[0].tramonto));
  test('arrivo dopo il tramonto → dopo', trRes[1].tramonto?.classe === 'dopo' && trRes[1].tramonto.margineMin < 0);

  // serieNormalizzate: da una località finta a {t0Ms, valori}
  const loc = {
    hourly: {
      time: ['2026-08-20T00:00', '2026-08-20T01:00'],
      temperature_2m: [10, 11],
      cape: [null, 200],
    },
  };
  const norm = serieNormalizzate(loc, ['temperature_2m', 'cape'], 'icon_d2');
  test('serieNormalizzate: t0Ms corretto', norm.t0Ms === t0Ms);
  test('serieNormalizzate: serie intere', norm.valori.temperature_2m[1] === 11 && norm.valori.cape[0] === null);
  test('serieNormalizzate: fuori dominio → null', serieNormalizzate({ hourly: { time: ['2026-08-20T00:00'], temperature_2m: [null] } }, ['temperature_2m'], 'x') === null);
  test('serieNormalizzate: hourly assente → null', serieNormalizzate({}, ['temperature_2m'], 'x') === null);
}

console.log('── Versante solare (aspect dal DEM) ──');
{
  // Pendio planare: quota = centro + p·r·cos(θ). p>0 = sale verso nord,
  // quindi il versante GUARDA a sud. Sonde nell'ordine deterministico di
  // puntiSondaEsposizione: [centro, dir0×raggi, dir1×raggi, …].
  const RAGGI = [300, 600, 1200];
  function quotePendio(p, centro = 1000) {
    const q = [centro];
    for (let di = 0; di < 8; di++) {
      const rad = (di * 45 * Math.PI) / 180;
      for (const r of RAGGI) q.push(centro + p * r * Math.cos(rad));
    }
    return q;
  }
  const camp = [{ lat: 46, lon: 11, eleM: 1000 }];

  const sud = versantiDaQuote(camp, quotePendio(0.2))[0];
  test('pendio che scende a sud → aspect 180°', vicino(sud.aspectGradi, 180, 1), String(sud.aspectGradi));
  test('pendio a sud → pendenza 20%', vicino(sud.pendenzaPct, 20, 0.5), String(sud.pendenzaPct));
  test('versante sud → fusione ×1,4', vicino(sud.fattoreFusione, 1.4, 0.01), String(sud.fattoreFusione));
  test('versante sud → rombo S', sud.nome === 'S', sud.nome);

  const nord = versantiDaQuote(camp, quotePendio(-0.2))[0];
  test('pendio che scende a nord → aspect 0°', vicino(((nord.aspectGradi + 180) % 360) - 180, 0, 1), String(nord.aspectGradi));
  test('versante nord → fusione ×0,6 (neve che dura)', vicino(nord.fattoreFusione, 0.6, 0.01), String(nord.fattoreFusione));

  const piano = versantiDaQuote(camp, quotePendio(0))[0];
  test('pianoro → nessuna correzione di fusione', piano.fattoreFusione === 1, String(piano.fattoreFusione));

  // Pendenza sotto la soglia: l'effetto si smorza in proporzione, non a scalino
  test('pendenza 5% a sud → fusione a metà ampiezza', vicino(fattoreFusione(180, 5), 1.2, 0.01), String(fattoreFusione(180, 5)));
  test('est e ovest → nessuna correzione', vicino(fattoreFusione(90, 30), 1, 0.01) && vicino(fattoreFusione(270, 30), 1, 0.01));
  test('DEM assente → fattore 1', versantiDaQuote(camp, null) === null);
  test('rombo 200° → S', rombo(200) === 'S', rombo(200));
}

console.log('── Stato del fondo (fango, neve, ghiaccio) ──');
{
  const N = 200;
  const IDX = 150;
  const ISTANTE = IDX * 3600000;
  // Costruttore di serie sintetiche: ogni variabile è un valore costante
  // oppure una funzione dell'indice orario
  function serieFondo(spec, n = N) {
    const base = {
      rain: 0,
      snowfall: 0,
      snow_depth: 0,
      temperature_2m: 5,
      soil_temperature_0cm: 5,
      et0_fao_evapotranspiration: 0,
    };
    const valori = {};
    for (const [k, def] of Object.entries({ ...base, ...spec })) {
      valori[k] = Array.from({ length: n }, (_, i) => (typeof def === 'function' ? def(i) : def));
    }
    return { t0Ms: 0, valori };
  }
  const stato = (spec, opzioni = {}, n = N) =>
    statoFondo(preparaFondo(serieFondo(spec, n)), {
      istanteMs: ISTANTE,
      quotaM: 1500,
      ...opzioni,
    });

  test('peso pioggia: ultime 24 h a peso pieno', pesoPioggia(3) === 1);
  test('peso pioggia: 60 h fa a peso ridotto', pesoPioggia(60) === 0.3);
  test('peso pioggia: oltre la finestra → 0', pesoPioggia(100) === 0);

  // ── Fango ──
  const fangoso = stato({ rain: (i) => (i > IDX - 21 && i <= IDX ? 1 : 0) });
  test('21 mm nelle ultime 21 h → fangoso', fangoso.classe === 'fangoso', JSON.stringify(fangoso.fango));
  test('fango: bilancio netto ≈ 21 mm', vicino(fangoso.fango.mmNetti, 21, 0.1), String(fangoso.fango.mmNetti));
  test('fango NON entra nel rischio complessivo', fangoso.scoreRischio === 0, String(fangoso.scoreRischio));

  const asciugato = stato({
    rain: (i) => (i > IDX - 70 && i < IDX - 60 ? 1 : 0),
    et0_fao_evapotranspiration: 0.15,
  });
  test('pioggia vecchia + evaporazione → asciutto', asciugato.classe === 'asciutto', JSON.stringify(asciugato.fango));

  // Rovescio violento: netti azzerati dall'evaporazione, ma il sentiero
  // resta inciso → l'avviso deve scattare lo stesso
  const rovescio = stato({
    rain: (i) => (i === IDX - 5 ? 21 : 0),
    et0_fao_evapotranspiration: 0.5,
  });
  test('rovescio 21 mm/h → livello 2 anche con bilancio a zero', rovescio.fango.livello === 2 && rovescio.fango.rovescio, JSON.stringify(rovescio.fango));

  // ── Neve ──
  const nevoso = stato({
    snowfall: (i) => (i > IDX - 6 && i <= IDX ? 2 : 0),
    temperature_2m: -3,
    soil_temperature_0cm: -3,
  });
  test('12 cm di neve fresca col gelo → classe neve', nevoso.classe === 'neve', JSON.stringify(nevoso.neve));
  test('neve continua → livello 2', nevoso.neve.livello === 2, String(nevoso.neve.cm));
  test('neve entra nel rischio con tetto 2', nevoso.scoreRischio === 2, String(nevoso.scoreRischio));

  const nevefusa = stato({
    snowfall: (i) => (i === IDX - 100 ? 10 : 0),
    temperature_2m: (i) => (i > IDX - 100 ? 10 : -1),
  });
  test('neve caduta e poi 4 giorni a 10 °C → fusa', nevefusa.neve.cm < 1, String(nevefusa.neve.cm));

  // Il manto del modello vede anche il nevaio caduto PRIMA della finestra
  const nevaio = stato({ snow_depth: 0.25, temperature_2m: -5, soil_temperature_0cm: -5 });
  test('manto del modello 25 cm → neve al suolo', vicino(nevaio.neve.cm, 25, 0.1), String(nevaio.neve.cm));

  // Versante nord: la stessa neve resiste di più
  const spec = { snowfall: (i) => (i === IDX - 90 ? 20 : 0), temperature_2m: 2 };
  const aSud = stato(spec, { versante: { nome: 'S', aspectGradi: 180, pendenzaPct: 25, fattoreFusione: 1.4 } });
  const aNord = stato(spec, { versante: { nome: 'N', aspectGradi: 0, pendenzaPct: 25, fattoreFusione: 0.6 } });
  test('a nord resta più neve che a sud', aNord.neve.cm > aSud.neve.cm, `${aNord.neve.cm} vs ${aSud.neve.cm}`);

  // ── Ghiaccio ──
  const ghiaccio = stato({
    rain: (i) => (i === IDX - 30 ? 2 : 0),
    soil_temperature_0cm: (i) => (i >= IDX - 17 && i < IDX - 2 ? -2 : 2),
  });
  test('acqua in 48 h + gelo notturno → ghiaccio probabile', ghiaccio.ghiaccio.esito === 'probabile', JSON.stringify(ghiaccio.ghiaccio));
  test('ghiaccio probabile → livello 2 nel rischio', ghiaccio.scoreRischio === 2);
  test('gelo letto sul suolo, non sull’aria', ghiaccio.ghiaccio.fonteT === 'suolo');

  const geloAsciutto = stato({ rain: 0, soil_temperature_0cm: -5, temperature_2m: -5 });
  test('freddo SENZA acqua → nessun ghiaccio', geloAsciutto.ghiaccio.esito === 'no' && geloAsciutto.classe === 'asciutto');

  const ghiaccioOra = stato({
    rain: (i) => (i === IDX - 10 ? 3 : 0),
    soil_temperature_0cm: (i) => (i >= IDX - 8 ? -1 : 3),
  });
  test('suolo sotto zero al passaggio → ghiaccio certo (livello 3)', ghiaccioOra.ghiaccio.esito === 'certo' && ghiaccioOra.scoreRischio === 3, JSON.stringify(ghiaccioOra.ghiaccio));

  // Crosta dura: neve residua + ciclo gelo-disgelo. Aria sempre sotto zero
  // (nessuna fusione), suolo che oscilla attorno allo zero.
  const crosta = stato({
    snowfall: (i) => (i === IDX - 60 ? 5 : 0),
    temperature_2m: -1,
    soil_temperature_0cm: (i) => (i >= IDX - 30 && i < IDX - 20 ? 1 : -1),
  });
  test('neve + ciclo gelo-disgelo → crosta dura', crosta.ghiaccio.esito === 'crosta', JSON.stringify(crosta.ghiaccio));
  test('crosta dura → livello massimo di rischio', crosta.scoreRischio === 3 && crosta.livello === 3);
  test('crosta: almeno un ciclo contato', crosta.ghiaccio.cicli >= 1, String(crosta.ghiaccio.cicli));

  // ── Prudenza sui dati mancanti ──
  const corto = statoFondo(preparaFondo(serieFondo({}, 40)), { istanteMs: 39 * 3600000, quotaM: 1500 });
  test('finestra troppo corta → ignoto, MAI asciutto', corto.classe === 'ignoto' && corto.dati === 'assenti', JSON.stringify(corto.motivo));
  test('stato ignoto → nessun punteggio di rischio', corto.scoreRischio === 0 && corto.livello === 0);
  test('serie assente → ignoto', statoFondo(null, { istanteMs: 0 }).classe === 'ignoto');
  test('istante fuori finestra → ignoto', stato({}, {}, N).classe !== undefined && statoFondo(preparaFondo(serieFondo({})), { istanteMs: 900 * 3600000 }).classe === 'ignoto');
  test('preparaFondo su serie vuota → null', preparaFondo(null) === null);

  // ── Valanghe: rimando al bollettino, mai un grado calcolato ──
  const valanga = stato(
    { snowfall: (i) => (i > IDX - 20 && i <= IDX ? 2 : 0), temperature_2m: -4, soil_temperature_0cm: -4 },
    { versante: { nome: 'N', aspectGradi: 0, pendenzaPct: 70, fattoreFusione: 0.6 } }
  );
  test('40 cm in 72 h su pendio a 70% → rimando al bollettino', valanga.neve.valanga === true, JSON.stringify(valanga.neve));
  const valangaDolce = stato(
    { snowfall: (i) => (i > IDX - 20 && i <= IDX ? 2 : 0), temperature_2m: -4 },
    { versante: { nome: 'N', aspectGradi: 0, pendenzaPct: 12, fattoreFusione: 0.6 } }
  );
  test('stessa neve su pendio dolce → nessun rimando valanghe', valangaDolce.neve.valanga === false);

  // ── Quota alta: la stima residua perde significato ──
  const alta = stato({ snow_depth: 0.4, temperature_2m: -5, soil_temperature_0cm: -5 }, { quotaM: 2800 });
  test('sopra 2500 m → limite dichiarato nel testo', alta.neve.quotaStabile === true && /2\.500 m/.test(alta.testo));

  // ── Testo e cella ──
  test('testo del fondo non vuoto', typeof fangoso.testo === 'string' && fangoso.testo.length > 10);
  test('descriviFondo su ignoto non mente', /non valutabile/.test(descriviFondo(corto)));
  test('cella tabella senza dato → trattino', cellaFondo(null) === '–');
  test('cella tabella su neve mostra i cm', /cm/.test(cellaFondo(nevoso)));

  // ── Sintesi di percorso ──
  const campioniS = [
    { eleM: 900, dCumKm: 0 },
    { eleM: 1800, dCumKm: 5 },
    { eleM: 2100, dCumKm: 9 },
  ];
  const sint = sintesiFondo([asciugato, nevoso, nevoso], campioniS);
  test('sintesi: classe peggiore = neve', sint.classe === 'neve', sint.classe);
  test('sintesi: quota di inizio del problema', sint.quotaInizioM === 1800, String(sint.quotaInizioM));
  test('sintesi: conteggio dei tratti coinvolti', sint.trattiClasse === 2 && sint.totale === 3);
  const sintIgnota = sintesiFondo([corto, corto], campioniS);
  test('sintesi tutta ignota → dichiarata', sintIgnota.classe === 'ignoto' && sintIgnota.ignoti === 2);

  // ── Innesto nel rischio a canali ──
  test('canale fondo assente se non calcolato', scoreCanali({}, 10).fondo === undefined);
  test('canale fondo presente se calcolato', scoreCanali({}, 10, 3).fondo === 3);
  test('canale fondo clampato a 0-3', scoreCanali({}, 10, 9).fondo === 3);
  test('fusione prende il fondo quando è il peggiore', fusione(scoreCanali({}, 10, 3)) === 3);
  test('fondo fra i canali attivi', canaliAttivi(scoreCanali({}, 10, 2)).some((k) => k.nome.startsWith('fondo')));

  // ── Coerenza della tabella: colonne di testata = celle per riga ──
  // Con una colonna nuova è facilissimo scordare un colspan o un <td>:
  // la tabella slitterebbe di una cella senza errori a console.
  {
    const finto = { innerHTML: '', hidden: true, querySelectorAll: () => [] };
    const campioniT = [
      { dCumKm: 0, oraLocale: '08:00', eleM: 1000, valori: {}, score: 0, fondo: nevoso, canaliAttivi: [] },
      { dCumKm: 4, oraLocale: '10:00', eleM: 1800, valori: {}, score: 1, fondo: fangoso, canaliAttivi: [] },
    ];
    renderTabella(finto, {
      campioni: campioniT,
      unitaVento: 'kmh',
      sosta: { durataMin: 30, dKm: 2, oraInizio: '12:00', oraFine: '12:30', motivo: '' },
    });
    const html = finto.innerHTML;
    const nTh = (html.match(/<th>/g) || []).length;
    const primaRiga = html.split('<tr class="riga-dati"')[1]?.split('</tr>')[0] ?? '';
    const nTd = (primaRiga.match(/<td>/g) || []).length;
    test('tabella: celle per riga = colonne di testata', nTh === nTd, `${nTh} th vs ${nTd} td`);
    const colspan = [...html.matchAll(/colspan="(\d+)"/g)].map((m) => Number(m[1]));
    test('tabella: ogni colspan copre tutte le colonne', colspan.length > 0 && colspan.every((c) => c === nTh), `${JSON.stringify(colspan)} vs ${nTh}`);
    test('tabella: la colonna fondo compare in testata', /<th>fondo<\/th>/.test(html));
  }

  // ── PDF: senza dati il riquadro parla, non tace ──
  test(
    'PDF: fondo non valutabile dichiarato',
    /non valutabile/.test(bloccoFondoPdf({ fondoSintesi: null, fondoAttivo: true }))
  );
  test(
    'PDF: risultato salvato vecchio → nessun riquadro inventato',
    bloccoFondoPdf({}) === ''
  );
  test(
    'PDF: funzione spenta → nessun riquadro',
    bloccoFondoPdf({ fondoSintesi: sint, fondoAttivo: false }) === ''
  );
}

console.log('── Parcheggio e altimetro ──');
{
  // ── parseCoordinate ──
  const ok = (s) => {
    const c = parseCoordinate(s);
    return !!c && vicino(c.lat, 42.4428, 1e-9) && vicino(c.lon, 13.5582, 1e-9);
  };
  test('coord: punto decimale e virgola', ok('42.4428, 13.5582'));
  test('coord: punto decimale e spazio', ok('42.4428 13.5582'));
  test('coord: punto decimale e punto e virgola senza spazi', ok('42.4428;13.5582'));
  test('coord: virgola decimale e spazio', ok('42,4428 13,5582'));
  test('coord: virgola decimale e punto e virgola', ok('42,4428; 13,5582'));
  test('coord: prefissi N/E staccati', ok('N 42.4428 E 13.5582'));
  test('coord: suffissi N/E attaccati', ok('42.4428N, 13.5582E'));
  test('coord: suffissi N/E staccati', ok('42.4428 N, 13.5582 E'));
  test('coord: parole lat/lon con due punti', ok('lat: 42.4428, lon: 13.5582'));
  test('coord: longitudine scritta per prima con lettere → scambiata', ok('13.5582 E 42.4428 N'));
  test('coord: «e» staccata fra i numeri = prefisso del secondo', ok('42.4428 e 13.5582'));
  test('coord: parentesi e spazi spurî', ok('  (42.4428, 13.5582)  '));
  const sud = parseCoordinate('42.4428 S, 13.5582 W');
  test('coord: S e W negativi', !!sud && sud.lat === -42.4428 && sud.lon === -13.5582, JSON.stringify(sud));
  const neg = parseCoordinate('-42.5, -13.2');
  test('coord: segni espliciti', !!neg && neg.lat === -42.5 && neg.lon === -13.2);
  test('coord: tre numeri → null', parseCoordinate('42.4428, 13.5582, 100') === null);
  test('coord: un numero → null', parseCoordinate('42.4428') === null);
  test('coord: lat fuori range → null', parseCoordinate('95, 13') === null);
  test('coord: lon fuori range → null', parseCoordinate('42, 181') === null);
  test('coord: lettere incoerenti → null', parseCoordinate('42.4428 E, 13.5582 W') === null);
  test(
    'coord: vuoto e testo → null',
    parseCoordinate('') === null && parseCoordinate('parcheggio') === null && parseCoordinate(null) === null
  );
  test('coord: gradi-minuti-secondi non supportati → null', parseCoordinate('42°26\'34"N 13°33\'30"E') === null);

  // ── distanzaAttaccoM ──
  test(
    'distanza attacco ≈ 968 m',
    vicino(distanzaAttaccoM({ lat: 42.4428, lon: 13.5582 }, { lat: 42.4428, lon: 13.57 }), 968, 2),
    String(distanzaAttaccoM({ lat: 42.4428, lon: 13.5582 }, { lat: 42.4428, lon: 13.57 }))
  );
  test('distanza attacco 1° di lat ≈ 111,2 km', vicino(distanzaAttaccoM({ lat: 42, lon: 13 }, { lat: 43, lon: 13 }), 111195, 50));
  test('distanza attacco stesso punto = 0', distanzaAttaccoM({ lat: 42, lon: 13 }, { lat: 42, lon: 13 }) === 0);
  test('distanza attacco senza punto → null', distanzaAttaccoM({ lat: 42, lon: 13 }, null) === null);

  // ── qfeDaQnh (ipsometrica) ──
  const qfeCI = qfeDaQnh(1018.7, 2133, 11.5);
  test('QFE Campo Imperatore ≈ 793,4 mbar (modello 793,4)', vicino(qfeCI, 793.4, 1), String(qfeCI));
  test('QFE a quota 0 = QNH', qfeDaQnh(1018.7, 0, 11.5) === 1018.7);
  test('QFE 1000 m ISA-like ≈ 901,2', vicino(qfeDaQnh(1013.25, 1000, 15), 901.2, 0.5), String(qfeDaQnh(1013.25, 1000, 15)));
  test('QFE cresce con la temperatura', qfeDaQnh(1013.25, 1000, 25) > qfeDaQnh(1013.25, 1000, 5));
  test('QFE con ingresso mancante → null', qfeDaQnh(null, 2133, 11.5) === null && qfeDaQnh(1018.7, 2133, null) === null);

  // ── qnhStandardDaQfe (quello che mostra l'orologio) ──
  test('QNH standard da 793,4 mbar a 2133 m ≈ 1028,1', vicino(qnhStandardDaQfe(793.4, 2133), 1028.1, 0.3), String(qnhStandardDaQfe(793.4, 2133)));
  test('QNH standard a quota 0 = QFE', qnhStandardDaQfe(1013.25, 0) === 1013.25);
  test('QNH standard: inversa dell’ISA a 1000 m', vicino(qnhStandardDaQfe(898.75, 1000), 1013.25, 0.1));

  // ── derivaAltimetroM ──
  const d3 = derivaAltimetroM(1018.7, 1015.7, 793, 11.5);
  test('deriva: −3 mbar a 793 mbar, 11,5 °C → ≈ +31,5 m', vicino(d3, 31.5, 0.5), String(d3));
  test('deriva: pressione in aumento → negativa (≈ −21,0 m)', vicino(derivaAltimetroM(1018.7, 1020.7, 793, 11.5), -21.0, 0.5));
  test('deriva: nessuna variazione → 0', derivaAltimetroM(1018.7, 1018.7, 793, 11.5) === 0);
  test('deriva: 1 mbar al mare ≈ 8,3 m', vicino(derivaAltimetroM(1013, 1012, 1013, 15), 8.3, 0.2));
  test(
    'deriva: ingresso non finito o P nulla → null',
    derivaAltimetroM(null, 1, 1, 1) === null && derivaAltimetroM(1018, 1015, 0, 11.5) === null
  );

  // ── pressioneAllIstante (interpolazione lineare) ──
  const serieP = {
    t0Ms: 0,
    valori: { pressure_msl: [1018, 1016, 1014], surface_pressure: [800, 798, 796], temperature_2m: [10, 12, 14] },
  };
  const meta = pressioneAllIstante(serieP, 30 * 60000, { quotaM: 2133 });
  test(
    'istante a metà ora → media delle due ore',
    !!meta && meta.qnhHpa === 1017 && meta.qfeHpa === 799 && meta.tempC === 11 && meta.qfeStimata === false,
    JSON.stringify(meta)
  );
  const ora1 = pressioneAllIstante(serieP, 3600000, { quotaM: 2133 });
  test('istante sull’ora piena → valore esatto', ora1.qnhHpa === 1016 && ora1.qfeHpa === 798);
  test('ultimo istante della finestra → ultimo valore', pressioneAllIstante(serieP, 7200000, { quotaM: 2133 }).qnhHpa === 1014);
  test('istante oltre la finestra → null', pressioneAllIstante(serieP, 7200000 + 1, { quotaM: 2133 }) === null);
  test('istante prima della finestra → null', pressioneAllIstante(serieP, -1, { quotaM: 2133 }) === null);
  test('senza quota dichiarata → QFE null (pressione di cella ignota)', pressioneAllIstante(serieP, 30 * 60000).qfeHpa === null);
  const serieNoSfc = { t0Ms: 0, valori: { ...serieP.valori, surface_pressure: [null, null, null] } };
  const ripiego = pressioneAllIstante(serieNoSfc, 30 * 60000, { quotaM: 2133 });
  test(
    'surface_pressure null → QFE stimata dalla QNH (≈ 791,8)',
    !!ripiego && ripiego.qfeStimata === true && vicino(ripiego.qfeHpa, 791.8, 0.5),
    JSON.stringify(ripiego)
  );
  const serieBuco = { t0Ms: 0, valori: { ...serieP.valori, pressure_msl: [1018, null, 1014] } };
  test('buco su un estremo → l’altro estremo', pressioneAllIstante(serieBuco, 30 * 60000).qnhHpa === 1018);
  test(
    'QNH assente → null',
    pressioneAllIstante(
      { t0Ms: 0, valori: { pressure_msl: [null, null], surface_pressure: [800, 798], temperature_2m: [10, 12] } },
      0,
      { quotaM: 2133 }
    ) === null
  );
  test('serie assente → null', pressioneAllIstante(null, 0) === null && pressioneAllIstante({ t0Ms: NaN, valori: {} }, 0) === null);

  // ── valutaParcheggio ──
  const P = { oraIso: '2026-08-23T06:00:00.000Z', oraLocale: '08:00', qnhHpa: 1018.7, qfeHpa: 793.4, tempC: 11.5, qfeStimata: false };
  const A = { oraIso: '2026-08-23T13:30:00.000Z', oraLocale: '15:30', qnhHpa: 1015.7, qfeHpa: 791.0, tempC: 14, qfeStimata: false };
  const base = { quotaM: 2133, quotaAttaccoM: 2140, distanzaAttaccoM: 350, partenza: P, arrivo: A };
  const v = valutaParcheggio(base);
  const riga = (val, re) => val.righe.some((r) => re.test(`${r.etichetta}: ${r.valore}`));
  test('valuta: deriva da ΔQFE ≈ +25,3 m', vicino(v.derivaM, 25.3, 0.5), String(v.derivaM));
  test('valuta: classe moderata (15-30 m)', v.classeDeriva === 'moderata');
  test('valuta: riga quota DEM', riga(v, /^Quota parcheggio \(DEM 90 m\): 2133 m$/));
  test('valuta: riga attacco con distanza e quota', riga(v, /^Attacco del sentiero: a 350 m, quota 2140 m$/));
  test('valuta: riga QNH partenza in mbar', riga(v, /^QNH prevista alle 08:00: 1018,7 mbar$/));
  test('valuta: riga pressione alla quota', riga(v, /^Pressione alla quota del parcheggio alle 08:00: 793,4 mbar$/));
  test(
    'valuta: riga QNH dell’orologio (atmosfera standard) con spiegazione',
    riga(v, /atmosfera standard\): 1028,1 mbar — 9,4 mbar più della QNH prevista per la temperatura reale: non correggere la quota/)
  );
  test('valuta: riga temperatura', riga(v, /^Temperatura prevista alle 08:00: 11,5 °C$/));
  test('valuta: riga QNH arrivo con tendenza', riga(v, /^QNH prevista alle 15:30: 1015,7 mbar \(in calo di 3,0 mbar\)$/));
  test(
    'valuta: riga deriva con segno e verso',
    riga(v, /^Deriva attesa fino alle 15:30: \+25 m \(pressione alla quota in calo: l.altimetro segnerà più del vero\)$/),
    JSON.stringify(v.righe.filter((r) => /Deriva/.test(r.etichetta)))
  );
  test(
    'valuta: istruzione di taratura sulla quota',
    riga(v, /^Taratura: Tara l.altimetro sulla quota 2133 m al parcheggio\. La QNH serve solo come controllo$/)
  );
  test('valuta: nessun «hPa» nei testi (l’utente legge mbar)', !v.righe.some((r) => /hPa/.test(r.valore + r.etichetta)));
  test('valuta: caso sano senza avvisi', v.avvisi.length === 0, JSON.stringify(v.avvisi));

  const forte = valutaParcheggio({ ...base, arrivo: { ...A, qfeHpa: 789.4 } });
  test('valuta: ΔQFE −4 mbar → forte ≈ +42 m', forte.classeDeriva === 'forte' && vicino(forte.derivaM, 42.2, 0.5), String(forte.derivaM));
  test('valuta: deriva forte → avviso ricalibra', forte.avvisi.some((a) => /ricalibra su una quota nota/.test(a)));
  const aumento = valutaParcheggio({ ...base, arrivo: { ...A, qfeHpa: 796.4 } });
  test(
    'valuta: pressione in aumento → deriva negativa ≈ −32 m',
    aumento.derivaM < 0 && riga(aumento, /Deriva attesa fino alle 15:30: −32 m \(pressione alla quota in aumento/),
    String(aumento.derivaM)
  );
  // QNH in calo ma pressione alla quota in aumento (riscaldamento diurno
  // della colonna): il verso deve nominare la quota, non contraddire la
  // riga della tendenza QNH
  const opposti = valutaParcheggio({
    ...base,
    arrivo: { ...A, qnhHpa: 1017.7, qfeHpa: 795.0, tempC: 18 },
  });
  test(
    'valuta: QNH in calo e QFE in aumento → verso riferito alla quota',
    riga(opposti, /^QNH prevista alle 15:30: 1017,7 mbar \(in calo di 1,0 mbar\)$/) &&
      riga(opposti, /Deriva attesa fino alle 15:30: −\d+ m \(pressione alla quota in aumento/),
    JSON.stringify(opposti.righe.slice(-3))
  );
  const quasiZero = valutaParcheggio({ ...base, arrivo: { ...A, qfeHpa: 793.44 } });
  test(
    'valuta: deriva fra −0,5 e 0 → «0 m», mai «−0 m»',
    riga(quasiZero, /Deriva attesa fino alle 15:30: 0 m \(pressione alla quota stabile\)/),
    String(quasiZero.derivaM)
  );
  const piccolo = valutaParcheggio({ ...base, arrivo: { ...A, qfeHpa: 792.4 } });
  test('valuta: ΔQFE −1 mbar → trascurabile (≈ +10,5 m)', piccolo.classeDeriva === 'trascurabile' && vicino(piccolo.derivaM, 10.5, 0.5));
  const senzaQfeArr = valutaParcheggio({ ...base, arrivo: { ...A, qfeHpa: null } });
  test(
    'valuta: senza QFE all’arrivo → ripiego su ΔQNH riferita alla QFE (≈ +31,6 m)',
    vicino(senzaQfeArr.derivaM, 31.6, 0.5),
    String(senzaQfeArr.derivaM)
  );
  test(
    'valuta: ripiego ΔQNH dichiarato nella riga',
    riga(senzaQfeArr, /Deriva attesa fino alle 15:30: \+32 m \(.*\) — stimata dalla variazione di QNH: pressione alla quota mancante a un estremo/),
    JSON.stringify(senzaQfeArr.righe.slice(-2))
  );
  // Fonti miste (QFE del modello alla partenza, stimata all'arrivo): la
  // differenza sarebbe artificiale → stesso ripiego dichiarato
  const misto = valutaParcheggio({ ...base, arrivo: { ...A, qfeHpa: 792.78, qfeStimata: true } });
  test(
    'valuta: QFE modello + QFE stimata → ripiego ΔQNH dichiarato, non differenza artificiale',
    vicino(misto.derivaM, 31.6, 0.5) && riga(misto, /stimata dalla variazione di QNH/),
    String(misto.derivaM)
  );
  const stim = valutaParcheggio({ ...base, partenza: { ...P, qfeStimata: true } });
  test('valuta: QFE stimata → dichiarata nella riga', riga(stim, /793,4 mbar \(stimata dalla QNH\)/));
  const lontano = valutaParcheggio({ ...base, distanzaAttaccoM: 3025 });
  test(
    'valuta: parcheggio a 3 km → avviso controlla le coordinate',
    lontano.avvisi.some((a) => /^Parcheggio a 3,0 km dall.attacco del sentiero: controlla le coordinate$/.test(a)),
    JSON.stringify(lontano.avvisi)
  );
  test('valuta: soglia distanza letta da config', valutaParcheggio({ ...base, distanzaAttaccoM: ALTIMETRO.distanzaAttaccoAvvisoM }).avvisi.length === 0);

  const senzaP = valutaParcheggio({ ...base, partenza: null, arrivo: null });
  test(
    'valuta: senza pressione → deriva e classe null, avviso dichiarato',
    senzaP.derivaM === null && senzaP.classeDeriva === null && senzaP.avvisi.some((a) => /Pressione prevista al parcheggio non disponibile/.test(a))
  );
  test('valuta: senza pressione → nessun mbar inventato nelle righe', !senzaP.righe.some((r) => /mbar/.test(r.valore)));
  test('valuta: senza pressione → resta l’istruzione sulla quota', riga(senzaP, /Tara l.altimetro sulla quota 2133 m/));
  const soloP = valutaParcheggio({ ...base, arrivo: null });
  test('valuta: senza arrivo → deriva null e avviso', soloP.derivaM === null && soloP.avvisi.some((a) => /deriva dell.altimetro non calcolata/.test(a)));
  const senzaQ = valutaParcheggio({ ...base, quotaM: null, partenza: { ...P, qfeHpa: null }, arrivo: { ...A, qfeHpa: null } });
  test(
    'valuta: senza quota → avviso quota e QNH comunque mostrata',
    senzaQ.avvisi.some((a) => /^Quota del parcheggio non disponibile/.test(a)) && riga(senzaQ, /QNH prevista alle 08:00: 1018,7 mbar/)
  );
  test('valuta: senza quota → deriva non calcolabile, dichiarata', senzaQ.derivaM === null && riga(senzaQ, /Deriva attesa fino alle 15:30: non calcolabile/));
  test(
    'valuta: senza quota → nessuna quota inventata nell’istruzione',
    !riga(senzaQ, /Tara l.altimetro sulla quota \d/) && riga(senzaQ, /Taratura: Tara l.altimetro su una quota nota/)
  );
  test('valuta: ingresso vuoto non esplode', valutaParcheggio({}).righe.length >= 2 && valutaParcheggio().derivaM === null);

  // ── Cronologia: merge del parcheggio e aggiornamento in posizione ──
  cronologiaSvuota();
  test('cronologia: voce senza id → null', cronologiaAggiungi({}) === null);
  const v1 = cronologiaAggiungi({ id: 'p', fonte: 'komoot', nome: 'Pi', payload: { tourId: 1 } });
  test('cronologia: aggiungi restituisce la voce salvata', !!v1 && v1.id === 'p');
  const agg = cronologiaAggiornaParcheggio('p', { lat: 42.4428, lon: 13.5582, quotaM: 2133 });
  test('cronologia: aggiorna parcheggio → voce con parcheggio', agg?.parcheggio?.quotaM === 2133 && cronologiaLeggi()[0].parcheggio.lat === 42.4428);
  cronologiaAggiungi({ id: 'q', fonte: 'gpx', nome: 'Qu' });
  const ri = cronologiaAggiungi({ id: 'p', fonte: 'komoot', nome: 'Pi', payload: { tourId: 1 } });
  test('cronologia: merge — riapertura senza parcheggio lo conserva', ri.parcheggio?.lat === 42.4428 && cronologiaLeggi()[0].parcheggio?.quotaM === 2133);
  test('cronologia: merge — la voce risale in cima', cronologiaLeggi().map((x) => x.id).join(',') === 'p,q');
  cronologiaAggiornaParcheggio('q', { lat: 46, lon: 11, quotaM: null });
  test(
    'cronologia: aggiornamento non sposta la voce',
    cronologiaLeggi().map((x) => x.id).join(',') === 'p,q' && cronologiaLeggi()[1].parcheggio.quotaM === null
  );
  test('cronologia: aggiornamento con coordinate non numeriche → null', cronologiaAggiornaParcheggio('q', { lat: 'x', lon: 11 }) === null);
  test('cronologia: id inesistente → null, lista intatta', cronologiaAggiornaParcheggio('zz', { lat: 1, lon: 1, quotaM: null }) === null && cronologiaLeggi().length === 2);
  const tolto = cronologiaAggiornaParcheggio('p', null);
  test('cronologia: parcheggio null → rimosso', !!tolto && !('parcheggio' in tolto) && !('parcheggio' in cronologiaLeggi()[0]));
  const esplicito = cronologiaAggiungi({ id: 'q', fonte: 'gpx', nome: 'Qu', parcheggio: { lat: 45, lon: 10, quotaM: 500 } });
  test('cronologia: parcheggio esplicito nella nuova voce vince', esplicito.parcheggio.lat === 45);
  const annullato = cronologiaAggiungi({ id: 'q', fonte: 'gpx', nome: 'Qu', parcheggio: null });
  test('cronologia: parcheggio null esplicito in aggiungi → rimosso', !('parcheggio' in annullato));
  const originale = { id: 'r', fonte: 'gpx', nome: 'R' };
  cronologiaAggiungi(originale);
  test('cronologia: aggiungi non muta l’oggetto del chiamante', !('parcheggio' in originale));
  cronologiaSvuota();

  // ── PDF: guardie e testi dichiarati ──
  test('PDF parcheggio: risultato vecchio → nessun riquadro', bloccoParcheggioPdf({}) === '');
  test('PDF parcheggio: campo null → nessun riquadro', bloccoParcheggioPdf({ parcheggio: null }) === '');
  const htmlPdf = bloccoParcheggioPdf({
    parcheggio: { lat: 42.4428, lon: 13.5582, quotaM: 2133, modelloNome: 'ICON-2I', ...senzaP },
  });
  test('PDF parcheggio: senza pressione → dichiarato', /non disponibile/.test(htmlPdf) && /TARATURA ALTIMETRO/.test(htmlPdf));
  test(
    'PDF parcheggio: righe e avvisi stampati',
    /Quota parcheggio \(DEM 90 m\)/.test(htmlPdf) && /⚠ Pressione prevista al parcheggio non disponibile/.test(htmlPdf)
  );
  test('PDF parcheggio: coordinate nel titolo', /\(42\.44280, 13\.55820\)/.test(htmlPdf));
  test('PDF parcheggio: oggetto parziale non esplode', bloccoParcheggioPdf({ parcheggio: { righe: [], avvisi: [] } }).includes('TARATURA'));

  // ── CSV: righe meta solo con il parcheggio ──
  const rCsv = {
    nome: 'Prova',
    totKm: 10,
    dPlusM: 500,
    dMinusM: 500,
    partenzaIso: '2026-08-23T06:00:00.000Z',
    arrivoIso: '2026-08-23T13:30:00.000Z',
    tz: 'Europe/Rome',
    modello: { nome: 'ICON-2I' },
    generatoIl: Date.parse('2026-08-22T18:00:00Z'),
    campioni: [],
    avvisi: [],
  };
  const csvSenza = csvCompleto(rCsv);
  const csvCon = csvCompleto({
    ...rCsv,
    parcheggio: { lat: 42.4428, lon: 13.5582, quotaM: 2133, partenza: P, arrivo: A, derivaM: 25.3 },
  });
  test('CSV: senza parcheggio nessuna riga dedicata', !/parcheggio lat|QNH prevista mbar/.test(csvSenza));
  test(
    'CSV: con parcheggio le righe meta in mbar',
    /parcheggio lat;42,44280\r\n/.test(csvCon) &&
      /quota parcheggio m;2133\r\n/.test(csvCon) &&
      /QNH prevista mbar;1018,7\r\n/.test(csvCon) &&
      /QFE parcheggio mbar;793,4;\r\n/.test(csvCon) &&
      /deriva altimetro m;25\r\n/.test(csvCon),
    csvCon.slice(0, 600)
  );
  test('CSV: il resto del file resta identico', csvSenza.split('\r\n').length + 6 === csvCon.split('\r\n').length);
  const csvStimata = csvCompleto({
    ...rCsv,
    parcheggio: { lat: 42.4428, lon: 13.5582, quotaM: 2133, partenza: { ...P, qfeStimata: true }, arrivo: A, derivaM: 25.3 },
  });
  test('CSV: QFE stimata dichiarata anche fuori dall’app', /QFE parcheggio mbar;793,4;stimata dalla QNH\r\n/.test(csvStimata));
}

console.log('');
if (falliti) {
  console.error(`${falliti} test FALLITI`);
  process.exit(1);
} else {
  console.log('Tutti i test sono verdi.');
}
