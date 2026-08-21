// ─────────────────────────────────────────────────────────────────────────
// Pianificatore delle finestre di partenza (24-72 h): valuta molti orari
// di partenza candidati riusando il rischio a 5 canali sulle serie orarie
// complete. Modulo puro: nessuna rete, nessun DOM, testabile in Node.
//
// Semplificazioni dichiarate rispetto alla previsione completa (che resta
// il riferimento): un solo modello, niente dettaglio 15 min, niente
// confronto multi-modello, niente lifted index né UV (null sui primari
// regionali). Lo score di una cella può differire di ±1 dalla previsione
// completa sullo stesso orario.
// ─────────────────────────────────────────────────────────────────────────

import { PIANIFICATORE } from './config.js';
import { dataLocaleAUtc } from './tempo.js';
import { scoreCanali, fusione, canaliAttivi } from './rischio.js';
import { percepitaOperativa } from './percepita.js';
import { giornoAnnoUtc } from './radiante.js';
import { fattoreEsposizione } from './esposizione.js';
import { albaTramontoPertinenti } from './sole.js';
import { preparaFondo, statoFondo } from './fondo.js';

// Ordine di gravità delle classi di fondo, per scegliere la peggiore
// lungo il percorso di una singola cella della griglia
const GRAVITA_FONDO = {
  asciutto: 0,
  ignoto: 0,
  umido: 1,
  fangoso: 2,
  neve: 2,
  saturo: 3,
  ghiaccio: 4,
  crosta: 5,
};

