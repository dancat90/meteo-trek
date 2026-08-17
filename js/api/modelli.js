// ─────────────────────────────────────────────────────────────────────────
// Selezione del modello meteo per area geografica e orizzonte temporale.
// Logica pura, testabile in Node. Regole (vedi piano):
// - Appennino (Italia, latMax < 45): ICON-2I FORZATO — best_match lì
//   ricadrebbe su ICON-EU a 7 km.
// - Alpi: ICON-CH2 (2,1 km, 120 h), con ICON-D2 come secondario.
// - Estero: ICON-D2 se nel dominio, poi ICON-EU, poi best_match.
// - Ogni candidato con orizzonte insufficiente viene scartato con avviso.
// ─────────────────────────────────────────────────────────────────────────

import { MODELLI, MODELLI_CONFRONTO } from '../config.js';

// Bbox utente interamente dentro il box del modello (box null = mondo)
export function dentroBox(bbox, box) {
  if (!box) return true;
  return (
    bbox.latMin >= box.latMin &&
    bbox.latMax <= box.latMax &&
    bbox.lonMin >= box.lonMin &&
    bbox.lonMax <= box.lonMax
  );
}

// Riquadro "Italia" approssimato per la regola appenninica
const ITALIA = { latMin: 35, latMax: 47.5, lonMin: 6.5, lonMax: 19 };

// Modelli globali di confronto per la fascia di temperatura: sempre in
// dominio (box null), filtrati per orizzonte e per non-duplicazione col
// primario e col secondario.
export function modelliConfronto(primario, secondario, leadOreMax) {
  const esclusi = new Set([primario?.id, secondario?.id]);
  return MODELLI_CONFRONTO.map((id) => MODELLI[id]).filter(
    (m) => m && !esclusi.has(m.id) && m.orizzonteOre >= leadOreMax
  );
}

// bbox: { latMin, latMax, lonMin, lonMax } dei punti campionati
// leadOreMax: ore da adesso all'ultimo orario di passaggio previsto
// Restituisce { primario, secondario, confronto[], avvisi[] }
// (modelli di config.MODELLI)
export function scegliModelli(bbox, leadOreMax) {
  const avvisi = [];
  const inItalia = dentroBox(bbox, ITALIA);
  const alpino =
    bbox.latMin >= 44 && bbox.latMax >= 45 && bbox.lonMin >= 5 && bbox.lonMax <= 16;

  // Catena di candidati in ordine di preferenza per l'area
  let catena;
  if (inItalia && bbox.latMax < 45) {
    // Appennino e Alpi Marittime: ICON-2I forzato (2 km su tutta Italia)
    catena = [
      MODELLI.italia_meteo_arpae_icon_2i,
      MODELLI.icon_d2, // copre solo sopra lat 43,18
      MODELLI.icon_eu,
      MODELLI.best_match,
    ];
  } else if (alpino) {
    catena = [
      MODELLI.meteoswiss_icon_ch2,
      MODELLI.icon_d2,
      MODELLI.italia_meteo_arpae_icon_2i,
      MODELLI.icon_eu,
      MODELLI.best_match,
    ];
  } else {
    catena = [MODELLI.icon_d2, MODELLI.icon_eu, MODELLI.best_match];
  }

  // Filtra per dominio geografico
  let idonei = catena.filter((m) => dentroBox(bbox, m.box));
  if (!idonei.length) idonei = [MODELLI.best_match];

  // Filtra per orizzonte: chi non arriva all'ora della gita esce di scena
  const conOrizzonte = idonei.filter((m) => m.orizzonteOre >= leadOreMax);
  if (!conOrizzonte.length) {
    // Nemmeno best_match: gita oltre 16 giorni, ci pensa il clamp a monte
    avvisi.push('Gita oltre l’orizzonte di ogni modello: previsione impossibile');
    return { primario: null, secondario: null, confronto: [], avvisi };
  }
  if (conOrizzonte[0].id !== idonei[0].id) {
    avvisi.push(
      `Gita fra ${Math.ceil(leadOreMax / 24)} giorni: oltre l’orizzonte di ` +
        `${idonei[0].nome}, uso ${conOrizzonte[0].nome} (risoluzione ridotta)`
    );
  }

  const primario = conOrizzonte[0];
  // Il secondario serve alla divergenza fra modelli: il primo candidato
  // diverso dal primario che copre area e orizzonte
  const secondario =
    conOrizzonte.find((m) => m.id !== primario.id) || null;

  return {
    primario,
    secondario,
    confronto: modelliConfronto(primario, secondario, leadOreMax),
    avvisi,
  };
}

// Il dettaglio a 15 minuti è NATIVO solo da ICON-D2 nel suo dominio:
// va chiesto alla chiamata icon_d2 (primario o secondario che sia) e solo
// se la gita sta nel suo orizzonte di 48 ore.
export function quindiciMinDisponibile(bbox, leadOreMax) {
  return dentroBox(bbox, MODELLI.icon_d2.box) && leadOreMax <= MODELLI.icon_d2.orizzonteOre;
}

// Perché il 15 minuti non c'è: 'area' (fuori dominio ICON-D2) oppure
// 'orizzonte' (gita oltre le sue 48 ore). Null se invece è disponibile.
export function motivoNiente15Min(bbox, leadOreMax) {
  if (!dentroBox(bbox, MODELLI.icon_d2.box)) return 'area';
  if (leadOreMax > MODELLI.icon_d2.orizzonteOre) return 'orizzonte';
  return null;
}
