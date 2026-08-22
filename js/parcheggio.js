// ─────────────────────────────────────────────────────────────────────────
// Taratura dell'ALTIMETRO BAROMETRICO al parcheggio. Chi cammina con un
// orologio ad altimetro lo tara prima di partire: questo modulo gli dà i
// tre numeri che servono, dal DEM e dal modello meteo:
// 1. la quota del parcheggio (DEM Copernicus GLO-90 via Elevation API,
//    scaricata da app.js: qui arriva come numero);
// 2. la pressione prevista alla partenza al livello del mare (QNH,
//    pressure_msl) e alla quota del parcheggio (QFE, surface_pressure
//    chiesta al modello con elevation = quota DEM: il modello la riporta
//    a quella quota, verificato dal vivo il 22/08/2026);
// 3. la deriva attesa della lettura fra partenza e arrivo: la pressione
//    alla quota del parcheggio cambia durante la gita (fronte in arrivo,
//    ma anche il semplice riscaldamento diurno della colonna d'aria:
//    ~3 mbar fra notte e mezzogiorno a 2100 m, verificato su ICON-2I) e
//    l'altimetro la legge come dislivello.
//
// Raccomandazione nei testi: taratura sulla QUOTA nota, QNH solo come
// controllo. L'orologio ragiona in atmosfera standard (15 °C al mare,
// −6,5 °C/km): tarato sulla QNH sbaglia del 3,5% del dislivello ogni
// 10 °C di scarto dalla standard (a Campo Imperatore d'estate ~75 m);
// tarato sulla quota azzera l'errore nel punto di partenza.
//
// Perché non il GPS del telefono: la quota del browser è ellissoidica
// WGS84, in Italia ~45-50 m sopra il livello del mare.
//
// Unità: l'API risponde in hPa, l'utente legge MILLIBAR sull'altimetro.
// 1 hPa = 1 mbar, nessuna conversione: i campi interni restano «Hpa»
// (unità dell'API), i testi dicono «mbar».
//
// Modulo puro: nessuna rete, nessun DOM, testabile in Node. I testi
// italiani nascono qui (unica fonte per riepilogo, PDF e CSV, come
// fondo.js); le soglie stanno in config.js (ALTIMETRO).
// ─────────────────────────────────────────────────────────────────────────

import { ALTIMETRO } from './config.js';
import { distanzaKm } from './geo.js';

// Costanti fisiche (CODATA / atmosfera standard ICAO), come SIGMA in
// radiante.js: non sono parametri da tarare
const G = 9.80665; // m/s²
const R_GAS = 8.314462618; // J/(mol·K)
const M_ARIA = 0.0289644; // kg/mol
const R_ARIA = R_GAS / M_ARIA; // ≈ 287,06 J/(kg·K)
const K0 = 273.15;
const T0_ISA = 288.15; // K al livello del mare, atmosfera standard
const ESP_ISA = (G * M_ARIA) / (R_GAS * ALTIMETRO.gradienteTermicoKPerM); // ≈ 5,2558

// Etichetta di pressione per l'utente (1 hPa = 1 mbar)
export const UNITA_PRESSIONE = 'mbar';

const numero = (arr, i) => {
  const x = arr?.[i];
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};
// Numero in formato italiano («793,4»), «–» se mancante
const un = (v, dec = 0, u = '') =>
  Number.isFinite(v) ? `${v.toFixed(dec).replace('.', ',')}${u}` : '–';
const pressioneTesto = (v) => `${un(v, 1)} ${UNITA_PRESSIONE}`;
// «+25» / «−32» (meno tipografico, come nel riepilogo di app.js). Il
// segno si legge dal valore GIÀ arrotondato: −0,4 m deve dare «0 m», non
// un «−0 m» che sembra un errore di calcolo
const conSegno = (v) => {
  const r = Math.round(v);
  return r === 0 ? '0' : `${r < 0 ? '−' : '+'}${Math.abs(r)}`;
};
const distanzaTesto = (m) => (m < 1000 ? `${Math.round(m)} m` : `${un(m / 1000, 1)} km`);

