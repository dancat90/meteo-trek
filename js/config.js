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

// Base "svizzera" additiva (regola dei cartelli): 4 km/h in piano,
// 400 m/h in salita, 800 m/h in discesa, pause escluse. Dal 17/08/2026
// NON è più il metro dei tempi (vedi NOMOGRAMMA): resta come riferimento
// prudente per la guardia di sanità e per il confronto.
export const BASE_SVIZZERA = { kmOrari: 4, salitaMOra: 400, discesaMOra: 800 };

// Nomogramma ufficiale Schweizer Wanderwege 1996 (fornito dall'utente,
// stessa base della formula riservata usata da wandern.ch/SvizzeraMobile).
// Il polinomio ufficiale non è pubblico: qui una combinazione in norma-q
// dei tempi orizzontale e verticale, tarata sugli ancoraggi leggibili
// del diagramma e validata nei test:
//   piano 4,2 km/h · salita pura 400 m/h · discesa pura 800 m/h ·
//   5 km +300 m ≈ 80 min (regola additiva: 116) ·
//   5 km −300 m ≈ 62-65 min (più veloce del piano, come Tobler)
export const NOMOGRAMMA = {
  vPianoKmh: 4.2,
  salitaMOra: 400,
  discesaMOra: 800,
  q: 2.5, // esponente della combinazione: q→∞ = max, q=1 = additiva
  // Spinta di velocità nelle discese dolci (picco al 6-7% circa)
  discesaSpinta: 0.15,
  discesaPicco: 0.065,
  discesaLarghezza: 0.05,
};

// Passi personali selezionabili: metri di dislivello orari in salita.
// Il fattore di scala dell'intero itinerario è salitaMOra / passo.
export const PASSI = [
  { mOra: 300, etichetta: 'lento (300 m/h)' },
  { mOra: 400, etichetta: 'medio (400 m/h)' },
  { mOra: 500, etichetta: 'allenato (500 m/h)' },
  { mOra: 600, etichetta: 'veloce (600 m/h)' },
];

// Guardia sul rapporto nomogramma / regola additiva: sui percorsi sani
// sta fra ~0,55 (dolce) e ~1,0 (ripido). Fuori da questo intervallo la
// traccia ha quote o distanze sospette (avviso, non scarto)
export const GUARDIA_K = [0.45, 1.1];

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
  // Indici convettivi aggiuntivi (canale temporale potenziato).
  // lifted_index: null su TUTTI i primari regionali (arriva da GFS via
  // chiamata di confronto); lightning_potential (LPI): solo ICON-2I,
  // ICON-D2 e best_match; convective_inhibition: ovunque, ma MeteoSwiss
  // risponde con sentinella -1 quando non calcolabile
  'lifted_index',
  'convective_inhibition',
  'lightning_potential',
  // Ingressi radiativi per la MRT dell'UTCI (js/radiante.js)
  'direct_radiation',
  'direct_normal_irradiance',
  'terrestrial_radiation',
  // Base nuvolosa nativa (oggi la fornisce solo MeteoSwiss ICON-CH2:
  // gli altri modelli rispondono null e si passa alla stima LCL)
  'cloud_base',
  // Piani di nubi: distinguono il velo alto (innocuo per il cammino)
  // dalle nubi basse (possibile marcia in nube)
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
];

// Ingressi minimi dell'UTCI per modello (fascia della percepita)
const VARIABILI_UTCI = [
  'relative_humidity_2m',
  'cloud_cover',
  'shortwave_radiation',
  'direct_radiation',
  'direct_normal_irradiance',
  'terrestrial_radiation',
];

// Variabili core del modello secondario (per la divergenza fra modelli)
export const VARIABILI_SECONDARIO = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'wind_speed_10m',
  'wind_gusts_10m',
  ...VARIABILI_UTCI,
];

// Variabili della chiamata ai modelli di confronto (fascia multi-modello)
export const VARIABILI_CONFRONTO = [
  'temperature_2m',
  'apparent_temperature',
  'wind_speed_10m',
  // Visibilità prevista: la fornisce GFS (ECMWF risponde null, innocuo);
  // i modelli primari non ce l'hanno, quindi viaggia in questa chiamata
  'visibility',
  // Lifted index e UV: stessi ponti GFS della visibilità (i primari
  // regionali rispondono null su entrambi, verificato con sonda 08/2026)
  'lifted_index',
  'uv_index',
  ...VARIABILI_UTCI,
];

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
  // Lifted Index (adimensionale, negativo = instabile): letteratura NWS,
  // ≤ −2 instabilità moderata, ≤ −6 forte
  li: [-2, -6],
  // CIN (J/kg, magnitudine POSITIVA su Open-Meteo): ≥50 inibizione
  // significativa (solo nota testuale), ≥100 declassa di 1 lo score
  // indiretto ma MAI sotto 1 con CAPE sopra soglia (in montagna il
  // trigger orografico erode il CIN più che in pianura: prudenza)
  cin: [50, 100],
  // LPI (J/kg, Lynn & Yair 2010, solo ICON-2I/D2): >0,5 fulminazione
  // possibile, ≥2 segnale netto (soglie operative sperimentali)
  lpi: [0.5, 2],
  // Codici WMO temporale (weather_code)
  codiciTemporale: [95, 96, 99],
  // Percepita fredda (°C): sotto queste soglie score 1 / 2 / 3
  freddoC: [3, -2, -8],
  // Percepita calda (°C): sopra queste soglie score 1 / 2 / 3
  caldoC: [28, 32, 36],
  // UV: alto / molto alto / estremo (scala OMS)
  uv: [6, 8, 11],
};

