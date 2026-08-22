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

// ── Stato del fondo del sentiero (fango, neve, ghiaccio) ─────────────────
// Avviso retrospettivo: che cosa è successo al TERRENO nei giorni PRIMA
// del passaggio. Tre fenomeni con tempi di persistenza diversi, quindi tre
// finestre diverse: la pioggia asciuga in 2-3 giorni, la neve resta al
// suolo per settimane, il ghiaccio nasce in una notte sola.
// Tutte le temperature arrivano già alla quota del sentiero (parametro
// elevation della chiamata): nessuna correzione di gradiente qui.

export const FONDO = {
  // Finestre retrospettive, in ore prima dell'istante di passaggio
  orePioggia: 72,
  oreNeve: 120,
  oreAcqua: 48, // acqua disponibile sul terreno per il ghiaccio
  oreGelo: 18, // la notte prima del passaggio
  oreCicli: 48, // finestra dei cicli gelo-disgelo (crosta dura)
  oreValanga: 72, // neve fresca rilevante per il rimando al bollettino

  // Pesi di recency della pioggia: [0-24 h, 24-48 h, 48-72 h] prima del
  // passaggio. Lo stesso peso si applica all'evapotraspirazione, così il
  // rapporto acqua caduta / acqua evaporata resta corretto in ogni fascia.
  pesiPioggia: [1, 0.6, 0.3],

  // Bilancio idrico netto pesato (mm): umido / fangoso / saturo
  sogliePioggiaMm: [5, 15, 40],
  // Rovescio violento nelle ultime 24 h (mm in una sola ora): incide il
  // sentiero anche con totale basso
  rovescioMmOra: 20,

  // Neve residua stimata (cm): sparsa / continua / alta
  soglieNeveCm: [2, 10, 30],
  // Fusione a gradi-giorno (metodo classico dell'idrologia nivale):
  // centimetri di manto fusi per grado sopra zero per giorno. Il valore
  // tiene conto di una densità media del manto (~150 kg/m³): 4 mm di
  // acqua equivalente per °C/giorno ≈ 2,7 cm di neve.
  fusioneCmGradoGiorno: 2.7,

  // Ghiaccio: serve acqua sul terreno E gelo. Un sentiero asciutto a
  // −5 °C non ha ghiaccio.
  acquaMinimaMm: 1,
  // Soglie sul suolo (°C): attenzione a +1, certezza a 0. Il margine di
  // 1 grado copre l'errore tipico del modello.
  sogliaGeloC: 1,
  sogliaGeloCertoC: 0,
  // Neve minima perché il ciclo gelo-disgelo produca crosta dura (cm)
  neveCrostaCm: 2,

  // Rimando al bollettino valanghe: neve fresca in 72 h su pendii ripidi
  valangaNeveCm: 30,
  valangaPendenzaPct: 58, // ≈ 30 gradi

  // Versante: moltiplicatore della fusione per esposizione solare.
  // Il nord riceve meno sole, la neve dura molto di più a parità di quota.
  ampiezzaVersante: 0.4, // nord ×0,6 · sud ×1,4 · est-ovest ×1
  // Sotto questa pendenza il terreno è pianeggiante: nessuna correzione
  pendenzaMinVersantePct: 10,

  // Sopra questa quota, in inverno, la neve non è un evento recente ma lo
  // stato normale della montagna: la stima residua perde significato
  quotaNeveStabileM: 2500,

  // Copertura minima della finestra retrospettiva perché lo stato valga:
  // sotto, l'avviso dichiara «dati insufficienti» e NON dice «asciutto»
  coperturaMinima: 0.6,
};

// Variabili della chiamata retrospettiva dedicata. Sonda live 08/2026:
// tutte non-null su ICON-2I, ICON-CH2, ICON-EU e best_match, anche sui
// giorni passati (start_hour all'indietro accettato da tutti).
export const VARIABILI_FONDO = [
  'rain', // pioggia separata dalla neve, già discriminata alla quota
  'snowfall', // nevicata in cm
  'snow_depth', // manto al suolo previsto dal modello, in METRI
  'temperature_2m',
  'soil_temperature_0cm', // gelo del fondo: il suolo ha inerzia termica
  'et0_fao_evapotranspiration', // asciugatura del terreno
];

