// ─────────────────────────────────────────────────────────────────────────
// Tabella di marcia: punti di controllo a intervallo fisso di tempo
// PREVISTO (pause incluse) dalla partenza, per verificare sul campo se si
// è in orario, in anticipo o in ritardo. Modulo puro, testabile in Node.
// ─────────────────────────────────────────────────────────────────────────

import { tempoAllaDistanza } from './eta.js';
import { quotaLungoTraccia } from './geo.js';

// Distanza (km) a cui il tempo cumulato raggiunge tMin (bisezione,
// stessa tecnica delle tacche orarie del profilo)
function distanzaAlTempo(cum, tCumMin, tMin) {
  let lo = 0;
  let hi = cum[cum.length - 1];
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (tempoAllaDistanza(cum, tCumMin, mid) < tMin) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// percorso: modello di js/percorso.js; eta: risultato di calcolaEta.
// Restituisce i punti di controllo ogni intervalloMin di tabella di
// marcia, ultimo punto = arrivo esatto:
// [{ tMin, dKm, quotaM, pendenzaPct }]
// pendenzaPct = pendenza media del tratto dal punto di controllo
// precedente (dislivello/distanza, in %), null su tratti ~nulli.
export function puntiControllo(percorso, eta, intervalloMin = 15) {
  const { punti, cum } = percorso;
  const durata = eta.durataTotaleMin;
  const out = [];
  let prev = { tMin: 0, dKm: 0, quotaM: quotaLungoTraccia(punti, cum, 0) };

  const tempi = [];
  for (let t = intervalloMin; t < durata - 0.5; t += intervalloMin) tempi.push(t);
  tempi.push(durata); // arrivo esatto

  for (const tMin of tempi) {
    const dKm = distanzaAlTempo(cum, eta.tCumMin, tMin);
    const quotaM = quotaLungoTraccia(punti, cum, dKm);
    const dxM = (dKm - prev.dKm) * 1000;
    const pendenzaPct =
      dxM > 20 && Number.isFinite(quotaM) && Number.isFinite(prev.quotaM)
        ? ((quotaM - prev.quotaM) / dxM) * 100
        : null;
    out.push({ tMin, dKm, quotaM, pendenzaPct });
    prev = { tMin, dKm, quotaM };
  }
  return out;
}
