// ─────────────────────────────────────────────────────────────────────────
// Motore dei tempi di percorrenza. Modulo puro, testabile in Node.
//
// Dal 17/08/2026 il metro è il nomogramma ufficiale Schweizer Wanderwege
// 1996 (vedi NOMOGRAMMA in config.js): per ogni segmento si combinano in
// norma-q il tempo orizzontale (4,2 km/h, con spinta nelle discese dolci)
// e il tempo verticale (400 m/h su, 800 m/h giù). Rispetto alla vecchia
// regola additiva dei cartelli i tempi sulle pendenze dolci sono più
// corti e realistici; sul ripido i due metodi coincidono. Il totale è
// personalizzato sul passo dichiarato dall'utente (m/h di dislivello in
// salita): un camminatore lento è lento anche in piano e in discesa
// (assunzione dichiarata nel README).
// ─────────────────────────────────────────────────────────────────────────

import { BASE_SVIZZERA, NOMOGRAMMA, GUARDIA_K, PENDENZA_MAX } from './config.js';

// Velocità orizzontale (km/h) alla pendenza s = dz/dx: 4,2 in piano e in
// salita (lì rallenta il termine verticale), con la spinta delle discese
// dolci che il nomogramma mostra (a −6% si scende più veloci del piano)
export function velocitaPianoKmh(s) {
  const N = NOMOGRAMMA;
  if (!(s < 0)) return N.vPianoKmh;
  const bump = Math.exp(-(((s + N.discesaPicco) / N.discesaLarghezza) ** 2));
  // La spinta si accende gradualmente sotto il piano: a s=0 vale zero
  const rampa = Math.min(1, -s / 0.02);
  return N.vPianoKmh * (1 + N.discesaSpinta * bump * rampa);
}

// Tempo (minuti) del nomogramma per un segmento di dxKm orizzontali e
// dhM di dislivello (segno incluso). Combinazione in norma-q: additiva
// dove domina un termine solo, sub-additiva sulle pendenze dolci.
export function tempoNomogrammaMin(dxKm, dhM) {
  if (!(dxKm > 0)) {
    return Math.abs(dhM) > 0
      ? (dhM > 0 ? dhM / NOMOGRAMMA.salitaMOra : -dhM / NOMOGRAMMA.discesaMOra) * 60
      : 0;
  }
  const s = dhM / (dxKm * 1000);
  const tDist = (dxKm / velocitaPianoKmh(s)) * 60;
  const tVert =
    dhM >= 0
      ? (dhM / NOMOGRAMMA.salitaMOra) * 60
      : (-dhM / NOMOGRAMMA.discesaMOra) * 60;
  const q = NOMOGRAMMA.q;
  return Math.pow(Math.pow(tDist, q) + Math.pow(tVert, q), 1 / q);
}

// Tempo totale della vecchia regola additiva dei cartelli (minuti,
// pause escluse): resta come riferimento prudente e per la guardia
export function tempoSvizzeroMin(totKm, dPlusM, dMinusM, mhSalita) {
  const ore =
    totKm / BASE_SVIZZERA.kmOrari +
    dPlusM / BASE_SVIZZERA.salitaMOra +
    dMinusM / BASE_SVIZZERA.discesaMOra;
  return ore * (BASE_SVIZZERA.salitaMOra / mhSalita) * 60;
}