// "YYYY-MM-DD" del giorno locale nel fuso tz all'istante ms
function dataIsoLocale(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

// Griglia dei candidati sulla scala LOCALE del percorso (l'ora legale è
// gestita da dataLocaleAUtc). Solo istanti futuri (≥ adessoMs + margine).
// Ritorna [{ partenzaUtcMs, dataIso, oraLocale }].
export function candidatiPartenza({
  adessoMs,
  tz,
  orizzonteOre = PIANIFICATORE.orizzonteOre,
  fasciaOreLocali = PIANIFICATORE.fasciaOreLocali,
  passoOre = PIANIFICATORE.passoOre,
  margineMin = PIANIFICATORE.margineFuturoMin,
} = {}) {
  const out = [];
  const minMs = adessoMs + margineMin * 60000;
  const maxMs = adessoMs + orizzonteOre * 3600000;
  // Giorni locali coperti: da oggi fino a orizzonte+1 (il giorno locale
  // dell'ultimo istante può cadere oltre le 72 h piene)
  const giorni = new Set();
  for (let ms = adessoMs; ms <= maxMs; ms += 6 * 3600000) giorni.add(dataIsoLocale(ms, tz));
  giorni.add(dataIsoLocale(maxMs, tz));
  for (const dataIso of [...giorni].sort()) {
    for (let h = fasciaOreLocali[0]; h <= fasciaOreLocali[1]; h += passoOre) {
      const oraLocale = `${String(h).padStart(2, '0')}:00`;
      const t = dataLocaleAUtc(dataIso, oraLocale, tz).getTime();
      if (t < minMs || t > maxMs) continue;
      out.push({ partenzaUtcMs: t, dataIso, oraLocale });
    }
  }
  out.sort((a, b) => a.partenzaUtcMs - b.partenzaUtcMs);
  return out;
}

// Estrazione STRETTA (±1 ora, NON il ±3 di valoreVicino: al bordo
// dell'orizzonte il ±3 ruberebbe l'ultimo valore valido mascherando la
// fine delle serie). serieCampione: { t0Ms, valori: {var: array} }.
// Ritorna { valori, buco } oppure null (fuori finestra o tutto null).
export function valoriAllOra(serieCampione, istanteMs) {
  if (!serieCampione || !Number.isFinite(serieCampione.t0Ms)) return null;
  const idx = Math.round((istanteMs - serieCampione.t0Ms) / 3600000);
  const nomi = Object.keys(serieCampione.valori || {});
  if (!nomi.length) return null;
  const lunghezza = serieCampione.valori[nomi[0]]?.length ?? 0;
  if (idx < 0 || idx >= lunghezza) return null;
  const valori = {};
  let almenoUno = false;
  let buco = false;
  for (const v of nomi) {
    const arr = serieCampione.valori[v];
    let val = arr?.[idx];
    if (val === null || val === undefined) {
      // Tolleranza minima sui buchi singoli: mai oltre ±1
      const vicino = arr?.[idx + 1] ?? arr?.[idx - 1];
      if (vicino !== null && vicino !== undefined) {
        val = vicino;
        buco = true;
      } else {
        val = null;
      }
    }
    valori[v] = val;
    if (val !== null) almenoUno = true;
  }
  return almenoUno ? { valori, buco } : null;
}

// PoP k/N dall'ensemble all'ora richiesta (estrazione stretta, ±0)
function popAllOra(popCampione, istanteMs) {
  if (!popCampione || !Number.isFinite(popCampione.t0Ms)) return null;
  const idx = Math.round((istanteMs - popCampione.t0Ms) / 3600000);
  const v = popCampione.popKN?.[idx];
  return Number.isFinite(v) ? v : null;
}

// Valutazione di tutti i candidati. Nessuna rete, nessun DOM.
// - offsetMin[i]: minuti dalla partenza al passaggio sul campione i
// - serieCampioni: da meteoSerie (allineate ai campioni)
// - profiliEspo: da profiliDaQuote, o null (fattore 1, dichiarato a monte)
// - popSerie: da ensemblePopSerie, o null
// - orizzonteMs: istante oltre cui il MODELLO non arriva
export function valutaFinestre({
  candidati,
  offsetMin,
  campioni,
  serieCampioni,
  profiliEspo = null,
  versanti = null,
  serieFondo = null,
  popSerie = null,
  orizzonteMs,
  arrivoLatLon = null,
  durataTotaleMin,
  margineTramontoMin = PIANIFICATORE.margineTramontoMin,
}) {
  // Serie del fondo estratte UNA volta per campione: ogni cella della
  // griglia le rilegge al proprio istante, senza ricostruirle
  const fondoPrep = serieFondo ? campioni.map((_, i) => preparaFondo(serieFondo[i])) : null;

  return candidati.map((cand) => {
    const partenzaUtcMs = cand.partenzaUtcMs;
    // Override per-candidato (sosta a orario fisso): offset e durata
    // possono variare col giorno del candidato
    const offs = cand.offsetMin ?? offsetMin;
    const durTot = cand.durataTotaleMin ?? durataTotaleMin;
    const arrivoUtcMs = partenzaUtcMs + durTot * 60000;

    // Tramonto sulla posizione di arrivo (stessa regola del riepilogo)
    let tramonto = null;
    if (arrivoLatLon) {
      const sole = albaTramontoPertinenti(new Date(arrivoUtcMs), arrivoLatLon.lat, arrivoLatLon.lon);
      if (sole?.tramontoUtc) {
        const margine = Math.round((sole.tramontoUtc.getTime() - arrivoUtcMs) / 60000);
        tramonto = {
          classe: margine >= margineTramontoMin ? 'ok' : margine >= 0 ? 'stretto' : 'dopo',
          margineMin: margine,
          tramontoUtcMs: sole.tramontoUtc.getTime(),
        };
      }
    }

    // Oltre l'orizzonte del modello: nessuno score, niente numeri finti
    if (Number.isFinite(orizzonteMs) && arrivoUtcMs + 3600000 > orizzonteMs) {
      return { ...cand, arrivoUtcMs, stato: 'oltreOrizzonte', scoreMax: null, distribuzione: null, peggior: null, fondo: null, campioniSenzaDati: campioni.length, tramonto };
    }

    let scoreMax = 0;
    const distribuzione = [0, 0, 0, 0];
    let peggior = null;
    let campioniSenzaDati = 0;
    let campioniConBuco = 0;
    // Fondo peggiore lungo il percorso per QUESTA partenza: ogni giorno
    // candidato ha la sua storia di pioggia, neve e gelo
    let fondoPeggiore = null;
    for (let i = 0; i < campioni.length; i++) {
      const istante = partenzaUtcMs + (offs[i] ?? 0) * 60000;
      const estratto = valoriAllOra(serieCampioni?.[i], istante);
      if (!estratto) {
        campioniSenzaDati++;
        continue;
      }
      // Valore preso in prestito dall'ora adiacente: la cella va marcata
      // come dati parziali (mai degradazione silenziosa)
      if (estratto.buco) campioniConBuco++;
      const v = estratto.valori;
      // Correzione orografica risolta sulla direzione ORARIA del vento
      const espo = profiliEspo
        ? fattoreEsposizione(profiliEspo[i], v.wind_direction_10m)
        : { fattore: 1 };
      const f = Number.isFinite(espo.fattore) ? espo.fattore : 1;
      const valoriEff = f === 1 ? v : { ...v };
      if (f !== 1) {
        if (Number.isFinite(v.wind_speed_10m)) valoriEff.wind_speed_10m = v.wind_speed_10m * f;
        if (Number.isFinite(v.wind_gusts_10m)) valoriEff.wind_gusts_10m = v.wind_gusts_10m * f;
      }
      // PoP dall'ensemble dove il modello non la espone (ICON-2I)
      let valoriRischio = valoriEff;
      if (!Number.isFinite(valoriEff.precipitation_probability)) {
        const pop = popAllOra(popSerie?.[i], istante);
        if (pop !== null) valoriRischio = { ...valoriEff, precipitation_probability: pop };
      }
      const oper = percepitaOperativa(valoriEff, giornoAnnoUtc(new Date(istante)));
      // Stato del fondo alla data del candidato: entra nel rischio solo
      // per la parte neve/ghiaccio (cap dentro scoreRischio)
      const fondo = fondoPrep
        ? statoFondo(fondoPrep[i], {
            istanteMs: istante,
            quotaM: campioni[i].eleM,
            versante: versanti?.[i] ?? null,
          })
        : null;
      if (fondo && fondo.dati !== 'assenti') {
        const g = GRAVITA_FONDO[fondo.classe] ?? 0;
        if (!fondoPeggiore || g > (GRAVITA_FONDO[fondoPeggiore.classe] ?? 0)) {
          fondoPeggiore = {
            classe: fondo.classe,
            livello: fondo.livello,
            idxCampione: i,
            dCumKm: campioni[i].dCumKm,
            testo: fondo.testo,
          };
        }
      }
      const canali = scoreCanali(
        valoriRischio,
        oper.valore,
        fondo && fondo.dati !== 'assenti' ? fondo.scoreRischio : null
      );
      const score = fusione(canali);
      distribuzione[score]++;
      if (score >= scoreMax) {
        scoreMax = score;
        // A parità di score tengo il PRIMO campione peggiore incontrato
        if (!peggior || score > (peggior.score ?? -1)) {
          peggior = {
            idxCampione: i,
            dCumKm: campioni[i].dCumKm,
            score,
            canali: canaliAttivi(canali),
          };
        }
      }
    }

    const n = campioni.length;
    const stato =
      campioniSenzaDati >= n || campioniSenzaDati > n / 2
        ? 'senzaDati'
        : campioniSenzaDati > 0 || campioniConBuco > 0
          ? 'datiParziali'
          : 'ok';
    return {
      ...cand,
      arrivoUtcMs,
      stato,
      scoreMax: stato === 'senzaDati' ? null : scoreMax,
      distribuzione: stato === 'senzaDati' ? null : distribuzione,
      peggior: stato === 'senzaDati' ? null : peggior,
      fondo: stato === 'senzaDati' ? null : fondoPeggiore,
      campioniSenzaDati,
      tramonto,
    };
  });
}
