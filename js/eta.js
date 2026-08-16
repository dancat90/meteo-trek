// ─────────────────────────────────────────────────────────────────────────
// Motore dei tempi di percorrenza. Modulo puro, testabile in Node.
//
// Idea: la funzione di Tobler dà una velocità CONTINUA in funzione della
// pendenza (il profilo relativo dei tempi tratto per tratto), ma i suoi
// valori assoluti sono ottimisti in salita ripida. Il totale viene quindi
// RISCALATO sul tempo "svizzero" (Schweizer Wanderwege: 4 km/h + 400 m/h
// in salita + 800 m/h in discesa, la stessa scala dei cartelli CAI),
// personalizzato sul passo dichiarato dall'utente (m/h di dislivello in
// salita). Risultato: distribuzione realistica lungo il percorso E totale
// coerente con la segnaletica.
// ─────────────────────────────────────────────────────────────────────────

import { BASE_SVIZZERA, GUARDIA_K, PENDENZA_MAX } from './config.js';

// Velocità di Tobler (km/h) alla pendenza m = dz/dx (rapporto, non gradi)
export function velocitaTobler(m) {
  return 6 * Math.exp(-3.5 * Math.abs(m + 0.05));
}

// Tempo totale svizzero personalizzato (minuti, pause escluse)
export function tempoSvizzeroMin(totKm, dPlusM, dMinusM, mhSalita) {
  const ore =
    totKm / BASE_SVIZZERA.kmOrari +
    dPlusM / BASE_SVIZZERA.salitaMOra +
    dMinusM / BASE_SVIZZERA.discesaMOra;
  // Il fattore scala l'INTERO totale: un camminatore lento è lento anche
  // in piano e in discesa (assunzione dichiarata nel README)
  return ore * (BASE_SVIZZERA.salitaMOra / mhSalita) * 60;
}

// Calcola i tempi cumulati di passaggio su ogni trackpoint.
//
// percorso: modello di js/percorso.js (punti con eleM e dCumKm, cum, totKm,
//           dPlusM, dMinusM)
// opzioni:  { mhSalita, pausaMinOra, sosta: {dopoOre, durataMin} | null }
//
// Restituisce { tCumMin[], durataMovimentoMin, durataTotaleMin, k,
//               tToblerMin, tSvizzeroMin, avvisi[] }
export function calcolaEta(percorso, opzioni = {}) {
  const { mhSalita = 400, pausaMinOra = 10, sosta = null } = opzioni;
  const { punti, cum, totKm, dPlusM, dMinusM } = percorso;
  const avvisi = [];

  // 1. Profilo Tobler per segmento (fra trackpoint consecutivi: la
  //    pendenza vera vive a questa scala, non a quella dei campioni meteo)
  const tCumTobler = [0];
  let tTobler = 0;
  for (let i = 1; i < punti.length; i++) {
    const dxKm = cum[i] - cum[i - 1];
    if (dxKm <= 0) {
      tCumTobler.push(tTobler);
      continue;
    }
    const za = punti[i - 1].eleM;
    const zb = punti[i].eleM;
    let m = 0;
    if (za !== null && zb !== null) {
      m = (zb - za) / (dxKm * 1000);
      m = Math.max(-PENDENZA_MAX, Math.min(PENDENZA_MAX, m));
    }
    tTobler += (dxKm / velocitaTobler(m)) * 60;
    tCumTobler.push(tTobler);
  }
  if (tTobler <= 0) throw new Error('Percorso a lunghezza nulla');

  // 2. Riscalatura sul totale svizzero personalizzato
  const tSviz = tempoSvizzeroMin(totKm, dPlusM, dMinusM, mhSalita);
  const k = tSviz / tTobler;
  if (k < GUARDIA_K[0] || k > GUARDIA_K[1]) {
    avvisi.push(
      `Profilo tempi anomalo (fattore ${k.toFixed(2)}): quote o distanze ` +
        'della traccia sospette, orari indicativi'
    );
  }

  // 3. Pause brevi spalmate (minuti per ora di marcia)
  const fPause = 1 + Math.max(0, pausaMinOra) / 60;

  let tCumMin = tCumTobler.map((t) => t * k * fPause);
  const durataMovimentoMin = tTobler * k;

  // 4. Sosta puntuale (es. pranzo): slittamento additivo di tutti i punti
  //    successivi al momento della sosta
  if (sosta && sosta.durataMin > 0) {
    const dopoMin = (sosta.dopoOre ?? 0) * 60;
    tCumMin = tCumMin.map((t) => (t > dopoMin ? t + sosta.durataMin : t));
  }

  return {
    tCumMin,
    durataMovimentoMin,
    durataTotaleMin: tCumMin[tCumMin.length - 1],
    k,
    tToblerMin: tTobler,
    tSvizzeroMin: tSviz,
    avvisi,
  };
}

// Tempo cumulato (minuti) alla distanza progressiva x, interpolato
// linearmente fra i trackpoint: serve per gli orari dei campioni meteo
export function tempoAllaDistanza(cum, tCumMin, x) {
  const tot = cum[cum.length - 1];
  const xc = Math.min(tot, Math.max(0, x));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < xc) i++;
  const l = cum[i] - cum[i - 1];
  const f = l > 0 ? (xc - cum[i - 1]) / l : 0;
  return tCumMin[i - 1] + (tCumMin[i] - tCumMin[i - 1]) * f;
}

// Orario di passaggio (Date UTC) alla distanza x, data la partenza
export function orarioAllaDistanza(partenzaUtc, cum, tCumMin, x) {
  return new Date(partenzaUtc.getTime() + tempoAllaDistanza(cum, tCumMin, x) * 60000);
}
