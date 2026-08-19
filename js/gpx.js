// ─────────────────────────────────────────────────────────────────────────
// Parser GPX testuale puro: niente DOMParser, deve girare anche in Node
// per i test. I GPX di Komoot, Outdooractive, Garmin e simili sono
// machine-generated e regolari: il parsing a espressioni regolari
// tollera l'ordine degli attributi, i tag self-closing e i prefissi di
// namespace (es. <ns0:trkpt> prodotto da ElementTree in Python).
// ─────────────────────────────────────────────────────────────────────────

// Prefisso di namespace XML opzionale (ns0:, gpx:, ...)
const PREF = '(?:[A-Za-z_][\\w.-]*:)?';
// Numero XML: niente token degeneri tipo "." o "-." (parseFloat li
// accetterebbe come NaN e avvelenerebbe la catena dei dislivelli)
const NUM = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

// Estrae il primo <name>...</name> utile come nome del percorso
function estraiNome(testo) {
  // Preferisce il name dentro <trk>, ripiega sul primo del documento
  const reTrk = new RegExp(
    `<${PREF}trk\\b[^>]*>[\\s\\S]*?<${PREF}name>\\s*([\\s\\S]*?)\\s*</${PREF}name>`
  );
  const trk = testo.match(reTrk);
  if (trk) return decodificaTesto(trk[1]);
  const meta = testo.match(new RegExp(`<${PREF}name>\\s*([\\s\\S]*?)\\s*</${PREF}name>`));
  return meta ? decodificaTesto(meta[1]) : null;
}

// CDATA + entità nominate e numeriche (&#232; &#x2019; ...)
function decodificaTesto(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

// Estrae i punti di un certo tag (trkpt o rtept) in ordine di documento:
// i trkseg multipli risultano concatenati per costruzione.
function estraiPunti(testo, tag) {
  const punti = [];
  const re = new RegExp(`<${PREF}${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${PREF}${tag}>)`, 'g');
  const reLat = new RegExp(`lat\\s*=\\s*["']\\s*(${NUM})\\s*["']`);
  const reLon = new RegExp(`lon\\s*=\\s*["']\\s*(${NUM})\\s*["']`);
  const reEle = new RegExp(`<${PREF}ele>\\s*(${NUM})\\s*</${PREF}ele>`);
  let m;
  while ((m = re.exec(testo)) !== null) {
    const attrs = m[1];
    const corpo = m[2] || '';
    const lat = attrs.match(reLat);
    const lon = attrs.match(reLon);
    if (!lat || !lon) continue;
    const ele = corpo.match(reEle);
    const eleVal = ele ? parseFloat(ele[1]) : null;
    const p = {
      lat: parseFloat(lat[1]),
      lon: parseFloat(lon[1]),
      // Solo quote finite: un ele malformato diventa null (quota assente),
      // mai NaN — i NaN bypasserebbero in silenzio tutte le guardie a valle
      eleM: Number.isFinite(eleVal) ? eleVal : null,
    };
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) punti.push(p);
  }
  return punti;
}

// Parsa un testo GPX. Restituisce { nome, punti, serveElevation }.
// Lancia un Error con messaggio in italiano se non c'è nessuna traccia.
export function parseGpx(testo) {
  if (typeof testo !== 'string' || !testo.includes('<')) {
    throw new Error('Il file non sembra un GPX');
  }
  // Traccia registrata/pianificata; in mancanza (o con una traccia
  // degenere sotto i 2 punti), la rotta (rtept) se è più completa
  let punti = estraiPunti(testo, 'trkpt');
  if (punti.length < 2) {
    const rotta = estraiPunti(testo, 'rtept');
    if (rotta.length >= 2) punti = rotta;
  }
  if (punti.length < 2) {
    throw new Error('Nessuna traccia trovata nel GPX (né trkpt né rtept)');
  }
  const senzaQuota = punti.filter((p) => p.eleM === null).length;
  return {
    nome: estraiNome(testo),
    punti,
    // Oltre il 20% di punti senza quota: meglio ricostruirle dal DEM
    serveElevation: senzaQuota / punti.length > 0.2,
  };
}
