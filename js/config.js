// ─────────────────────────────────────────────────────────────────────────
// Costanti e configurazione condivise da tutta l'app.
// Modulo puro: nessun accesso al DOM, importabile anche da Node per i test.
// ─────────────────────────────────────────────────────────────────────────

export const VERSIONE = '1.0.0';

// Colori ed etichette delle 4 classi di rischio meteo (score 0-3).
// Palette ereditata da meteo-rotta, validata col validatore dataviz su
// superficie scura: coppie adiacenti distinguibili anche in deuteranopia.
export const COLORI_SEVERITA = ['#2ea043', '#f2cc60', '#f0883e', '#da3633'];
export const ETICHETTE_RISCHIO = ['buono', 'attenzione', 'avverso', 'severo'];

// ── Motore ETA ───────────────────────────────────────────────────────────

// Base "svizzera" (Schweizer Wanderwege): 4 km/h in piano, 400 m/h di
// dislivello in salita, 800 m/h in discesa, pause escluse. È la scala su
// cui si riscala il profilo Tobler (vedi js/eta.js).
export const BASE_SVIZZERA = { kmOrari: 4, salitaMOra: 400, discesaMOra: 800 };

// Passi personali selezionabili: metri di dislivello orari in salita.
// Il fattore di scala dell'intero itinerario è salitaMOra / passo.
export const PASSI = [
  { mOra: 300, etichetta: 'lento (300 m/h)' },
  { mOra: 400, etichetta: 'medio (400 m/h)' },
  { mOra: 500, etichetta: 'allenato (500 m/h)' },
  { mOra: 600, etichetta: 'veloce (600 m/h)' },
];

// Guardia sul fattore di riscalatura Tobler→svizzero: fuori da questo
// intervallo la traccia ha quote o distanze sospette (avviso, non scarto)
export const GUARDIA_K = [0.5, 2.5];

// Pause brevi spalmate (minuti per ora di marcia), default modificabile
export const PAUSA_MIN_ORA_DEFAULT = 10;

// Clamp della pendenza per segmento (dz/dx): oltre ±60% è quasi sempre
// rumore GPS o roccia attrezzata, dove Tobler non ha senso comunque
export const PENDENZA_MAX = 0.6;

// ── Campionamento e limiti ───────────────────────────────────────────────

// Punti meteo lungo la traccia: passo = clamp(totKm / 24, 1, 2) km
// → al massimo ~25 campioni = un solo blocco multi-località per modello
export const CAMPIONI_MAX = 25;
export const PASSO_CAMPIONE_KM = [1, 2]; // [min, max]

// Avviso se la quota della cella modello dista dalla quota sentiero più di
export const SOGLIA_DELTA_QUOTA_M = 300;

// Pioggia sotto la soglia di rilevazione dei pluviometri: azzerata in
// visualizzazione (drizzle bias dei modelli), dichiarato in legenda
export const SOGLIA_DRIZZLE_MM = 0.1;

// ── Modelli meteo ────────────────────────────────────────────────────────
// Domini (bounding box) e orizzonti dei modelli ad area limitata.
// I box di ch2 e icon_2i sono stimati: fuori dominio la risposta degrada
// (chiave assente / tutta null / nan) e la catena passa al successivo.

