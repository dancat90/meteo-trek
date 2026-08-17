// ─────────────────────────────────────────────────────────────────────────
// Stima dell'affidabilità percentuale della previsione per campione.
// Stessa struttura di meteo-rotta, costanti RICALIBRATE per la superficie
// (quelle originali erano tarate sui venti del jet a 250 hPa e a 10 m
// darebbero sempre ~100%):
//   A_ens  accordo fra i membri dell'ensemble (spread temperatura, °C)
//   A_mod  accordo fra modelli deterministici (ΔT e Δraffiche)
//   A_lead decadimento con il lead time (giorni al passaggio)
// Formula: 100 · A_lead · (0.3 + 0.7 · base), base = media dei disponibili.
// ─────────────────────────────────────────────────────────────────────────

function clamp(x, minimo, massimo) {
  return Math.min(massimo, Math.max(minimo, x));
}

// sigmaTempC: spread ensemble della temperatura (°C); 3 °C di sigma a
// quota sentiero = previsione molto incerta.
// diffTempC / diffRaffKmh: divergenza primario-secondario.
export function affidabilita({ sigmaTempC, diffTempC, diffRaffKmh, leadGiorni }) {
  const aEns = Number.isFinite(sigmaTempC) ? clamp(1 - sigmaTempC / 3, 0, 1) : null;

  let aMod = null;
  const componentiMod = [];
  if (Number.isFinite(diffTempC)) componentiMod.push(clamp(1 - diffTempC / 4, 0, 1));
  if (Number.isFinite(diffRaffKmh)) componentiMod.push(clamp(1 - diffRaffKmh / 25, 0, 1));
  if (componentiMod.length) {
    aMod = componentiMod.reduce((s, x) => s + x, 0) / componentiMod.length;
  }

  const aLead = clamp(1 - 0.06 * Math.max(0, leadGiorni - 1), 0.1, 1);

  const disponibili = [aEns, aMod].filter((x) => x !== null);
  // Senza alcuna misura di accordo si resta neutri (base 0.5) e la
  // percentuale è guidata dal solo lead time
  const base = disponibili.length
    ? disponibili.reduce((s, x) => s + x, 0) / disponibili.length
    : 0.5;

  return {
    pct: Math.round(100 * aLead * (0.3 + 0.7 * base)),
    aEns,
    aMod,
    aLead,
    soloLead: disponibili.length === 0,
  };
}

// Etichetta qualitativa per la UI
export function etichettaAffidabilita(pct) {
  if (pct === null || !Number.isFinite(pct)) return 'n/d';
  if (pct >= 75) return 'alta';
  if (pct >= 50) return 'media';
  if (pct >= 30) return 'bassa';
  return 'molto bassa';
}

// Affidabilità COMPLESSIVA della previsione: media delle percentuali
// per tratto (solo quelle disponibili), null senza dati
export function affidabilitaGlobale(pctPerTratto) {
  const validi = (pctPerTratto || []).filter(Number.isFinite);
  if (!validi.length) return null;
  return Math.round(validi.reduce((s, x) => s + x, 0) / validi.length);
}

// Scala a 5 fasce per il badge globale, dal rosso al verde
export function classificaAffidabilitaGlobale(pct) {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (pct >= 85) return { etichetta: 'molto elevata', colore: '#2ea043' };
  if (pct >= 70) return { etichetta: 'elevata', colore: '#7ee787' };
  if (pct >= 50) return { etichetta: 'media', colore: '#f2cc60' };
  if (pct >= 30) return { etichetta: 'bassa', colore: '#f0883e' };
  return { etichetta: 'molto bassa', colore: '#da3633' };
}
