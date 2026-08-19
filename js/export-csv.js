// ─────────────────────────────────────────────────────────────────────────
// Export CSV del risultato: dati per tratto + registro avvisi, in un solo
// file con due sezioni (un solo download su mobile, avvisi attaccati ai
// dati a cui si riferiscono). Formato per Excel italiano: separatore «;»,
// decimali con virgola, BOM UTF-8, righe CRLF. Le celle dei numeri
// mancanti restano VUOTE (mai «–»: Excel deve poter fare medie).
// Modulo puro: nessun accesso al DOM, importabile da Node per i test.
// ─────────────────────────────────────────────────────────────────────────

import { ETICHETTE_RISCHIO } from './config.js';
import { formattaOra, formattaDataOra } from './tempo.js';

// "YYYY-MM-DD" del giorno LOCALE nel fuso del percorso (mai lo slice
// dell'ISO UTC: per le partenze notturne darebbe il giorno prima)
function dataIsoLocale(iso, tz) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

// 12.34 → '12,3' (virgola decimale per Excel italiano); non finito → ''
export function numeroIt(v, dec = 1) {
  if (!Number.isFinite(v)) return '';
  return v.toFixed(dec).replace('.', ',');
}

// Quota il campo fra virgolette se contiene ; " o a-capo; raddoppia le ".
// Anti CSV-injection: una cella che inizia con = + @ (o con - non
// numerico) verrebbe eseguita come formula da Excel: si antepone un
// apostrofo. I numeri negativi («-5,0») restano intatti.
export function campoCsv(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t]|^-(?!\d)/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Una riga CSV: celle unite da «;», terminatore CRLF (convenzione Excel)
export function rigaCsv(celle) {
  return celle.map(campoCsv).join(';') + '\r\n';
}

// Sezione TRATTI: una riga per campione meteo
export function csvCampioni(r) {
  const testata = [
    'km', 'ora', 'quota m', 'T °C', 'percepita °C', 'vento km/h',
    'raffiche km/h', 'umidita %', 'sole W/m2', 'nuvole %', 'base nubi m',
    'base stimata',
    'visibilita km', 'prob. pioggia %', 'pioggia mm', 'neve cm',
    'rischio', 'canali', 'UV grezzo', 'UV corretto quota/neve',
    'CAPE J/kg', 'LI', 'CIN J/kg', 'LPI J/kg',
  ];
  let out = 'TRATTI\r\n' + rigaCsv(testata);
  for (const c of r.campioni || []) {
    const v = c.valori || {};
    const canali = (c.canaliAttivi || []).map((k) => `${k.nome} ${k.score}`).join(' | ');
    out += rigaCsv([
      numeroIt(c.dCumKm, 1),
      c.oraLocale ?? '',
      numeroIt(c.eleM, 0),
      numeroIt(v.temperature_2m, 1),
      numeroIt(c.percepitaC, 1),
      numeroIt(v.wind_speed_10m, 0),
      numeroIt(v.wind_gusts_10m, 0),
      numeroIt(v.relative_humidity_2m, 0),
      numeroIt(v.shortwave_radiation, 0),
      numeroIt(v.cloud_cover, 0),
      numeroIt(c.nuvole?.baseM, 0),
      // La base può essere una stima (LCL), non un valore del modello
      c.nuvole?.stima ? 'si' : '',
      numeroIt(c.visibilita?.km, 1),
      numeroIt(v.precipitation_probability ?? c.ens?.popKN, 0),
      numeroIt(v.precipitation, 1),
      numeroIt(v.snowfall, 1),
      c.senzaDati ? 'n/d' : ETICHETTE_RISCHIO[c.score ?? 0] ?? '',
      canali,
      // Convenzione «colonne = valori del modello»: grezzo e corretto in
      // due colonne distinte, mai mescolati
      numeroIt(c.uv?.grezzo ?? v.uv_index, 1),
      numeroIt(c.uv?.uv, 1),
      numeroIt(c.convezione?.cape ?? v.cape, 0),
      numeroIt(c.convezione?.li, 1),
      numeroIt(c.convezione?.cin, 0),
      numeroIt(c.convezione?.lpi, 1),
    ]);
  }
  return out;
}

// Sezione AVVISI: il blocco ⚠ del riepilogo, una riga per avviso
export function csvAvvisi(r) {
  let out = 'AVVISI\r\n';
  const avvisi = r.avvisi || [];
  if (!avvisi.length) return out + rigaCsv(['nessun avviso']);
  for (const a of avvisi) out += rigaCsv([a]);
  return out;
}

// File completo: BOM (Excel riconosce l'UTF-8) + meta + TRATTI + AVVISI
export function csvCompleto(r) {
  const meta =
    rigaCsv(['percorso', r.nome ?? '']) +
    rigaCsv(['distanza km', numeroIt(r.totKm, 1)]) +
    rigaCsv(['dislivello +m/−m', `${r.dPlusM ?? ''} / ${r.dMinusM ?? ''}`]) +
    rigaCsv(['partenza', formattaDataOra(new Date(r.partenzaIso), r.tz)]) +
    // Se l'arrivo cade in un giorno locale diverso dalla partenza, la
    // sola ora sarebbe ambigua: si esporta data e ora complete
    rigaCsv([
      'arrivo previsto',
      dataIsoLocale(r.arrivoIso, r.tz) === dataIsoLocale(r.partenzaIso, r.tz)
        ? formattaOra(new Date(r.arrivoIso), r.tz)
        : formattaDataOra(new Date(r.arrivoIso), r.tz),
    ]) +
    rigaCsv(['modello', r.modello?.nome ?? '']) +
    // Sosta pranzo (null-safe sui risultati salvati senza il campo)
    (r.sosta
      ? rigaCsv([
          'sosta pranzo',
          `${r.sosta.durataMin} min al km ${numeroIt(r.sosta.dKm, 1)} (${r.sosta.oraInizio}–${r.sosta.oraFine})${r.sosta.motivo ? ', ' + r.sosta.motivo : ''}`,
        ])
      : '') +
    rigaCsv(['generato il', formattaDataOra(new Date(r.generatoIl), r.tz)]);
  return '\uFEFF' + meta + '\r\n' + csvCampioni(r) + '\r\n' + csvAvvisi(r);
}

// Nome file: meteo-trek_<nome-sanificato>_<AAAA-MM-GG>.csv
export function nomeFileCsv(r) {
  const slug = (r.nome || 'percorso')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'percorso';
  const data = dataIsoLocale(r.partenzaIso, r.tz) || 'data';
  return `meteo-trek_${slug}_${data}.csv`;
}
