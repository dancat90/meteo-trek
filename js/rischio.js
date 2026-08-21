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

// Score convettivo indiretto 0-2 da CAPE + lifted index + LPI, con il
// CIN come inibitore. Principio del cap invariato: l'evidenza indiretta
// non produce mai 3 (il weather_code temporalesco resta l'unico 3 diretto).
// v: {cape, lifted_index, convective_inhibition, lightning_potential}
export function scoreConvezione(v) {
  const sCape = Number.isFinite(v?.cape)
    ? v.cape >= S.cape[1] ? 2 : v.cape >= S.cape[0] ? 1 : 0
    : 0;
  const sLi = Number.isFinite(v?.lifted_index)
    ? v.lifted_index <= S.li[1] ? 2 : v.lifted_index <= S.li[0] ? 1 : 0
    : 0;
  const sLpi = Number.isFinite(v?.lightning_potential)
    ? v.lightning_potential >= S.lpi[1] ? 2 : v.lightning_potential >= S.lpi[0] ? 1 : 0
    : 0;

  let s = Math.max(sCape, sLi, sLpi);
  // Evidenze concordanti energia (CAPE) + instabilità (LI): segnale robusto
  if (sCape >= 1 && sLi >= 1) s = 2;

  // Inibitore CIN: magnitudine positiva su Open-Meteo; valori negativi
  // (sentinella -1 di MeteoSwiss = non calcolabile) trattati come assenti.
  // Declassa di 1 ma mai sotto 1 con CAPE sopra soglia: in montagna il
  // sollevamento orografico rompe il cap più facilmente che in pianura.
  // LPI ≥ soglia alta ignora il declassamento: ingloba già la dinamica.
  const cin = v?.convective_inhibition;
  if (Number.isFinite(cin) && cin >= 0 && cin >= S.cin[1] && sLpi < 2) {
    s = Math.max(sCape >= 1 ? 1 : 0, s - 1);
  }
  return Math.min(2, s);
}

// Riga «convezione» per il dettaglio tabella: solo i campi presenti,
// null se non c'è nessun dato. fonteLi = nome del modello ponte (GFS)
// quando il lifted index non viene dal primario.
export function descriviConvezione(v) {
  if (!v) return null;
  const parti = [];
  if (Number.isFinite(v.cape)) {
    const nota = v.cape >= S.cape[1] ? 'molto alto' : v.cape >= S.cape[0] ? 'alto' : 'basso';
    parti.push(`CAPE ${Math.round(v.cape)} J/kg (${nota})`);
  }
  if (Number.isFinite(v.li)) {
    const nota = v.li <= S.li[1] ? 'molto instabile' : v.li <= S.li[0] ? 'instabile' : 'stabile';
    const fonte = v.fonteLi ? `${v.fonteLi}: ` : '';
    parti.push(`LI ${v.li.toFixed(1).replace('.', ',')} (${fonte}${nota})`);
  }
  const cin = v.cin;
  if (Number.isFinite(cin) && cin >= 0) {
    const nota =
      cin >= S.cin[1]
        ? 'convezione bloccata: serve un innesco forte'
        : cin >= S.cin[0]
          ? 'inibizione significativa'
          : 'nessun freno';
    parti.push(`CIN ${Math.round(cin)} J/kg (${nota})`);
  }
  if (Number.isFinite(v.lpi)) {
    const nota =
      v.lpi >= S.lpi[1] ? 'fulmini probabili' : v.lpi >= S.lpi[0] ? 'fulmini possibili' : 'trascurabile';
    parti.push(`LPI ${v.lpi.toFixed(1).replace('.', ',')} J/kg (${nota})`);
  }
  return parti.length ? `convezione: ${parti.join(' · ')}` : null;
}

// valori: oggetto {nomeVar: valore} del modello primario al passaggio
// percepitaC: temperatura percepita (può differire da valori se in
// futuro arriverà l'UTCI)
// scoreFondo: canale dello stato del terreno (fondo.js), già col suo cap
// interno — ghiaccio e crosta fino a 3, neve fino a 2, fango ESCLUSO.
// Il fango resta un avviso a parte: se alzasse il rischio complessivo,
// ogni gita autunnale col cielo perfetto risulterebbe rischiosa.
export function scoreCanali(valori, percepitaC, scoreFondo = null) {
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
  // gli indici convettivi (CAPE/LI/LPI, CIN inibitore) sono potenziale,
  // non temporale in atto: cap a 2 dentro scoreConvezione
  const temporale = S.codiciTemporale.includes(valori.weather_code)
    ? 3
    : scoreConvezione(valori);

  const vento = aSoglie(valori.wind_gusts_10m, S.raffKmh);
  const freddo = aSoglieDiscendenti(percepitaC, S.freddoC);

  // Caldo: percepita alta, con l'UV a rinforzo (l'UV estremo da solo
  // vale al massimo 2: scotta ma non è un'emergenza termica)
  const caldoTermico = aSoglie(percepitaC, S.caldoC);
  const caldoUv = Math.min(2, aSoglie(valori.uv_index, S.uv));
  const caldo = Math.max(caldoTermico, caldoUv);

  const canali = { pioggia, temporale, vento, freddo, caldo };
  // Sesto canale solo quando lo stato del fondo è stato davvero calcolato:
  // un `fondo: 0` su dati assenti farebbe passare «ignoto» per «sicuro»
  if (Number.isFinite(scoreFondo)) canali.fondo = Math.max(0, Math.min(3, scoreFondo));
  return canali;
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
    fondo: 'fondo (neve/ghiaccio)',
  };
  return Object.entries(canali)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ nome: NOMI[k], score: v }));
}
