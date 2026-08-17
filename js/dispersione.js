// ─────────────────────────────────────────────────────────────────────────
// Fascia multi-modello di una grandezza scalare (temperatura, percepita):
// mediana, min-max e classe di accordo fra i modelli. Modulo puro,
// testabile in Node. La mediana interpola come percentile() di
// js/api/ensemble.js. Razionale (diagnosi live 17/08/2026, Gran Sasso
// 2600 m): a parità di quota i deterministici divergono di ~3 °C, il
// numero secco di un solo modello è una falsa precisione.
// ─────────────────────────────────────────────────────────────────────────

import { SOGLIE_DISPERSIONE_TEMP } from './config.js';

// valori: array di numeri (i non finiti vengono ignorati).
// Restituisce { mediana, min, max, spread, n } oppure null se restano
// meno di 2 valori: con un solo modello la fascia non esiste.
export function fascia(valori) {
  const puliti = (valori || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = puliti.length;
  if (n < 2) return null;
  const pos = (n - 1) / 2;
  const lo = Math.floor(pos);
  const mediana = puliti[lo] + (puliti[Math.ceil(pos)] - puliti[lo]) * (pos - lo);
  return {
    mediana,
    min: puliti[0],
    max: puliti[n - 1],
    spread: puliti[n - 1] - puliti[0],
    n,
  };
}

// Accordo fra i modelli dalla dispersione min-max (°C):
// 'alta' ≤ soglie.alta, 'media' ≤ soglie.media, altrimenti 'bassa'.
export function classeDispersione(spread, soglie = SOGLIE_DISPERSIONE_TEMP) {
  if (!Number.isFinite(spread)) return null;
  if (spread <= soglie.alta) return 'alta';
  if (spread <= soglie.media) return 'media';
  return 'bassa';
}
