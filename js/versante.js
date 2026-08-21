// ─────────────────────────────────────────────────────────────────────────
// Esposizione SOLARE del pendio (aspect) e sua pendenza, ricavate dalle
// STESSE sonde DEM già scaricate per l'esposizione al vento: nessuna
// chiamata di rete aggiuntiva, nessuna cache in più.
//
// Differenza dal modulo esposizione.js, che resta separato:
// - esposizione.js risponde «quanto vento prende questo punto», in
//   funzione della direzione DA CUI soffia (riparo / cresta / pendio);
// - questo modulo risponde «verso dove guarda il pendio», che governa
//   quanto sole riceve e quindi quanto in fretta fonde neve e ghiaccio.
//
// A parità di quota un versante nord tiene la neve molto più a lungo di
// uno sud. Il fattore prodotto qui moltiplica la fusione a gradi-giorno
// in fondo.js. Su terreno pianeggiante l'aspect non ha significato: il
// fattore si smorza a 1.
//
// Modulo puro: il DEM arriva come array di quote, niente rete, niente DOM.
// ─────────────────────────────────────────────────────────────────────────

import { ESPOSIZIONE, FONDO } from './config.js';

const DIREZIONI = 8; // rombi da 45°, 0 = Nord, orario (stesso ordine di esposizione.js)
const ROMBI = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export const rombo = (gradi) =>
  ROMBI[Math.round((((gradi % 360) + 360) % 360) / 45) % 8];

// Fattore di fusione dall'aspect: massimo a sud (180°), minimo a nord.
// Curva coseno continua, senza scalini fra un rombo e l'altro.
// La pendenza smorza l'effetto: su un pianoro il sole arriva come la media.
export function fattoreFusione(aspectGradi, pendenzaPct) {
  if (!Number.isFinite(aspectGradi) || !Number.isFinite(pendenzaPct)) return 1;
  const k = Math.min(1, Math.max(0, pendenzaPct / FONDO.pendenzaMinVersantePct));
  const rad = ((aspectGradi - 180) * Math.PI) / 180;
  return 1 + FONDO.ampiezzaVersante * k * Math.cos(rad);
}

// Profili di versante dai risultati delle sonde DEM.
// campioni: [{lat, lon, eleM}]; quote: array allineato a
// puntiSondaEsposizione(campioni) — stesso ordine deterministico
// [centro, poi direzione 0..7 × raggio 0..2] per campione.
// Ritorna un profilo per campione, oppure null se quote non è un array.
export function versantiDaQuote(campioni, quote) {
  if (!Array.isArray(quote)) return null;
  const nRaggi = ESPOSIZIONE.raggiM.length;
  const per = 1 + DIREZIONI * nRaggi;
  const out = [];

  for (let i = 0; i < campioni.length; i++) {
    const base = i * per;
    // Centro dal DEM: i confronti devono essere DEM-contro-DEM (un offset
    // barometrico del GPX avvelenerebbe tutte le pendenze)
    let centro = quote[base];
    if (!Number.isFinite(centro)) centro = campioni[i]?.eleM;
    if (!Number.isFinite(centro)) {
      out.push({ aspectGradi: null, nome: null, pendenzaPct: null, fattoreFusione: 1 });
      continue;
    }

    // Pendenza con segno per direzione, dal raggio più CORTO disponibile:
    // l'insolazione di un tratto la governa il pendio locale, non la
    // dorsale a 1200 m (che invece conta per il vento).
    let vx = 0; // componente est del vettore di massima DISCESA
    let vy = 0; // componente nord
    let valide = 0;
    for (let di = 0; di < DIREZIONI; di++) {
      let s = null;
      for (let ri = 0; ri < nRaggi; ri++) {
        const q = quote[base + 1 + di * nRaggi + ri];
        if (!Number.isFinite(q)) continue; // buco DEM: raggio successivo
        s = (q - centro) / ESPOSIZIONE.raggiM[ri];
        break;
      }
      if (s === null) continue;
      const rad = (di * 45 * Math.PI) / 180;
      // Segno meno: il versante «guarda» dove il terreno SCENDE
      vx -= s * Math.sin(rad);
      vy -= s * Math.cos(rad);
      valide++;
    }

    if (valide < 4) {
      // Meno di metà bussola: l'aspect non è affidabile, niente correzione
      out.push({ aspectGradi: null, nome: null, pendenzaPct: null, fattoreFusione: 1 });
      continue;
    }

    // Su un pendio planare di pendenza p la somma vettoriale vale 4p con
    // 8 direzioni: il fattore 2/n riporta il modulo alla pendenza vera
    const modulo = (Math.hypot(vx, vy) * 2) / valide;
    const pendenzaPct = modulo * 100;
    if (modulo < 1e-4) {
      out.push({ aspectGradi: null, nome: null, pendenzaPct: 0, fattoreFusione: 1 });
      continue;
    }
    const aspectGradi = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
    out.push({
      aspectGradi,
      nome: rombo(aspectGradi),
      pendenzaPct,
      fattoreFusione: fattoreFusione(aspectGradi, pendenzaPct),
    });
  }
  return out;
}
