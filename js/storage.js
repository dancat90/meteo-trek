// ─────────────────────────────────────────────────────────────────────────
// Persistenza locale: impostazioni, cronologia percorsi, ultimo risultato.
// In assenza di localStorage (test in Node) usa uno shim in memoria.
// Pattern copiato da meteo-rotta (sonda anti-SecurityError e anti-finto).
// ─────────────────────────────────────────────────────────────────────────

const memoria = new Map();
const shim = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
};
// L'accesso a window.localStorage può LANCIARE SecurityError (cookie e
// storage bloccati dal browser): il probe va protetto, altrimenti muore
// l'intera catena di import dell'app. La sonda set/get smaschera anche i
// localStorage "finti" (Node espone il globale ma senza --localstorage-file
// non salva nulla): in quel caso si ripiega sullo shim in memoria.
let ls;
try {
  ls = typeof localStorage !== 'undefined' && localStorage ? localStorage : shim;
  const sonda = '__mt_sonda__';
  ls.setItem(sonda, '1');
  if (ls.getItem(sonda) !== '1') ls = shim;
  else ls.removeItem(sonda);
} catch {
  ls = shim;
}

export function leggi(chiave, predefinito = null) {
  try {
    const v = ls.getItem(chiave);
    return v === null ? predefinito : JSON.parse(v);
  } catch {
    return predefinito;
  }
}

export function scrivi(chiave, valore) {
  try {
    ls.setItem(chiave, JSON.stringify(valore));
  } catch {
    // quota piena o storage negato: l'app funziona comunque senza cache
  }
}

export function rimuovi(chiave) {
  try {
    ls.removeItem(chiave);
  } catch {}
}

// ── Impostazioni utente ──────────────────────────────────────────────────

const PREDEFINITE = {
  mhSalita: 400,       // passo personale: m/h di dislivello in salita
  pausaMinOra: 10,     // pause brevi spalmate (minuti per ora di marcia)
  unitaVento: 'kmh',   // 'kmh' | 'ms'
  sogliaDrizzleMm: 0.1,
  // Avviso sullo stato del fondo (fango/neve/ghiaccio nei giorni prima):
  // acceso di default. Spegnerlo evita una chiamata di rete in più, utile
  // con connessione debole o traffico dati contato.
  fondoAttivo: true,
};

export function impostazioni() {
  return { ...PREDEFINITE, ...leggi('mt:impostazioni', {}) };
}

export function salvaImpostazioni(imp) {
  scrivi('mt:impostazioni', { ...impostazioni(), ...imp });
}

// ── Ultimo risultato completo (consultazione offline sul sentiero) ──────

export function ultimoRisultatoLeggi() {
  return leggi('mt:ultimoRisultato', null);
}

export function ultimoRisultatoScrivi(risultato) {
  scrivi('mt:ultimoRisultato', { salvatoIl: Date.now(), ...risultato });
}

// ── Cronologia percorsi (più recente prima, max 6) ───────────────────────
// Voce: { id, fonte ('komoot'|'outdooractive'|'gpx'), nome, km, payload,
//         parcheggio? }
// payload: komoot → { tourId }, outdooractive → { url },
// gpx → { punti } decimati (il file non è ri-scaricabile).
// parcheggio (opzionale): { lat, lon, quotaM|null } del parcheggio
// agganciato al percorso per la taratura dell'altimetro.

const MAX_CRONOLOGIA = 6;

export function cronologiaLeggi() {
  return leggi('mt:cronologia', []);
}

// Aggiunge o aggiorna una voce e RESTITUISCE la voce salvata (null se la
// voce non ha id). MERGE: se la voce già presente con lo stesso id ha un
// parcheggio e la nuova non dichiara la chiave (undefined), il parcheggio
// si conserva — una riapertura da Komoot/Outdooractive ricostruisce la
// voce da zero e non deve cancellarlo. `parcheggio: null` esplicito lo
// rimuove.
export function cronologiaAggiungi(voce) {
  if (!voce || !voce.id) return null;
  const tutte = cronologiaLeggi();
  const esistente = tutte.find((v) => v.id === voce.id);
  const finale = { ...voce };
  if (finale.parcheggio === undefined && esistente?.parcheggio) {
    finale.parcheggio = esistente.parcheggio;
  }
  if (finale.parcheggio === null || finale.parcheggio === undefined) delete finale.parcheggio;
  // Una voce già presente risale in cima aggiornata, senza duplicarsi
  const rimanenti = tutte.filter((v) => v.id !== voce.id);
  scrivi('mt:cronologia', [finale, ...rimanenti].slice(0, MAX_CRONOLOGIA));
  return finale;
}

// Aggiorna (o rimuove, con null) il parcheggio della voce con quell'id
// SENZA cambiarne la posizione. Salva solo { lat, lon, quotaM } sanificati.
// Restituisce la voce aggiornata, null se l'id non c'è o lat/lon non sono
// numeri.
export function cronologiaAggiornaParcheggio(id, parcheggio) {
  const tutte = cronologiaLeggi();
  const i = tutte.findIndex((v) => v.id === id);
  if (i < 0) return null;
  if (parcheggio === null) {
    const { parcheggio: _via, ...senza } = tutte[i];
    tutte[i] = senza;
  } else {
    if (!Number.isFinite(parcheggio?.lat) || !Number.isFinite(parcheggio?.lon)) return null;
    tutte[i] = {
      ...tutte[i],
      parcheggio: {
        lat: parcheggio.lat,
        lon: parcheggio.lon,
        quotaM: Number.isFinite(parcheggio.quotaM) ? parcheggio.quotaM : null,
      },
    };
  }
  scrivi('mt:cronologia', tutte);
  return tutte[i];
}

export function cronologiaRimuovi(id) {
  scrivi('mt:cronologia', cronologiaLeggi().filter((v) => v.id !== id));
}

export function cronologiaSvuota() {
  rimuovi('mt:cronologia');
}
