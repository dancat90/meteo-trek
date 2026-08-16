// ─────────────────────────────────────────────────────────────────────────
// Rischio escursionistico per campione: 5 canali indipendenti fusi col
// massimo (pattern indici.js di meteo-rotta). Il cap anti-falso-allarme
// sta DENTRO i canali: l'evidenza indiretta non produce mai il livello 3
// da sola (es. CAPE alto senza weather_code temporalesco si ferma a 2).
// Score 0-3 → COLORI_SEVERITA / ETICHETTE_RISCHIO di config.js.
// ─────────────────────────────────────────────────────────────────────────

import { SOGLIE_RISCHIO as S, SOGLIA_DRIZZLE_MM } from './config.js';

function aSoglie(valore, soglie) {
  // soglie crescenti [s1, s2, s3] → score 1/2/3 al superamento
  if (!Number.isFinite(valore)) return 0;
  let score = 0;
  for (let i = 0; i < soglie.length; i++) if (valore >= soglie[i]) score = i + 1;
  return score;
}

function aSoglieDiscendenti(valore, soglie) {
  // soglie decrescenti [s1, s2, s3] → score 1/2/3 SOTTO la soglia
  if (!Number.isFinite(valore)) return 0;
  let score = 0;
  for (let i = 0; i < soglie.length; i++) if (valore <= soglie[i]) score = i + 1;
  return score;
}

// valori: oggetto {nomeVar: valore} del modello primario al passaggio
// percepitaC: temperatura percepita (può differire da valori se in
// futuro arriverà l'UTCI)
export function scoreCanali(valori, percepitaC) {
  const mm =
    Number.isFinite(valori.precipitation) && valori.precipitation >= SOGLIA_DRIZZLE_MM
      ? valori.precipitation
      : 0;
  let pioggia = aSoglie(mm, S.pioggiaMm);
  // Probabilità alta con quantità sotto soglia: almeno "attenzione"
  if (
    pioggia === 0 &&
    Number.isFinite(valori.precipitation_probability) &&
    valori.precipitation_probability >= S.popAlta &&
    mm > 0
  ) {
    pioggia = 1;
  }

  // Temporale: il weather_code temporalesco è evidenza diretta (score 3);
  // il CAPE da solo è potenziale, non temporale in atto: cap a 2
  let temporale = 0;
  if (S.codiciTemporale.includes(valori.weather_code)) temporale = 3;
  else if (Number.isFinite(valori.cape)) {
    if (valori.cape >= S.cape[1]) temporale = 2;
    else if (valori.cape >= S.cape[0]) temporale = 1;
  }

  const vento = aSoglie(valori.wind_gusts_10m, S.raffKmh);
  const freddo = aSoglieDiscendenti(percepitaC, S.freddoC);

  // Caldo: percepita alta, con l'UV a rinforzo (l'UV estremo da solo
  // vale al massimo 2: scotta ma non è un'emergenza termica)
  const caldoTermico = aSoglie(percepitaC, S.caldoC);
  const caldoUv = Math.min(2, aSoglie(valori.uv_index, S.uv));
  const caldo = Math.max(caldoTermico, caldoUv);

  return { pioggia, temporale, vento, freddo, caldo };
}

// Fusione: massimo dei canali (il cap sta già dentro i canali)
export function fusione(canali) {
  return Math.max(0, ...Object.values(canali));
}

// Canali non a zero, ordinati per gravità: per il dettaglio in tabella
export function canaliAttivi(canali) {
  const NOMI = {
    pioggia: 'pioggia',
    temporale: 'temporale',
    vento: 'raffiche',
    freddo: 'freddo',
    caldo: 'caldo/UV',
  };
  return Object.entries(canali)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ nome: NOMI[k], score: v }));
}