// Classi dello stato del fondo. Colori fuori dalla scala del rischio
// meteo (marrone per il fango, azzurro per neve e ghiaccio): il fondo è
// una condizione del TERRENO, non del cielo, e non deve confondersi coi
// chip delle 4 classi di rischio.
export const FONDO_CLASSI = {
  asciutto: { etichetta: 'asciutto', icona: '', colore: '#2ea043' },
  umido: { etichetta: 'umido', icona: '💧', colore: '#a3785a' },
  fangoso: { etichetta: 'fangoso', icona: '💧', colore: '#8b5a2b' },
  saturo: { etichetta: 'saturo', icona: '💧', colore: '#6b3f1d' },
  neve: { etichetta: 'neve al suolo', icona: '❄', colore: '#79c0ff' },
  ghiaccio: { etichetta: 'ghiaccio', icona: '🧊', colore: '#58a6ff' },
  crosta: { etichetta: 'crosta dura', icona: '🧊', colore: '#1f6feb' },
  ignoto: { etichetta: 'dati insufficienti', icona: '?', colore: '#8b949e' },
};

// Correzione UV: +10%/1000 m (OMS/WMO) sul DELTA quota sentiero−cella
// modello (assunzione dichiarata: l'UV Open-Meteo è alla quota della
// cella). Neve: l'albedo può aggiungere fino a +80% (OMS), ma "neve al
// suolo" non è ricavabile dai dati → +25% prudente, applicato SOLO con
// nevicata prevista al passaggio; i nevai preesistenti non sono rilevati
export const UV_CORREZIONE = { pctPer1000m: 10, fattoreNeve: 1.25, clampFattore: [0.7, 1.6] };

// ── Taratura dell'altimetro barometrico al parcheggio ────────────────────
// L'escursionista tara l'orologio al parcheggio: quota dal DEM (la quota
// GPS del browser è ellissoidica WGS84, in Italia ~45-50 m sopra il
// livello del mare: inutilizzabile), pressione prevista alla partenza al
// livello del mare (QNH) e alla quota del parcheggio (QFE), deriva attesa
// della lettura fra partenza e arrivo. Le costanti fisiche (g, R, M)
// stanno in js/parcheggio.js come SIGMA in radiante.js. Unità per
// l'utente: millibar (1 hPa = 1 mbar, nessuna conversione).

export const ALTIMETRO = {
  // Oltre questa distanza fra parcheggio e primo punto del percorso le
  // coordinate sono sospette (lat/lon invertite, decimale sbagliato): un
  // parcheggio legittimo «a valle» di rado supera i 2 km dall'attacco
  distanzaAttaccoAvvisoM: 2000,
  // Classi della deriva (m, valore assoluto). 15 m ≈ 1,5 mbar è
  // l'accuratezza tipica di un altimetro da polso appena tarato: sotto,
  // la deriva si confonde col rumore dello strumento. 30 m supera
  // l'equidistanza delle carte escursionistiche 1:25.000 (25 m): una
  // curva di livello intera, l'errore con cui si sbaglia bivio quotato
  derivaModerataM: 15,
  derivaForteM: 30,
  // Gradiente termico verticale standard (K/m): temperatura media dello
  // strato mare→parcheggio nella formula ipsometrica
  gradienteTermicoKPerM: 0.0065,
  // Sotto questa variazione di QNH (mbar) fra partenza e arrivo la
  // tendenza si dichiara «stazionaria»
  qnhStazionariaHpa: 0.05,
  // Scarto (mbar) fra la QNH reale e quella che l'orologio ricostruisce
  // con l'atmosfera standard oltre il quale la riga lo spiega: a 2000 m in
  // estate arriva a 8-10 mbar, e l'utente non deve «correggere» la quota
  scartoQnhStandardHpa: 3,
  // Precisione GPS (m) oltre la quale la posizione del telefono va
  // ricontrollata prima di usarla come parcheggio
  precisioneGpsAvvisoM: 100,
};

// Variabili della chiamata dedicata al parcheggio (un solo punto, con
// `elevation` = quota DEM del parcheggio). Sonda live 22/08/2026: tutte
// non-null (48/48) su ICON-2I, ICON-CH2, ICON-D2 e best_match.
export const VARIABILI_PARCHEGGIO = [
  'pressure_msl', // QNH: NON dipende dalla quota inviata
  'surface_pressure', // QFE: SEGUE il parametro elevation (2133 m → 793,4; cella 1934 m → 812,4)
  'temperature_2m', // alla quota inviata: temperatura dello strato per ipsometrica e deriva
];