// Calcola i tempi cumulati di passaggio su ogni trackpoint.
//
// percorso: modello di js/percorso.js (punti con eleM e dCumKm, cum, totKm,
//           dPlusM, dMinusM)
// opzioni:  { mhSalita, pausaMinOra, sosta: {dopoOre, durataMin} | null }
//
// Restituisce { tCumMin[], durataMovimentoMin, durataTotaleMin, k,
//               tNomogrammaMin, tSvizzeroMin, avvisi[] }
// dove k = tNomogramma / tSvizzeroAdditivo (guardia di sanità).
export function calcolaEta(percorso, opzioni = {}) {
  const { mhSalita = 400, pausaMinOra = 10, sosta = null } = opzioni;
  const { punti, cum, totKm, dPlusM, dMinusM } = percorso;
  const avvisi = [];

  // 1. Nomogramma per segmento (fra trackpoint consecutivi: la pendenza
  //    vera vive a questa scala, non a quella dei campioni meteo)
  const tCumNom = [0];
  let tNom = 0;
  for (let i = 1; i < punti.length; i++) {
    const dxKm = cum[i] - cum[i - 1];
    if (dxKm <= 0) {
      tCumNom.push(tNom);
      continue;
    }
    const za = punti[i - 1].eleM;
    const zb = punti[i].eleM;
    let dhM = 0;
    if (za !== null && zb !== null) {
      // Clamp della pendenza: oltre ±60% è quasi sempre rumore GPS o
      // roccia attrezzata, dove nessuna tabella dei tempi ha senso
      const s = Math.max(
        -PENDENZA_MAX,
        Math.min(PENDENZA_MAX, (zb - za) / (dxKm * 1000))
      );
      dhM = s * dxKm * 1000;
    }
    tNom += tempoNomogrammaMin(dxKm, dhM);
    tCumNom.push(tNom);
  }
  if (tNom <= 0) throw new Error('Percorso a lunghezza nulla');

  // 2. Personalizzazione sul passo (fattore sull'intero totale)
  const fPasso = NOMOGRAMMA.salitaMOra / mhSalita;

  // 3. Guardia di sanità: il nomogramma contro la regola additiva.
  //    Il rapporto non dipende dal passo (il fattore agisce su entrambi).
  const tSviz = tempoSvizzeroMin(totKm, dPlusM, dMinusM, mhSalita);
  const k = (tNom * fPasso) / tSviz;
  if (k < GUARDIA_K[0] || k > GUARDIA_K[1]) {
    avvisi.push(
      `Profilo tempi anomalo (fattore ${k.toFixed(2)}): quote o distanze ` +
        'della traccia sospette, orari indicativi'
    );
  }

  // 4. Pause brevi spalmate (minuti per ora di marcia)
  const fPause = 1 + Math.max(0, pausaMinOra) / 60;

  let tCumMin = tCumNom.map((t) => t * fPasso * fPause);
  const durataMovimentoMin = tNom * fPasso;

  // 5. Sosta puntuale (es. pranzo): slittamento additivo di tutti i punti
  //    successivi al momento della sosta. Tre chiavi del chiamante, in
  //    ordine di precedenza: aDistanzaKm (km della fermata, es. vetta) >
  //    dopoMin (minuti dalla partenza, es. orario fisso già risolto) >
  //    dopoOre (modalità storica, retrocompatibile). Le guardie vivono
  //    qui, uniche per tutte le modalità, con avviso dichiarato.
  let sostaEff = null;
  if (sosta && sosta.durataMin > 0) {
    const durataBase = tCumMin[tCumMin.length - 1];
    let dopoMin;
    if (Number.isFinite(sosta.aDistanzaKm)) {
      dopoMin = tempoAllaDistanza(cum, tCumMin, sosta.aDistanzaKm);
    } else if (Number.isFinite(sosta.dopoMin)) {
      dopoMin = sosta.dopoMin;
    } else {
      dopoMin = (sosta.dopoOre ?? 0) * 60;
    }
    if (!Number.isFinite(dopoMin) || dopoMin <= 0) {
      avvisi.push(
        Number.isFinite(sosta.aDistanzaKm)
          ? 'Il punto più alto coincide con la partenza: sosta «in vetta» ignorata'
          : 'Sosta pranzo alla partenza o prima: ignorata'
      );
    } else if (dopoMin >= durataBase) {
      if (Number.isFinite(sosta.aDistanzaKm)) {
        // Vetta all'arrivo: la riga informativa resta, gli orari no
        avvisi.push('Il punto più alto coincide con l’arrivo: la sosta non sposta gli orari');
        sostaEff = { dopoMin: durataBase, durataMin: sosta.durataMin, dKm: sosta.aDistanzaKm };
      } else {
        avvisi.push('Sosta pranzo oltre l’arrivo previsto: ignorata');
      }
    } else {
      tCumMin = applicaSosta(tCumMin, dopoMin, sosta.durataMin);
      const dKm = Number.isFinite(sosta.aDistanzaKm)
        ? sosta.aDistanzaKm
        : distanzaAlTempo(cum, tCumMin, dopoMin + 1);
      sostaEff = { dopoMin, durataMin: sosta.durataMin, dKm };
    }
  }

  return {
    tCumMin,
    durataMovimentoMin,
    durataTotaleMin: tCumMin[tCumMin.length - 1],
    k,
    tNomogrammaMin: tNom,
    tSvizzeroMin: tSviz,
    // Sosta normalizzata (o null se assente/ignorata): unica fonte di
    // verità per la riga in tabella e per il campo del risultato
    sosta: sostaEff,
    avvisi,
  };
}

// Regola di slittamento della sosta, riusata dal pianificatore sugli
// offset dei campioni: slittano solo i tempi OLTRE il momento della sosta
export function applicaSosta(tMinArr, dopoMin, durataMin) {
  return tMinArr.map((t) => (t > dopoMin ? t + durataMin : t));
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

// Distanza (km) alla quale il tempo cumulato raggiunge tMin: inversa di
// tempoAllaDistanza per bisezione. Serve a collocare lungo il percorso
// eventi definiti nel tempo (es. la sosta pranzo).
export function distanzaAlTempo(cum, tCumMin, tMin) {
  let lo = 0;
  let hi = cum[cum.length - 1];
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    if (tempoAllaDistanza(cum, tCumMin, mid) < tMin) lo = mid;
    else hi = mid;
  }
  return lo;
}