// ── Coordinate dal campo di testo ───────────────────────────────────────
// Solo DECIMALI: «42.4428, 13.5582», «42.4428 13.5582», «42.4428;13.5582»;
// la virgola vale come decimale se nel testo non ci sono punti («42,4428
// 13,5582», «42,4428; 13,5582»); tollera prefissi/suffissi N/S/E/W (S e W
// negativi, anche staccati) e le parole lat/lon/lng (con «:» o «=»); se
// le lettere dicono che la longitudine è scritta per prima, le scambia.
// Una lettera staccata fra i due numeri è prefisso del secondo («42.44 E
// 13.55» = E 13.55, ordine scritto); con due lettere staccate vale lo
// stile dell'altra (N1 L N2 L → suffissi, L N1 L N2 → prefissi).
// Rifiuta: numero di valori diverso da 2, fuori range (|lat| > 90,
// |lon| > 180), gradi-minuti-secondi, lettere incoerenti o doppie.
// Ingresso: stringa. Uscita: { lat, lon } oppure null.
const ETICHETTE = /\b(?:lat(?:itudine|itude)?|lon(?:gitudine|gitude|g)?|lng)\b\s*[:=]?/g;
const TOKEN_NUMERO = /^([nsew])?([+-]?\d+(?:\.\d+)?)°?([nsew])?$/;

