// ─────────────────────────────────────────────────────────────────────────
// Gestione di orari e fusi: conversione ora locale → UTC per un fuso IANA
// arbitrario (via Intl, senza librerie), formattazione per la UI.
// Copiato intatto da meteo-rotta (modulo puro, già testato).
// ─────────────────────────────────────────────────────────────────────────

// Offset (minuti) del fuso `tz` rispetto a UTC all'istante `date`
export function offsetMinuti(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parti = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  const comeUtc = Date.UTC(
    +parti.year,
    +parti.month - 1,
    +parti.day,
    parti.hour === '24' ? 0 : +parti.hour,
    +parti.minute
  );
  return (comeUtc - date.getTime()) / 60000;
}

// Interpreta "YYYY-MM-DD" + "HH:MM" come ora locale del fuso `tz`
// e restituisce la Date UTC corrispondente. Doppia iterazione per
// stabilizzare l'offset a cavallo dei cambi ora legale/solare.
export function dataLocaleAUtc(dataIso, oraStr, tz) {
  const [Y, Mo, D] = dataIso.split('-').map(Number);
  const [h, m] = oraStr.split(':').map(Number);
  let t = Date.UTC(Y, Mo - 1, D, h, m);
  for (let i = 0; i < 2; i++) {
    const off = offsetMinuti(new Date(t), tz);
    t = Date.UTC(Y, Mo - 1, D, h, m) - off * 60000;
  }
  return new Date(t);
}

// "HH:MM" di una Date nel fuso indicato (default: Italia)
export function formattaOra(date, tz = 'Europe/Rome') {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// "gio 30 lug, 08:05" nel fuso indicato
export function formattaDataOra(date, tz = 'Europe/Rome') {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// Giorni (frazionari) da adesso all'istante dato, mai negativi
export function leadGiorni(date) {
  return Math.max(0, (date.getTime() - Date.now()) / 86400000);
}

// Istante di un orario LOCALE (es. sosta pranzo alle 13:00) → minuti
// dalla partenza. Se l'orario è già passato alla partenza vale il giorno
// locale successivo, risolto ri-chiamando dataLocaleAUtc sulla data
// dopo (mai +24 h secche: il cambio ora legale le rompe). La differenza
// è in millisecondi UTC: DST-safe.
export function risolviOrarioSosta(dataIso, oraSosta, tz, partenzaUtcMs) {
  let t = dataLocaleAUtc(dataIso, oraSosta, tz).getTime();
  if (t <= partenzaUtcMs) {
    // Data successiva derivata a mezzogiorno UTC (immune dal fuso)
    const domani = new Date(Date.parse(dataIso + 'T12:00:00Z') + 86400000)
      .toISOString()
      .slice(0, 10);
    t = dataLocaleAUtc(domani, oraSosta, tz).getTime();
  }
  return (t - partenzaUtcMs) / 60000;
}

// Ora UTC arrotondata all'ora piena, formato Open-Meteo "YYYY-MM-DDTHH:00"
export function oraApiUtc(date, arrotonda = 'giu') {
  const t = new Date(date.getTime());
  if (arrotonda === 'su' && (t.getUTCMinutes() || t.getUTCSeconds())) {
    t.setUTCHours(t.getUTCHours() + 1);
  }
  t.setUTCMinutes(0, 0, 0);
  const p = (x) => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:00`;
}
