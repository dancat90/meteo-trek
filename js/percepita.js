// ─────────────────────────────────────────────────────────────────────────
// Temperatura percepita. v1: apparent_temperature di Open-Meteo
// (formulazione Steadman: combina vento, umidità E radiazione solare —
// in cresta al sole d'estate è più ALTA della temperatura dell'aria,
// non è un semplice wind chill).
//
// Slot v2 (predisposto, non attivo): UTCI col polinomio a 210 termini
// già generato in meteo-casa (utci-poly.js) + ricostruzione della Tmrt
// (Di Napoli 2020). Trigger per farlo: uso invernale reale in quota,
// dove solo il ramo freddo UTCI è corretto con vento forte sotto zero.
// ─────────────────────────────────────────────────────────────────────────

export function percepita(valori) {
  const v = valori?.apparent_temperature;
  return Number.isFinite(v) ? v : null;
}

export const FONTE_PERCEPITA =
  'apparent_temperature Open-Meteo (Steadman: vento + umidità + sole)';
