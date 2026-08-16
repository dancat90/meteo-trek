// ─────────────────────────────────────────────────────────────────────────
// Mappa Leaflet: traccia come polyline a segmenti colorati per rischio,
// marker sui campioni meteo con popup, legenda (colore MAI da solo).
// Tile OpenTopoMap (curve di livello e sentieri) con fallback carto dark
// al primo errore di tile. Richiede il globale L caricato da CDN.
// ─────────────────────────────────────────────────────────────────────────

import { COLORI_SEVERITA, ETICHETTE_RISCHIO } from '../config.js';

let mappa = null;
let layerTraccia = null;
let markerCampioni = [];
let fallbackFatto = false;

// Escape HTML per dati remoti interpolati nei popup (anti-XSS)
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initMappa(idElemento) {
  mappa = L.map(idElemento);
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  }).addTo(mappa);
  // OpenTopoMap a volte non risponde: al primo errore si ripiega sul
  // layer carto dark già collaudato in meteo-rotta (una volta sola)
  topo.on('tileerror', () => {
    if (fallbackFatto) return;
    fallbackFatto = true;
    mappa.removeLayer(topo);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 15,
    }).addTo(mappa);
  });
  mappa.setView([44, 11], 6);
  layerTraccia = L.layerGroup().addTo(mappa);
  aggiungiLegenda();
  return mappa;
}

function aggiungiLegenda() {
  const controllo = L.control({ position: 'bottomleft' });
  controllo.onAdd = () => {
    const div = L.DomUtil.create('div', 'legenda-mappa');
    div.innerHTML =
      '<strong>Rischio meteo</strong>' +
      ETICHETTE_RISCHIO.map(
        (etichetta, i) =>
          `<span class="voce-legenda"><span class="chip" style="background:${COLORI_SEVERITA[i]}"></span>${etichetta}</span>`
      ).join('');
    return div;
  };
  controllo.addTo(mappa);
}

// Svuota la traccia disegnata (cambio percorso: mai la traccia vecchia
// sotto un percorso nuovo)
export function pulisciTraccia() {
  layerTraccia?.clearLayers();
  markerCampioni = [];
}

// Disegna la traccia colorata e i marker dei campioni.
// traccia: [{lat, lon, d}] (decimata); campioni: voci arricchite con
// { lat, lon, dCumKm, score, popupHtml }. onSelezione(i) al click.
export function disegnaTraccia({ traccia, campioni }, onSelezione = null) {
  layerTraccia.clearLayers();
  markerCampioni = [];
  if (!traccia?.length) return;

  // Un segmento colorato per ogni coppia di campioni consecutivi: colore
  // prudente = rischio più alto dei due estremi
  for (let i = 0; i < campioni.length - 1; i++) {
    const da = campioni[i].dCumKm;
    const a = campioni[i + 1].dCumKm;
    const punti = traccia.filter((p) => p.d >= da - 1e-6 && p.d <= a + 1e-6);
    if (punti.length < 2) continue;
    const score = Math.max(campioni[i].score ?? 0, campioni[i + 1].score ?? 0);
    L.polyline(punti.map((p) => [p.lat, p.lon]), {
      color: COLORI_SEVERITA[score],
      weight: 5,
      opacity: 0.9,
    }).addTo(layerTraccia);
  }

  // Marker inizio e fine
  const primo = traccia[0];
  const ultimo = traccia[traccia.length - 1];
  for (const [p, titolo] of [[primo, 'Partenza'], [ultimo, 'Arrivo']]) {
    L.circleMarker([p.lat, p.lon], {
      radius: 7,
      color: '#c9d1d9',
      fillColor: '#0d1117',
      fillOpacity: 1,
      weight: 2,
    })
      .bindTooltip(titolo)
      .addTo(layerTraccia);
  }

  // Marker dei campioni con popup e selezione sincronizzata
  campioni.forEach((c, i) => {
    const m = L.circleMarker([c.lat, c.lon], {
      radius: 5,
      color: '#ffffff',
      weight: 1.5,
      // Campione senza dati: grigio neutro, mai il verde "buono"
      fillColor: c.senzaDati ? '#8b949e' : COLORI_SEVERITA[c.score ?? 0],
      fillOpacity: 0.95,
    }).addTo(layerTraccia);
    if (c.popupHtml) m.bindPopup(`<div class="popup-punto">${c.popupHtml}</div>`);
    if (onSelezione) m.on('click', () => onSelezione(i));
    markerCampioni.push(m);
  });

  // Il container può essere appena uscito da [hidden]: senza
  // invalidateSize Leaflet userebbe la size (0,0) cacheata all'init
  mappa.invalidateSize();
  mappa.fitBounds(
    L.latLngBounds(traccia.map((p) => [p.lat, p.lon])),
    { padding: [28, 28] }
  );
}

// Apre il popup del campione i (selezione arrivata da tabella o profilo)
export function evidenziaCampione(i) {
  markerCampioni[i]?.openPopup();
}