export const MODELLI = {
  icon_d2: {
    id: 'icon_d2',
    nome: 'ICON-D2 (DWD)',
    risoluzioneKm: 2.2,
    orizzonteOre: 48,
    box: { latMin: 43.18, latMax: 58.08, lonMin: -3.94, lonMax: 20.34 },
    quindiciMin: true, // unico con minutely_15 NATIVO
    pop: true,
  },
  meteoswiss_icon_ch2: {
    id: 'meteoswiss_icon_ch2',
    nome: 'ICON-CH2 (MeteoSwiss)',
    risoluzioneKm: 2.1,
    orizzonteOre: 120,
    box: { latMin: 43.1, latMax: 49.5, lonMin: 1.9, lonMax: 16.5 },
    quindiciMin: false,
    pop: true,
  },
  italia_meteo_arpae_icon_2i: {
    id: 'italia_meteo_arpae_icon_2i',
    nome: 'ICON-2I (ItaliaMeteo/ARPAE)',
    risoluzioneKm: 2.2,
    orizzonteOre: 72,
    box: { latMin: 33.7, latMax: 48.2, lonMin: 3, lonMax: 22 },
    quindiciMin: false,
    pop: false, // niente probabilità: serve il fallback ensemble
  },
  icon_eu: {
    id: 'icon_eu',
    nome: 'ICON-EU (DWD)',
    risoluzioneKm: 7,
    orizzonteOre: 120,
    box: { latMin: 29.5, latMax: 70.5, lonMin: -23.5, lonMax: 45 },
    quindiciMin: false,
    pop: true,
  },
  best_match: {
    id: 'best_match',
    nome: 'best match (globale)',
    risoluzioneKm: 11,
    orizzonteOre: 384,
    box: null, // mondo
    quindiciMin: false,
    pop: true,
  },
  // ── Modelli globali di confronto (solo fascia temperatura) ────────────
  // Mai primari: entrano solo nella catena `confronto` per la dispersione
  // multi-modello di temperatura e percepita.
  ecmwf_ifs025: {
    id: 'ecmwf_ifs025',
    nome: 'ECMWF IFS',
    risoluzioneKm: 25,
    orizzonteOre: 240,
    box: null, // mondo
    quindiciMin: false,
    pop: false,
  },
  gfs_seamless: {
    id: 'gfs_seamless',
    nome: 'GFS (NOAA)',
    risoluzioneKm: 13,
    orizzonteOre: 384,
    box: null, // mondo
    quindiciMin: false,
    pop: true,
  },
};

// Modelli della chiamata di confronto (una sola HTTP, campi suffissati)
export const MODELLI_CONFRONTO = ['ecmwf_ifs025', 'gfs_seamless'];

// Variabili orarie chieste al modello primario (nomi esatti Open-Meteo)
export const VARIABILI_PRIMARIO = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'shortwave_radiation',
  'cloud_cover',
  'weather_code',
  'freezing_level_height',
  'snowfall',
  'is_day',
  'uv_index',
  'cape',
];

// Variabili core del modello secondario (per la divergenza fra modelli)
export const VARIABILI_SECONDARIO = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'wind_speed_10m',
  'wind_gusts_10m',
];

// Variabili della chiamata ai modelli di confronto (fascia multi-modello)
export const VARIABILI_CONFRONTO = ['temperature_2m', 'apparent_temperature'];

// Dispersione min-max fra i modelli (°C) → accordo alto / medio / basso.
// Colora la forbice di temperatura e percepita nella tabella.
export const SOGLIE_DISPERSIONE_TEMP = { alta: 2, media: 4 };

// ── Soglie di rischio per canale (score 0-3) ─────────────────────────────
// Ogni canale produce uno score; la fusione (js/rischio.js) prende il
// massimo, con cap anti-falso-allarme sul livello 3.

export const SOGLIE_RISCHIO = {
  // Pioggia oraria (mm/h): percepibile / fastidiosa / pericolosa in quota
  pioggiaMm: [0.5, 2, 6],
  // Probabilità di precipitazione (%) perché la pioggia "conti" già a
  // quantità basse
  popAlta: 60,
  // Raffiche (km/h): fastidio / difficoltà su cresta / pericolo
  raffKmh: [40, 60, 80],
  // CAPE (J/kg): potenziale convettivo moderato / alto
  cape: [1000, 2500],
  // Codici WMO temporale (weather_code)
  codiciTemporale: [95, 96, 99],
  // Percepita fredda (°C): sotto queste soglie score 1 / 2 / 3
  freddoC: [3, -2, -8],
  // Percepita calda (°C): sopra queste soglie score 1 / 2 / 3
  caldoC: [28, 32, 36],
  // UV: alto / molto alto / estremo (scala OMS)
  uv: [6, 8, 11],
};

// ── Endpoint API ─────────────────────────────────────────────────────────

export const API = {
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  openMeteoEnsemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  openMeteoElevation: 'https://api.open-meteo.com/v1/elevation',
  komoot: 'https://www.komoot.com/api/v007',
  outdooractiveGpx: 'https://www.outdooractive.com/en/download.tour.gpx',
};

// Ensemble per la probabilità di precipitazione: primario e fallback
export const MODELLI_ENSEMBLE = ['icon_seamless', 'ecmwf_ifs025'];