export function parseCoordinate(testo) {
  if (typeof testo !== 'string') return null;
  const s = testo
    .trim()
    .toLowerCase()
    .replace(ETICHETTE, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/;/g, ' ')
    .trim();
  if (!s) return null;

  // Virgola decimale (it-IT) solo se nel testo non c'è nessun punto
  let grezzi;
  if (s.includes('.')) {
    grezzi = s.replace(/,/g, ' ').trim().split(/\s+/);
  } else {
    const parti = s.split(/\s+/);
    grezzi =
      parti.length === 1
        ? parti[0].split(',') // «42,13» → la virgola separa
        : parti
            .map((p) => p.replace(/^,+|,+$/g, '')) // «95, 13» → virgola di bordo
            .filter(Boolean)
            .map((p) => p.replace(',', '.')); // «42,4428 13,5582» → decimale
  }

  // Token: numero (con eventuale lettera di emisfero attaccata) o lettera sola
  const token = [];
  for (const t of grezzi) {
    if (!t) continue;
    if (/^[nsew]$/.test(t)) {
      token.push({ lettera: t, sola: true });
      continue;
    }
    const m = TOKEN_NUMERO.exec(t);
    if (!m || (m[1] && m[3])) return null;
    const v = Number(m[2]);
    if (!Number.isFinite(v)) return null;
    token.push({ v, lettera: m[1] || m[3] || '' });
  }

  // Stile delle lettere staccate (prefisso/suffisso) dalle posizioni certe
  const eNumero = (t) => t && 'v' in t;
  let prefissi = 0;
  let suffissi = 0;
  token.forEach((t, i) => {
    if (!t.sola) return;
    const prima = eNumero(token[i - 1]);
    const dopo = eNumero(token[i + 1]);
    if (dopo && !prima) prefissi++;
    else if (prima && !dopo) suffissi++;
  });
  const stilePrefisso = suffissi <= prefissi;
  for (let i = 0; i < token.length; i++) {
    const t = token[i];
    if (!t.sola) continue;
    const prima = eNumero(token[i - 1]);
    const dopo = eNumero(token[i + 1]);
    let bersaglio = null;
    if (dopo && (!prima || stilePrefisso)) bersaglio = token[i + 1];
    else if (prima) bersaglio = token[i - 1];
    if (!bersaglio || bersaglio.lettera) return null; // lettera orfana o doppia
    bersaglio.lettera = t.lettera;
  }

  const numeri = token.filter(eNumero);
  if (numeri.length !== 2) return null;
  const eLon = (l) => l === 'e' || l === 'w';
  const eLat = (l) => l === 'n' || l === 's';
  let [a, b] = numeri;
  if (eLon(a.lettera) || eLat(b.lettera)) [a, b] = [b, a];
  if (eLon(a.lettera) || eLat(b.lettera)) return null; // lettere incoerenti
  const conEmisfero = (t) => (t.lettera === 's' || t.lettera === 'w' ? -Math.abs(t.v) : t.v);
  const lat = conEmisfero(a);
  const lon = conEmisfero(b);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Distanza in metri fra il parcheggio {lat, lon} e l'attacco del sentiero
// {lat, lon} (primo punto del percorso). Null se manca un punto.
export function distanzaAttaccoM(parcheggio, attacco) {
  if (![parcheggio?.lat, parcheggio?.lon, attacco?.lat, attacco?.lon].every(Number.isFinite)) {
    return null;
  }
  return distanzaKm(parcheggio, attacco) * 1000;
}

// ── Fisica ──────────────────────────────────────────────────────────────

// QFE dalla QNH con la formula ipsometrica P = P0·exp(−g·M·h / (R·T_media)).
// T_media dello strato mare→quota = temperatura prevista ALLA QUOTA più
// metà del gradiente standard verso il basso (6,5 °C/km · h / 2): è
// l'ipotesi della riduzione al mare dei modelli, e riproduce entro 0,3 mbar
// i valori verificati dal vivo (QNH 1018,7 · 2133 m · 11,5 °C → 793,4;
// cella 1934 m → 812,4). Null se un ingresso non è finito: mai inventare.
export function qfeDaQnh(qnhHpa, quotaM, tempC) {
  if (![qnhHpa, quotaM, tempC].every(Number.isFinite)) return null;
  const tMedia = tempC + K0 + (ALTIMETRO.gradienteTermicoKPerM * quotaM) / 2;
  if (tMedia <= 0) return null;
  return qnhHpa * Math.exp((-G * M_ARIA * quotaM) / (R_GAS * tMedia));
}

// Pressione al mare che un altimetro tarato sulla quota ricostruisce con
// l'ATMOSFERA STANDARD (quella che l'orologio mostra): differisce dalla
// QNH reale per la temperatura vera della colonna (793,4 mbar a 2133 m →
// 1028,1 mbar contro QNH 1018,7). Null se un ingresso non è finito.
export function qnhStandardDaQfe(qfeHpa, quotaM) {
  if (![qfeHpa, quotaM].every(Number.isFinite)) return null;
  const base = 1 - (ALTIMETRO.gradienteTermicoKPerM * quotaM) / T0_ISA;
  return base <= 0 ? null : qfeHpa / Math.pow(base, ESP_ISA);
}

// Deriva della lettura di un altimetro tarato alla partenza, A PARITÀ DI
// QUOTA VERA, quando la pressione cambia: Δh ≈ −(R_aria·T_K/g)·(ΔP/P), con
// ΔP = arrivo − partenza e P la pressione di riferimento alla quota (QFE).
// Segno: positivo = all'arrivo l'altimetro segna PIÙ del vero (pressione
// in calo). Con ΔP = −3 mbar, P = 793 mbar, T = 11,5 °C → +31,5 m.
// Le prime due grandezze possono essere le QNH (variazione sinottica) o,
// più fedelmente, le QFE previste alla quota (che comprendono il
// riscaldamento diurno della colonna): sceglie valutaParcheggio.
// Null se un ingresso non è finito o P ≤ 0.
export function derivaAltimetroM(pPartenzaHpa, pArrivoHpa, pRiferimentoHpa, tempC) {
  if (![pPartenzaHpa, pArrivoHpa, pRiferimentoHpa, tempC].every(Number.isFinite)) return null;
  if (pRiferimentoHpa <= 0) return null;
  return -((R_ARIA * (tempC + K0)) / G) * ((pArrivoHpa - pPartenzaHpa) / pRiferimentoHpa);
}

// ── Estrazione all'istante dalle serie orarie ───────────────────────────
// serieCampione = { t0Ms, valori: { pressure_msl, surface_pressure,
// temperature_2m } } come esce da meteoSerie (un campione). Le tre
// variabili sono ISTANTANEE in Open-Meteo (il valore etichettato H vale
// ALL'ORA H; la nota «H−1 → H» di api/meteo.js riguarda le cumulate come
// la pioggia) e la pressione è liscia: interpolazione LINEARE fra le due
// ore che racchiudono l'istante. Buco su un estremo: si usa l'altro
// (tolleranza ±1 h come valoriAllOra del pianificatore, MAI il ±3 di
// valoreVicino). opzioni.quotaM: quota con cui il chiamante ha chiesto la
// serie (parametro elevation); senza, qfeHpa resta null (la pressione al
// suolo di una cella a quota ignota non è la QFE del parcheggio).
// surface_pressure mancante con quota nota → ripiego qfeDaQnh
// (qfeStimata true).
// Uscita: { qnhHpa, qfeHpa, tempC, qfeStimata } oppure null (istante fuori
// finestra o QNH assente su entrambi gli estremi).
export function pressioneAllIstante(serieCampione, istanteMs, { quotaM = null } = {}) {
  const v = serieCampione?.valori;
  if (!serieCampione || !Number.isFinite(serieCampione.t0Ms) || !v || !Number.isFinite(istanteMs)) {
    return null;
  }
  const n = Math.max(
    v.pressure_msl?.length || 0,
    v.surface_pressure?.length || 0,
    v.temperature_2m?.length || 0
  );
  const x = (istanteMs - serieCampione.t0Ms) / 3600000;
  if (!n || x < 0 || x > n - 1) return null;
  const i0 = Math.floor(x);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = x - i0;
  const lineare = (arr) => {
    const a = numero(arr, i0);
    const b = numero(arr, i1);
    if (a !== null && b !== null) return a + (b - a) * f;
    return a ?? b;
  };
  const qnhHpa = lineare(v.pressure_msl);
  if (qnhHpa === null) return null;
  const tempC = lineare(v.temperature_2m);
  let qfeHpa = null;
  let qfeStimata = false;
  if (Number.isFinite(quotaM)) {
    qfeHpa = lineare(v.surface_pressure);
    if (qfeHpa === null) {
      qfeHpa = qfeDaQnh(qnhHpa, quotaM, tempC);
      qfeStimata = qfeHpa !== null;
    }
  }
  return { qnhHpa, qfeHpa, tempC, qfeStimata };
}

// ── Valutazione e testi ─────────────────────────────────────────────────
// Ingresso: { quotaM, quotaAttaccoM, distanzaAttaccoM, partenza, arrivo }
// con partenza/arrivo = { oraIso, oraLocale, qnhHpa, qfeHpa, tempC,
// qfeStimata } | null; oraLocale già formattata dal chiamante col fuso
// del percorso (il modulo non conosce il fuso, come c.oraLocale in app.js).
// Uscita: { derivaM|null, classeDeriva: 'trascurabile'|'moderata'|'forte'|null,
//           avvisi: string[], righe: [{ etichetta, valore }] }.
// Regole: ogni dato mancante è DICHIARATO («non disponibile»), mai un
// numero inventato. La deriva nasce dalla variazione della QFE prevista
// alla quota del parcheggio (riscaldamento diurno compreso), con ripiego
// sulla variazione di QNH riferita alla QFE se una QFE manca; senza quota
// né QFE la deriva non si calcola.
const classificaDeriva = (v) =>
  Math.abs(v) < ALTIMETRO.derivaModerataM
    ? 'trascurabile'
    : Math.abs(v) < ALTIMETRO.derivaForteM
      ? 'moderata'
      : 'forte';
const media = (xs) => {
  const ok = xs.filter(Number.isFinite);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};
const validaPressione = (x) =>
  x && Number.isFinite(x.qnhHpa) ? { ...x, oraLocale: x.oraLocale || '—' } : null;

export function valutaParcheggio({
  quotaM = null,
  quotaAttaccoM = null,
  distanzaAttaccoM = null,
  partenza = null,
  arrivo = null,
} = {}) {
  const righe = [];
  const avvisi = [];
  const quotaOk = Number.isFinite(quotaM);
  const p = validaPressione(partenza);
  const a = validaPressione(arrivo);

  // 1. Quota del parcheggio
  righe.push({
    etichetta: 'Quota parcheggio (DEM 90 m)',
    valore: quotaOk ? `${Math.round(quotaM)} m` : 'non disponibile',
  });
  if (!quotaOk) {
    avvisi.push(
      'Quota del parcheggio non disponibile: tara l’altimetro sulla quota del cartello o della carta, non sulla QNH'
    );
  }

  // 2. Attacco del sentiero
  if (Number.isFinite(distanzaAttaccoM)) {
    const q = Number.isFinite(quotaAttaccoM) ? `, quota ${Math.round(quotaAttaccoM)} m` : '';
    righe.push({ etichetta: 'Attacco del sentiero', valore: `a ${distanzaTesto(distanzaAttaccoM)}${q}` });
    if (distanzaAttaccoM > ALTIMETRO.distanzaAttaccoAvvisoM) {
      avvisi.push(
        `Parcheggio a ${distanzaTesto(distanzaAttaccoM)} dall’attacco del sentiero: controlla le coordinate`
      );
    }
  }

  // 3. Partenza: QNH, QFE, QNH «dell'orologio», temperatura
  if (p) {
    righe.push({ etichetta: `QNH prevista alle ${p.oraLocale}`, valore: pressioneTesto(p.qnhHpa) });
    if (quotaOk) {
      righe.push({
        etichetta: `Pressione alla quota del parcheggio alle ${p.oraLocale}`,
        valore: Number.isFinite(p.qfeHpa)
          ? `${pressioneTesto(p.qfeHpa)}${p.qfeStimata ? ' (stimata dalla QNH)' : ''}`
          : 'non disponibile',
      });
      const qnhIsa = qnhStandardDaQfe(p.qfeHpa, quotaM);
      if (qnhIsa !== null) {
        const scarto = qnhIsa - p.qnhHpa;
        const nota =
          Math.abs(scarto) >= ALTIMETRO.scartoQnhStandardHpa
            ? ` — ${pressioneTesto(Math.abs(scarto))} ${scarto > 0 ? 'più' : 'meno'} della QNH prevista per la temperatura reale: non correggere la quota per farle coincidere`
            : '';
        righe.push({
          etichetta: 'QNH secondo l’orologio tarato sulla quota (atmosfera standard)',
          valore: `${pressioneTesto(qnhIsa)}${nota}`,
        });
      }
    }
    if (Number.isFinite(p.tempC)) {
      righe.push({ etichetta: `Temperatura prevista alle ${p.oraLocale}`, valore: `${un(p.tempC, 1)} °C` });
    }
  } else {
    righe.push({ etichetta: 'QNH prevista alla partenza', valore: 'non disponibile' });
    avvisi.push('Pressione prevista al parcheggio non disponibile: QNH e deriva non calcolate');
  }

  // 4. Arrivo e deriva
  let derivaM = null;
  let classeDeriva = null;
  if (p && a) {
    const dQnh = a.qnhHpa - p.qnhHpa;
    const tendenza =
      Math.abs(dQnh) < ALTIMETRO.qnhStazionariaHpa
        ? 'stazionaria'
        : dQnh < 0
          ? `in calo di ${pressioneTesto(-dQnh)}`
          : `in aumento di ${pressioneTesto(dQnh)}`;
    righe.push({
      etichetta: `QNH prevista alle ${a.oraLocale}`,
      valore: `${pressioneTesto(a.qnhHpa)} (${tendenza})`,
    });
    const tMedia = media([p.tempC, a.tempC]);
    // La deriva va calcolata sulla pressione ALLA QUOTA ai due estremi,
    // e i due valori devono venire dalla stessa fonte: mescolare la QFE
    // del modello con una stimata dalla QNH produce una differenza
    // artificiale. Se una manca o le fonti differiscono, si ripiega sulla
    // variazione di QNH e lo si DICHIARA nella riga.
    const qfeCoerente =
      Number.isFinite(p.qfeHpa) && Number.isFinite(a.qfeHpa) && p.qfeStimata === a.qfeStimata;
    let notaMetodo = '';
    if (qfeCoerente) {
      derivaM = derivaAltimetroM(p.qfeHpa, a.qfeHpa, p.qfeHpa, tMedia);
    } else {
      const rif = Number.isFinite(p.qfeHpa)
        ? p.qfeHpa
        : Number.isFinite(a.qfeHpa)
          ? a.qfeHpa
          : qfeDaQnh(p.qnhHpa, quotaM, tMedia);
      derivaM = derivaAltimetroM(p.qnhHpa, a.qnhHpa, rif, tMedia);
      if (derivaM !== null) {
        notaMetodo = ' — stimata dalla variazione di QNH: pressione alla quota mancante a un estremo';
      }
    }
    if (derivaM === null) {
      righe.push({ etichetta: `Deriva attesa fino alle ${a.oraLocale}`, valore: 'non calcolabile' });
      avvisi.push(
        'Deriva dell’altimetro non calcolabile: manca la quota del parcheggio o la temperatura prevista'
      );
    } else {
      classeDeriva = classificaDeriva(derivaM);
      // Il verso nomina la pressione ALLA QUOTA: nelle giornate serene
      // può salire (riscaldamento della colonna) mentre la QNH scende,
      // e il testo generico contraddirebbe la riga della tendenza QNH
      const verso =
        derivaM > 0.5
          ? 'pressione alla quota in calo: l’altimetro segnerà più del vero'
          : derivaM < -0.5
            ? 'pressione alla quota in aumento: l’altimetro segnerà meno del vero'
            : 'pressione alla quota stabile';
      righe.push({
        etichetta: `Deriva attesa fino alle ${a.oraLocale}`,
        valore: `${conSegno(derivaM)} m (${verso})${notaMetodo}`,
      });
      if (classeDeriva === 'forte') {
        avvisi.push(
          `Deriva dell’altimetro di ${conSegno(derivaM)} m entro le ${a.oraLocale}: ricalibra su una quota nota lungo il percorso (cima, rifugio, bivio quotato)`
        );
      }
    }
  } else if (p && !a) {
    righe.push({ etichetta: 'Deriva attesa', valore: 'non calcolabile' });
    avvisi.push('Pressione all’arrivo non disponibile: deriva dell’altimetro non calcolata');
  }

  // 5. Istruzione di taratura
  righe.push({
    etichetta: 'Taratura',
    valore: quotaOk
      ? `Tara l’altimetro sulla quota ${Math.round(quotaM)} m al parcheggio. La QNH serve solo come controllo`
      : 'Tara l’altimetro su una quota nota (cartello, carta). La QNH serve solo come controllo',
  });

  return { derivaM, classeDeriva, avvisi, righe };
}
