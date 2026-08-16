// ─────────────────────────────────────────────────────────────────────────
// Parser GPX testuale puro: niente DOMParser, deve girare anche in Node
// per i test. I GPX di Komoot, Outdooractive, Garmin e simili sono
// machine-generated e regolari: il parsing a espressioni regolari
// tollera l'ordine degli attributi e i tag self-closing.
// ─────────────────────────────────────────────────────────────────────────

// Estrae il primo <name>...</name> utile come nome del percorso
function estraiNome(testo) {
  // Preferisce il name dentro <trk>, ripiega su quello di <metadata>
  const trk = testo.match(/<trk\b[^>]*>[\s\S]*?<name>\s*([\s\S]*?)\s*<\/name>/);
  if (trk) return decodificaEntita(trk[1]);
  const meta = testo.match(/<name>\s*([\s\S]*?)\s*<\/name>/);
  return meta ? decodificaEntita(meta[1]) : null;
}

function decodificaEntita(s) {
  return s
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
  const re = new RegExp(
    `<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`,
    'g'
  );
  let m;
  while ((m = re.exec(testo)) !== null) {
    const attrs = m[1];
    const corpo = m[2] || '';
    const lat = attrs.match(/lat\s*=\s*["']\s*(-?[\d.]+)\s*["']/);
    const lon = attrs.match(/lon\s*=\s*["']\s*(-?[\d.]+)\s*["']/);
    if (!lat || !lon) continue;
    const ele = corpo.match(/<ele>\s*(-?[\d.]+)\s*<\/ele>/);
    const p = {
      lat: parseFloat(lat[1]),
      lon: parseFloat(lon[1]),
      eleM: ele ? parseFloat(ele[1]) : null,
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
  // Traccia registrata/pianificata; in mancanza, la rotta (rtept)
  let punti = estraiPunti(testo, 'trkpt');
  if (!punti.length) punti = estraiPunti(testo, 'rtept');
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