// ── Esposizione orografica del vento ─────────────────────────────────────
// Sonde DEM a 8 direzioni × 3 raggi attorno a ogni campione → fattore
// moltiplicativo sul vento (riparo sottovento / cresta esposta), risolto
// sulla direzione oraria del vento. Range ASIMMETRICO e prudente:
// riduzione max −40% (sottostimare il vento è pericoloso: sottovento
// restano raffiche turbolente e rotori), amplificazione max +30% (su
// crinale le misure danno anche 1,5-2×, ma senza CFD si resta moderati).

export const ESPOSIZIONE = {
  // Raggi delle sonde (m): il DEM è a ~90 m, sotto ~250 m si ricade
  // nella stessa cella; 300/600/1200 coprono dosso, versante e dorsale
  raggiM: [300, 600, 1200],
  franchigiaM: 30, // sotto: rumore GLO-90, irrilevante per il vento a 10 m
  pendRiparo: 0.35, // pendenza della barriera sopravento per riduzione piena
  pendCresta: 0.25, // pendenza dei versanti per amplificazione piena
  fMin: 0.6,
  fMax: 1.3,
  ampCresta: 0.3,
  ampPendio: 0.15,
  sogliaMarcatore: 0.1, // |fattore−1| oltre cui la UI segnala la correzione
};

// Cache locale delle quote DEM (il terreno è statico): chiave lat,lon a
// 3 decimali (~111 m ≈ la cella GLO-90), eviction FIFO oltre il tetto
export const DEM_CACHE = { decimali: 3, maxVoci: 5000 };

// ── Endpoint API ─────────────────────────────────────────────────────────

export const API = {
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  openMeteoEnsemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  openMeteoElevation: 'https://api.open-meteo.com/v1/elevation',
  komoot: 'https://www.komoot.com/api/v007',
  outdooractiveGpx: 'https://www.outdooractive.com/en/download.tour.gpx',
  openCelliD: 'https://opencellid.org/cell/getInArea',
  // Overpass: principale + mirror di riserva (provati in ordine)
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],
};

// Stima copertura mobile: distanza (km) dalla cella Vodafone più vicina
export const SOGLIE_COPERTURA = { probabileKm: 2, incertaKm: 6 };

// Intensità solare qualitativa dalla radiazione globale al suolo (W/m²,
// già filtrata dalle nubi previste dal modello). Riferimenti: mezzogiorno
// estivo sereno ~850-1000, invernale sereno ~400-500, coperto ~50-150.
export const SOGLIE_SOLE = [10, 150, 400, 700];
export const ETICHETTE_SOLE = ['nulla', 'scarsa', 'media', 'forte', 'molto forte'];

// Visibilità prevista (km): soglie di classe (scala aeronautica ridotta)
export const SOGLIE_VISIBILITA_KM = [1, 4, 10, 20];
export const ETICHETTE_VISIBILITA = ['scarsa', 'ridotta', 'discreta', 'buona', 'ottima'];

// Ensemble per la probabilità di precipitazione: primario e fallback
export const MODELLI_ENSEMBLE = ['icon_seamless', 'ecmwf_ifs025'];

// Avviso aggregato temporali: fascia oraria locale critica e score minimo
// del canale temporale perché un tratto conti nel contatore
export const AVVISO_TEMPORALE = { oreLocali: [12, 18], scoreMin: 2 };

// ── Scala UV OMS ─────────────────────────────────────────────────────────
// 5 fasce: coerente con la palette rischio (stessa famiglia cromatica su
// fondo scuro) ma distinta — la 5ª fascia viola esiste SOLO per l'UV e
// viene resa come badge-pillola con etichetta, mai come chip del rischio
export const UV_SCALA = {
  soglie: [3, 6, 8, 11],
  etichette: ['basso', 'moderato', 'alto', 'molto alto', 'estremo'],
  colori: ['#2ea043', '#f2cc60', '#f0883e', '#da3633', '#a371f7'],
};

// ── Pianificatore finestre di partenza (24-72 h) ─────────────────────────

export const PIANIFICATORE = {
  orizzonteOre: 72, // ore da adesso coperte dalla griglia dei candidati
  passoOre: 1, // i modelli sono orari: passi più fini duplicano le celle
  fasciaOreLocali: [4, 14], // partenze plausibili, ora locale del percorso
  margineFuturoMin: 30, // primo candidato: almeno fra 30 minuti
  margineTramontoMin: 60, // sotto questo margine l'arrivo è «stretto»
};

// Variabili della chiamata dedicata del pianificatore: solo quelle che
// alimentano rischio e percepita. lifted_index e uv_index NON viaggiano
// qui (null sui primari regionali, e il pianificatore non fa la chiamata
// di confronto): semplificazione dichiarata nella legenda del pannello.
export const VARIABILI_PIANIFICATORE = [
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
  'cape',
  'convective_inhibition',
  'lightning_potential',
  // Ingressi radiativi per la MRT dell'UTCI
  'direct_radiation',
  'direct_normal_irradiance',
  'terrestrial_radiation',
];

// Correzione UV: +10%/1000 m (OMS/WMO) sul DELTA quota sentiero−cella
// modello (assunzione dichiarata: l'UV Open-Meteo è alla quota della
// cella). Neve: l'albedo può aggiungere fino a +80% (OMS), ma "neve al
// suolo" non è ricavabile dai dati → +25% prudente, applicato SOLO con
// nevicata prevista al passaggio; i nevai preesistenti non sono rilevati
export const UV_CORREZIONE = { pctPer1000m: 10, fattoreNeve: 1.25, clampFattore: [0.7, 1.6] };
