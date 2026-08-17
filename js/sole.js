// ─────────────────────────────────────────────────────────────────────────
// Tramonto (e alba) con l'equazione del sorgere del sole (algoritmo NOAA
// semplificato, precisione ~1-2 minuti alle latitudini escursionistiche).
// Modulo puro, validato nei test contro effemeridi note di Roma.
// Longitudine EST positiva, risultato in Date UTC.
// ─────────────────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;

// Jset/Jrise per il giorno solare più vicino alla data passata.
// Restituisce { albaUtc, tramontoUtc } oppure null (sole mai sotto o mai
// sopra l'orizzonte: notte o giorno polare).
export function albaTramontoUtc(data, lat, lon) {
  if (!(data instanceof Date) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const jd = data.getTime() / 86400000 + 2440587.5;
  const lw = -lon; // convenzione ovest-positiva dell'algoritmo
  const n = Math.round(jd - 2451545.0009 - lw / 360);

  const jStar = 2451545.0009 + lw / 360 + n; // mezzogiorno solare medio
  const M = (357.5291 + 0.98560028 * (jStar - 2451545)) % 360; // anomalia media
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360; // longitudine eclittica
  const jTransit =
    jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDelta = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDelta = Math.cos(Math.asin(sinDelta));
  // -0.833°: rifrazione atmosferica + semidiametro del disco solare
  const cosOmega =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDelta) /
    (Math.cos(lat * RAD) * cosDelta);
  if (cosOmega < -1 || cosOmega > 1) return null; // giorno o notte polare
  const omega = Math.acos(cosOmega) / RAD;

  const daJd = (j) => new Date((j - 2440587.5) * 86400000);
  return {
    albaUtc: daJd(jTransit - omega / 360),
    tramontoUtc: daJd(jTransit + omega / 360),
  };
}

export function tramontoUtc(data, lat, lon) {
  return albaTramontoUtc(data, lat, lon)?.tramontoUtc ?? null;
}
