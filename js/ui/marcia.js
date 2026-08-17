// ─────────────────────────────────────────────────────────────────────────
// Tabella di marcia: punti di controllo ogni 15 minuti di tabella, con
// meteo, quota, pendenza media del tratto, parziali di distanza e tempo,
// stima rete, e MAPPA con i punti numerati:
// - a schermo: seconda mappa Leaflet (stessi tile e stessa traccia
//   colorata per rischio della principale), selezione sincronizzata
//   tabella ↔ mappa nei due sensi;
// - nel PDF: immagine composta su canvas dai tile OpenTopoMap (CORS *
//   verificato, crossOrigin=anonymous) con traccia e numeri; se i tile
//   non arrivano, ripiego dichiarato sulla sola traccia su fondo bianco.
// Esportazione PDF senza librerie: finestra di stampa con documento
// autonomo, il "Salva come PDF" del browser fa il resto.
// ─────────────────────────────────────────────────────────────────────────

import { escapeHtml } from './mappa.js';
import { formattaOra } from '../tempo.js';
import { COLORI_SEVERITA } from '../config.js';

const TILE_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const ATTRIBUZIONE =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)';

let mappaMarcia = null;
let markerControlli = [];
let righeMarcia = [];

const hmm = (min) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const num = (v, dec = 0, unita = '') =>
  Number.isFinite(v) ? `${v.toFixed(dec)}${unita}` : '–';

// ── Geometria pura (esportata anche per i test) ─────────────────────────

