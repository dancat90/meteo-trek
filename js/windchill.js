// ─────────────────────────────────────────────────────────────────────────
// Indice windchill JAG/TI (Environment Canada / NWS, 2001): la stessa
// formula della tabella di riferimento dell'utente (validata nei test
// contro le sue celle). Vale solo nel dominio invernale: T ≤ 10 °C e
// vento ≥ 4,8 km/h a 10 m. Fuori dominio restituisce null.
// ─────────────────────────────────────────────────────────────────────────

export function windchillC(tC, vKmh) {
  if (!Number.isFinite(tC) || !Number.isFinite(vKmh)) return null;
  if (tC > 10 || vKmh < 4.8) return null;
  const v016 = Math.pow(vKmh, 0.16);
  return 13.12 + 0.6215 * tC - 11.37 * v016 + 0.3965 * tC * v016;
}

// Classi di rischio congelamento della pelle esposta (legenda della
// tabella, soglie ufficiali Environment Canada)
export function classeCongelamento(wc) {
  if (!Number.isFinite(wc)) return null;
  if (wc <= -55) return { livello: 4, etichetta: 'congelamento in meno di 2 minuti' };
  if (wc <= -48) return { livello: 3, etichetta: 'congelamento in 2-5 minuti' };
  if (wc <= -40) return { livello: 2, etichetta: 'congelamento in 5-10 minuti' };
  if (wc <= -28) return { livello: 1, etichetta: 'congelamento possibile in ~30 minuti' };
  return { livello: 0, etichetta: 'rischio congelamento basso' };
}