// Punto {lat, lon} alla progressiva dKm, interpolato sulla traccia
// decimata (la stessa polyline disegnata: i marker cadono sulla linea)
export function puntoDaTraccia(traccia, dKm) {
  if (!traccia?.length) return null;
  if (dKm <= traccia[0].d) return { lat: traccia[0].lat, lon: traccia[0].lon };
  for (let i = 1; i < traccia.length; i++) {
    if (traccia[i].d >= dKm) {
      const a = traccia[i - 1];
      const b = traccia[i];
      const l = b.d - a.d;
      const f = l > 0 ? (dKm - a.d) / l : 0;
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  const u = traccia[traccia.length - 1];
  return { lat: u.lat, lon: u.lon };
}

// Web Mercator: coordinate in pixel "mondo" allo zoom z (tile da 256)
export function mercatorPx(lat, lon, z) {
  const scala = 256 * Math.pow(2, z);
  const x = ((lon + 180) / 360) * scala;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scala;
  return { x, y };
}

// Zoom più alto in cui il riquadro sta dentro latoMaxPx
export function scegliZoom(bounds, latoMaxPx = 1100) {
  for (let z = 15; z >= 6; z--) {
    const a = mercatorPx(bounds.latMax, bounds.lonMin, z);
    const b = mercatorPx(bounds.latMin, bounds.lonMax, z);
    if (b.x - a.x <= latoMaxPx && b.y - a.y <= latoMaxPx) return z;
  }
  return 6;
}

// Raggruppa i punti di controllo che cadrebbero sovrapposti: due punti
// finiscono nello stesso pallino se distano meno di sogliaPx nella
// proiezione corrente (es. andata e ritorno sullo stesso sentiero).
// proietta(punto) → {x, y} in pixel. Restituisce
// [{ punto, indici: [i, ...] }] con gli indici in ordine crescente.
export function raggruppaPunti(punti, sogliaPx, proietta) {
  const gruppi = [];
  punti.forEach((p, i) => {
    if (!p) return;
    const q = proietta(p);
    const vicino = gruppi.find((g) => {
      const gq = proietta(g.punto);
      return Math.hypot(gq.x - q.x, gq.y - q.y) < sogliaPx;
    });
    if (vicino) vicino.indici.push(i);
    else gruppi.push({ punto: p, indici: [i] });
  });
  return gruppi;
}

// ── Dati di riga ────────────────────────────────────────────────────────

function righeDati(r) {
  return r.marcia.map((p, i) => {
    const c = r.campioni[p.idxCampione] || {};
    const v = c.valori || {};
    return {
      n: i + 1,
      ora: p.oraLocale,
      tempo: `${hmm(p.tMin)} / ${hmm(r.durataTotaleMin)}`,
      km: `${p.dKm.toFixed(1)} / ${r.totKm.toFixed(1)}`,
      quota: num(p.quotaM, 0, ' m'),
      pend: Number.isFinite(p.pendenzaPct)
        ? `${p.pendenzaPct > 0 ? '+' : ''}${p.pendenzaPct.toFixed(0)}%`
        : '–',
      t: num(v.temperature_2m, 0, '°'),
      perc: num(c.percepitaC, 0, '°'),
      raff: num(v.wind_gusts_10m, 0),
      prob: num(v.precipitation_probability ?? c.ens?.popKN, 0, '%'),
      mm: num(v.precipitation, 1),
      rete: c.rete?.classe || null,
    };
  });
}

// Stima copertura Vodafone: pallino a schermo, testo secco in PDF
const COLORE_RETE = { probabile: '#2ea043', incerta: '#f2cc60', assente: '#da3633' };
const TESTO_RETE = { probabile: 'sì', incerta: '?', assente: 'no' };
const reteDot = (classe) =>
  classe
    ? `<span class="chip" style="background:${COLORE_RETE[classe]}" title="Vodafone ${classe}"></span>`
    : '–';
const reteTesto = (classe) => (classe ? TESTO_RETE[classe] : '–');

function testataTramonto(r) {
  if (!r.tramontoIso) return 'tramonto non calcolabile a questa latitudine';
  const t = formattaOra(new Date(r.tramontoIso), r.tz);
  const m = r.margineTramontoMin;
  const margine =
    m == null ? '' : m < 0 ? ` — arrivo ${-m} min DOPO il tramonto` : ` — margine ${hmm(m)} h`;
  return `tramonto ${t}${margine}`;
}

// ── Render a schermo ────────────────────────────────────────────────────

export function renderMarcia(el, r) {
  if (!r.marcia?.length) {
    el.hidden = true;
    return;
  }
  const righe = righeDati(r);
  const puntiMappa = r.marcia.map((p) => puntoDaTraccia(r.traccia, p.dKm));
  const allarme =
    r.margineTramontoMin != null && r.margineTramontoMin < 60
      ? `<div class="avvisi"><div>⚠ Il trek deve finire entro un'ora dal tramonto: ${
          r.margineTramontoMin < 0
            ? `qui finisce ${-r.margineTramontoMin} min dopo (frontale obbligatoria)`
            : `qui il margine è di soli ${r.margineTramontoMin} min`
        }. Anticipa la partenza o accorcia il giro.</div></div>`
      : '';

  el.innerHTML = `
    <div class="pannello marcia">
      <div class="marcia-testata">
        <strong>Tabella di marcia</strong> — controllo ogni 15 min ·
        partenza ${escapeHtml(formattaOra(new Date(r.partenzaIso), r.tz))} ·
        arrivo ${escapeHtml(formattaOra(new Date(r.arrivoIso), r.tz))} ·
        ${escapeHtml(testataTramonto(r))}
        <button id="bottone-pdf-marcia" type="button">Esporta PDF</button>
      </div>
      ${allarme}
      <div class="mappa-marcia" aria-label="Mappa dei punti di controllo numerati"></div>
      <div class="contenitore-tabella"><table class="tratti">
        <thead><tr>
          <th>#</th><th>ora</th><th>tempo<br>parz/tot</th><th>km<br>parz/tot</th>
          <th>quota</th><th>pend.</th><th>T</th><th>perc.</th>
          <th>raffiche<br>km/h</th><th>prob.</th><th>mm</th><th>rete</th>
        </tr></thead>
        <tbody>${righe
          .map(
            (x, i) => `<tr class="riga-marcia" data-idx="${i}">
          <td>${x.n}</td><td>${escapeHtml(x.ora)}</td><td>${x.tempo}</td><td>${x.km}</td>
          <td>${x.quota}</td><td>${x.pend}</td><td>${x.t}</td><td>${x.perc}</td>
          <td>${x.raff}</td><td>${x.prob}</td><td>${x.mm}</td><td>${reteDot(x.rete)}</td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </div>`;
  el.hidden = false;

  righeMarcia = [...el.querySelectorAll('tr.riga-marcia')];
  righeMarcia.forEach((tr) => {
    tr.addEventListener('click', () => selezionaControllo(Number(tr.dataset.idx), false));
  });
  el.querySelector('#bottone-pdf-marcia')?.addEventListener('click', () =>
    esportaPdf(r, righe, puntiMappa)
  );
  disegnaMappaMarcia(el, r, puntiMappa);
}

// Seconda mappa: stessi tile e stessa traccia colorata della principale,
// più i punti di controllo numerati
function disegnaMappaMarcia(el, r, punti) {
  if (typeof L === 'undefined') return; // ambiente senza Leaflet
  if (mappaMarcia) {
    mappaMarcia.remove();
    mappaMarcia = null;
  }
  const cont = el.querySelector('.mappa-marcia');
  if (!cont || !r.traccia?.length) return;

  mappaMarcia = L.map(cont, { scrollWheelZoom: false });
  L.tileLayer(TILE_URL, { attribution: ATTRIBUZIONE, maxZoom: 17 }).addTo(mappaMarcia);

  // Traccia a segmenti colorati per rischio (stessa regola della mappa
  // principale: colore prudente = massimo dei due campioni estremi)
  for (let i = 0; i < r.campioni.length - 1; i++) {
    const da = r.campioni[i].dCumKm;
    const a = r.campioni[i + 1].dCumKm;
    const seg = r.traccia.filter((p) => p.d >= da - 1e-6 && p.d <= a + 1e-6);
    if (seg.length < 2) continue;
    const score = Math.max(r.campioni[i].score ?? 0, r.campioni[i + 1].score ?? 0);
    L.polyline(seg.map((p) => [p.lat, p.lon]), {
      color: COLORI_SEVERITA[score],
      weight: 4,
      opacity: 0.9,
    }).addTo(mappaMarcia);
  }

  // Partenza
  const p0 = r.traccia[0];
  L.circleMarker([p0.lat, p0.lon], {
    radius: 7,
    color: '#c9d1d9',
    fillColor: '#0d1117',
    fillOpacity: 1,
    weight: 2,
  })
    .bindTooltip('Partenza')
    .addTo(mappaMarcia);

  // Punti di controllo numerati, raggruppati quando si sovrappongono e
  // ricalcolati a ogni cambio di zoom (a zoom alto si separano di nuovo)
  const ridisegnaPin = () => disegnaPin(punti);
  mappaMarcia.on('zoomend', ridisegnaPin);

  mappaMarcia.fitBounds(
    L.latLngBounds(r.traccia.map((p) => [p.lat, p.lon])),
    { padding: [24, 24] }
  );
  ridisegnaPin();
  // Il container esce ora da [hidden]: senza invalidateSize la mappa
  // resterebbe alla size (0,0) cacheata
  setTimeout(() => {
    mappaMarcia?.invalidateSize();
    ridisegnaPin();
  }, 0);
}

// (Ri)disegna i pallini numerati raggruppando i sovrapposti alla scala
// di zoom corrente
function disegnaPin(punti) {
  if (!mappaMarcia) return;
  for (const v of markerControlli) v?.marker?.remove();
  const gruppi = raggruppaPunti(punti, 30, (p) => {
    const q = mappaMarcia.latLngToLayerPoint([p.lat, p.lon]);
    return { x: q.x, y: q.y };
  });
  markerControlli = gruppi.map((g) => {
    const etichetta = g.indici.map((i) => i + 1).join('·');
    const m = L.marker([g.punto.lat, g.punto.lon], {
      icon: L.divIcon({
        className: 'pin-wrap',
        html: `<div class="pin-controllo" data-indici="${g.indici.join(',')}">${etichetta}</div>`,
        // Il centraggio sul punto lo fa il CSS (translate -50%/-50%)
        iconSize: null,
        iconAnchor: [0, 0],
      }),
    }).addTo(mappaMarcia);
    m.on('click', () => selezionaControllo(g.indici[0], true));
    return { marker: m, indici: g.indici };
  });
}

// Selezione sincronizzata tabella ↔ mappa (nei due sensi). Un pallino
// raggruppato evidenzia TUTTE le sue righe (es. «3·11» → righe 3 e 11).
function selezionaControllo(i, daMappa) {
  const gruppo = markerControlli.find((g) => g?.indici?.includes(i));
  const daEvidenziare = daMappa && gruppo ? gruppo.indici : [i];
  righeMarcia.forEach((tr) =>
    tr.classList.toggle('selezionata', daEvidenziare.includes(Number(tr.dataset.idx)))
  );
  document.querySelectorAll('.pin-controllo').forEach((p) => {
    const indici = (p.dataset.indici || '').split(',').map(Number);
    p.classList.toggle('selezionato', indici.includes(i));
  });
  if (daMappa) {
    righeMarcia[daEvidenziare[0]]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (gruppo && mappaMarcia) {
    mappaMarcia.panTo(gruppo.marker.getLatLng());
  }
}

// ── Immagine della mappa per il PDF ─────────────────────────────────────

// Composizione su canvas: tile OpenTopoMap (CORS aperto) + traccia
// colorata + numeri. conTile=false: solo traccia su bianco (ripiego).
async function componiCanvas(r, punti, conTile) {
  const lats = r.traccia.map((p) => p.lat);
  const lons = r.traccia.map((p) => p.lon);
  const mLat = (Math.max(...lats) - Math.min(...lats)) * 0.12 + 0.004;
  const mLon = (Math.max(...lons) - Math.min(...lons)) * 0.12 + 0.004;
  const bounds = {
    latMin: Math.min(...lats) - mLat,
    latMax: Math.max(...lats) + mLat,
    lonMin: Math.min(...lons) - mLon,
    lonMax: Math.max(...lons) + mLon,
  };
  const z = scegliZoom(bounds, 1100);
  const o = mercatorPx(bounds.latMax, bounds.lonMin, z); // angolo alto-sx
  const f = mercatorPx(bounds.latMin, bounds.lonMax, z);
  const W = Math.max(320, Math.ceil(f.x - o.x));
  const H = Math.max(240, Math.ceil(f.y - o.y));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  if (conTile) {
    const t0x = Math.floor(o.x / 256);
    const t1x = Math.floor(f.x / 256);
    const t0y = Math.floor(o.y / 256);
    const t1y = Math.floor(f.y / 256);
    const caricamenti = [];
    for (let tx = t0x; tx <= t1x; tx++) {
      for (let ty = t0y; ty <= t1y; ty++) {
        caricamenti.push(
          new Promise((fine) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const timer = setTimeout(() => fine(false), 9000);
            img.onload = () => {
              clearTimeout(timer);
              ctx.drawImage(img, tx * 256 - o.x, ty * 256 - o.y);
              fine(true);
            };
            img.onerror = () => {
              clearTimeout(timer);
              fine(false);
            };
            img.src = `https://a.tile.opentopomap.org/${z}/${tx}/${ty}.png`;
          })
        );
      }
    }
    const esiti = await Promise.all(caricamenti);
    if (!esiti.some(Boolean)) throw new Error('nessun tile caricato');
  }

  const aPx = (p) => {
    const m = mercatorPx(p.lat, p.lon, z);
    return [m.x - o.x, m.y - o.y];
  };

  // Traccia a segmenti colorati per rischio, con alone bianco leggibile
  for (let i = 0; i < r.campioni.length - 1; i++) {
    const da = r.campioni[i].dCumKm;
    const a = r.campioni[i + 1].dCumKm;
    const seg = r.traccia.filter((p) => p.d >= da - 1e-6 && p.d <= a + 1e-6);
    if (seg.length < 2) continue;
    const score = Math.max(r.campioni[i].score ?? 0, r.campioni[i + 1].score ?? 0);
    for (const [larghezza, colore] of [
      [7, 'rgba(255,255,255,0.85)'],
      [4, COLORI_SEVERITA[score]],
    ]) {
      ctx.beginPath();
      seg.forEach((p, k) => {
        const [x, y] = aPx(p);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineWidth = larghezza;
      ctx.strokeStyle = colore;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // Partenza
  const [xs, ys] = aPx(r.traccia[0]);
  ctx.beginPath();
  ctx.arc(xs, ys, 6, 0, 2 * Math.PI);
  ctx.fillStyle = '#0d1117';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Punti di controllo numerati, raggruppati quando si sovrappongono
  // (stessa regola della mappa a schermo: «3·11» in una sola pillola)
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const gruppi = raggruppaPunti(punti, 26, (p) => {
    const [x, y] = aPx(p);
    return { x, y };
  });
  for (const g of gruppi) {
    const [x, y] = aPx(g.punto);
    const testo = g.indici.map((i) => i + 1).join('·');
    const mezzaL = Math.max(11, ctx.measureText(testo).width / 2 + 7);
    ctx.beginPath();
    // Pillola: due semicerchi + lati (roundRect a mano, compatibile ovunque)
    ctx.arc(x - mezzaL + 11, y, 11, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.lineTo(x + mezzaL - 11, y - 11);
    ctx.arc(x + mezzaL - 11, y, 11, (3 * Math.PI) / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0d1117';
    ctx.stroke();
    ctx.fillStyle = '#0d1117';
    ctx.fillText(testo, x, y + 0.5);
  }

  return canvas.toDataURL('image/png');
}

async function immagineMappaPdf(r, punti) {
  try {
    return { dataUrl: await componiCanvas(r, punti, true), sfondo: true };
  } catch {
    try {
      return { dataUrl: await componiCanvas(r, punti, false), sfondo: false };
    } catch {
      return { dataUrl: null, sfondo: false };
    }
  }
}

// ── Esportazione PDF ────────────────────────────────────────────────────

// La finestra va aperta SUBITO nel gesto di click (anti popup-blocker):
// il documento arriva dopo, a immagine pronta.
function esportaPdf(r, righe, puntiMappa) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write('<p style="font-family:sans-serif">Preparo la tabella di marcia…</p>');

  immagineMappaPdf(r, puntiMappa).then(({ dataUrl, sfondo }) => {
    const blocco =
      dataUrl == null
        ? '<p><em>Mappa non disponibile (tile non raggiungibili).</em></p>'
        : `<img class="mappa" src="${dataUrl}" alt="Mappa del percorso coi punti di controllo">
           <p class="pie">${
             sfondo
               ? 'Sfondo mappa © OpenStreetMap · OpenTopoMap (CC-BY-SA).'
               : 'Sfondo topografico non disponibile: solo traccia e punti.'
           } Numeri = punti di controllo della tabella.</p>`;
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Tabella di marcia — ${escapeHtml(r.nome || 'percorso')}</title>
<style>
  body { font: 12px/1.4 system-ui, sans-serif; color: #000; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { margin: 0 0 12px; color: #333; }
  .allarme { border: 2px solid #000; padding: 6px 8px; margin: 0 0 12px; font-weight: bold; }
  .mappa { width: 100%; max-height: 60vh; object-fit: contain; border: 1px solid #999; margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: center; }
  th { background: #eee; }
  .pie { margin-top: 6px; color: #555; font-size: 10px; }
  @media print { .mappa { max-height: none; } }
</style></head><body>
<h1>Tabella di marcia — ${escapeHtml(r.nome || 'percorso')}</h1>
<p class="meta">
  ${r.totKm.toFixed(1)} km · +${r.dPlusM}/−${r.dMinusM} m · passo ${r.mhSalita} m/h ·
  partenza ${escapeHtml(formattaOra(new Date(r.partenzaIso), r.tz))} ·
  arrivo previsto ${escapeHtml(formattaOra(new Date(r.arrivoIso), r.tz))}
  (${hmm(r.durataTotaleMin)} h con pause) · ${escapeHtml(testataTramonto(r))}
</p>
${
  r.margineTramontoMin != null && r.margineTramontoMin < 60
    ? `<p class="allarme">ATTENZIONE: arrivo ${
        r.margineTramontoMin < 0
          ? `${-r.margineTramontoMin} min dopo il tramonto`
          : `a soli ${r.margineTramontoMin} min dal tramonto`
      } (regola: finire almeno 1 ora prima).</p>`
    : ''
}
${blocco}
<table><thead><tr>
  <th>#</th><th>ora</th><th>tempo parz/tot</th><th>km parz/tot</th><th>quota</th>
  <th>pend.</th><th>T</th><th>percepita</th><th>raffiche km/h</th><th>prob. pioggia</th><th>mm</th><th>rete</th>
</tr></thead><tbody>
${righe
  .map(
    (x) => `<tr><td>${x.n}</td><td>${escapeHtml(x.ora)}</td><td>${x.tempo}</td><td>${x.km}</td>
<td>${x.quota}</td><td>${x.pend}</td><td>${x.t}</td><td>${x.perc}</td><td>${x.raff}</td><td>${x.prob}</td><td>${x.mm}</td><td>${reteTesto(x.rete)}</td></tr>`
  )
  .join('')}
</tbody></table>
<p class="pie">Colonna «rete»: stima copertura Vodafone da OpenCelliD
(sì = cella entro 2 km, ? = entro 6 km, no = oltre) — indicazione, non garanzia.</p>
<p class="pie">Meteo Trek — previsione generata ${escapeHtml(
      formattaOra(new Date(r.generatoIl), r.tz)
    )} (${escapeHtml(r.modello?.nome || '')}) — stima hobbistica, non sostituisce i bollettini.</p>
<script>window.print()</script>
</body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  });
}
