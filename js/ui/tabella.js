// ─────────────────────────────────────────────────────────────────────────
// Tabella per tratto (stile WeatherGPX esteso): una riga per campione con
// tutte le variabili richieste, riga di dettaglio espandibile al tap.
// Prima colonna sticky, scroll orizzontale sotto i 480 px.
// ─────────────────────────────────────────────────────────────────────────

import { COLORI_SEVERITA, ETICHETTE_RISCHIO } from '../config.js';
import { escapeHtml } from './mappa.js';

// Descrizioni italiane dei weather code WMO
const WMO = {
  0: 'sereno', 1: 'quasi sereno', 2: 'parzialmente nuvoloso', 3: 'coperto',
  45: 'nebbia', 48: 'nebbia con brina',
  51: 'pioviggine debole', 53: 'pioviggine', 55: 'pioviggine intensa',
  56: 'pioviggine gelata', 57: 'pioviggine gelata intensa',
  61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte',
  66: 'pioggia gelata', 67: 'pioggia gelata forte',
  71: 'neve debole', 73: 'neve', 75: 'neve forte', 77: 'granuli di neve',
  80: 'rovesci deboli', 81: 'rovesci', 82: 'rovesci violenti',
  85: 'rovesci di neve', 86: 'rovesci di neve forti',
  95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con grandine forte',
};

export function descriviWmo(codice) {
  return WMO[codice] ?? null;
}

let righeDati = [];
let selezioneCb = null;

const num = (v, dec = 0, unita = '') =>
  Number.isFinite(v) ? `${v.toFixed(dec)}${unita}` : '–';

// Cella con fascia multi-modello: mediana + forbice colorata per accordo.
// Senza fascia (meno di 2 modelli) resta il valore secco del primario.
const CLASSE_ACCORDO = { alta: 'forbice-ok', media: 'forbice-media', bassa: 'forbice-ampia' };
function cellaFascia(valore, f) {
  if (!f) return num(valore, 0, '°');
  const cl = CLASSE_ACCORDO[f.accordo] || '';
  return `${num(f.mediana, 0, '°')} <span class="forbice ${cl}">[${num(f.min, 0)}–${num(f.max, 0)}]</span>`;
}

// campioni: voci arricchite (vedi app.js assemblaCampioni)
// unitaVento: 'kmh' | 'ms'
export function renderTabella(el, { campioni, unitaVento }, onSelezione = null) {
  selezioneCb = onSelezione;
  const inMs = unitaVento === 'ms';
  const vFmt = (kmh) =>
    Number.isFinite(kmh) ? (inMs ? (kmh / 3.6).toFixed(1) : Math.round(kmh)) : '–';
  const uVento = inMs ? 'm/s' : 'km/h';

  const testata = `
    <tr>
      <th>km</th><th>ora</th><th>quota</th><th>T</th><th>perc.</th>
      <th>vento<br>${uVento}</th><th>raffiche<br>${uVento}</th><th>umid.</th>
      <th>sole<br>W/m²</th><th>pioggia<br>prob.</th><th>mm</th><th>rischio</th>
    </tr>`;

  const righe = campioni
    .map((c, i) => {
      const v = c.valori || {};
      const score = c.score ?? 0;

      // Probabilità: voce primaria + forbice k/N dall'ensemble
      let pop = num(v.precipitation_probability, 0, '%');
      if (c.ens && Number.isFinite(c.ens.popKN)) {
        pop =
          pop === '–'
            ? `${c.ens.popKN}%`
            : `${pop} <span class="forbice">(${c.ens.popKN}% su ${c.ens.n})</span>`;
      }

      // Quantità: mm di pioggia, con neve in evidenza quando pertinente
      const quotaSopraZero =
        Number.isFinite(v.freezing_level_height) &&
        Number.isFinite(c.eleM) &&
        c.eleM > v.freezing_level_height;
      let mm = num(v.precipitation, 1);
      if ((Number.isFinite(v.snowfall) && v.snowfall > 0) || (quotaSopraZero && v.precipitation > 0)) {
        mm += ` <span class="neve">❄ ${num(v.snowfall, 1)} cm</span>`;
      }
      if (c.ens && (c.ens.mmMax > 0 || Number.isFinite(v.precipitation))) {
        if (c.ens.mmMax > 0) {
          mm += ` <span class="forbice">[${c.ens.mmMin}–${c.ens.mmMax}]</span>`;
        }
      }

      // Campione senza dati: mai il verde "buono" su un tratto ignoto
      const rischioHtml = c.senzaDati
        ? '<span class="cella-rischio"><span class="chip" style="background:#8b949e"></span>n/d</span>'
        : `<span class="cella-rischio"><span class="chip" style="background:${COLORI_SEVERITA[score]}"></span>${ETICHETTE_RISCHIO[score]}</span>`;

      const dettagli = righeDettaglio(c, vFmt, uVento);
      return `
        <tr class="riga-dati" data-idx="${i}">
          <td>${c.dCumKm.toFixed(1)}</td>
          <td>${escapeHtml(c.oraLocale)}</td>
          <td>${num(c.eleM, 0, ' m')}</td>
          <td>${cellaFascia(v.temperature_2m, c.tFascia)}</td>
          <td>${cellaFascia(c.percepitaC, c.percFascia)}</td>
          <td>${vFmt(v.wind_speed_10m)}</td>
          <td>${vFmt(v.wind_gusts_10m)}</td>
          <td>${num(v.relative_humidity_2m, 0, '%')}</td>
          <td>${num(v.shortwave_radiation, 0)}</td>
          <td>${pop}</td>
          <td>${mm}</td>
          <td>${rischioHtml}</td>
        </tr>
        <tr class="riga-dettagli" hidden><td colspan="12">${dettagli}</td></tr>`;
    })
    .join('');

  el.innerHTML = `<div class="contenitore-tabella"><table class="tratti">
    <thead>${testata}</thead><tbody>${righe}</tbody></table></div>`;
  el.hidden = false;

  righeDati = [...el.querySelectorAll('tr.riga-dati')];
  righeDati.forEach((tr) => {
    tr.addEventListener('click', () => {
      const i = Number(tr.dataset.idx);
      const dettagli = tr.nextElementSibling;
      dettagli.hidden = !dettagli.hidden;
      selezioneCb?.(i);
    });
  });
}

function righeDettaglio(c, vFmt, uVento) {
  if (c.senzaDati) {
    return 'dati meteo non disponibili su questo tratto (fuori dominio del modello)';
  }
  const v = c.valori || {};
  const parti = [];
  const wmo = descriviWmo(v.weather_code);
  if (wmo) parti.push(`<strong>${wmo}</strong>${v.is_day === 0 ? ' (notte)' : ''}`);
  if (Number.isFinite(v.cloud_cover)) parti.push(`nuvolosità ${Math.round(v.cloud_cover)}%`);
  if (Number.isFinite(v.uv_index)) parti.push(`UV ${v.uv_index.toFixed(1)}`);
  if (Number.isFinite(v.wind_direction_10m))
    parti.push(`vento da ${Math.round(v.wind_direction_10m)}°`);
  if (Number.isFinite(v.freezing_level_height))
    parti.push(`zero termico ${Math.round(v.freezing_level_height)} m`);
  if (Number.isFinite(c.precip15Max))
    parti.push(`max 15 min: ${c.precip15Max.toFixed(1)} mm`);
  if (c.canaliAttivi?.length)
    parti.push(
      'rischio da: ' + c.canaliAttivi.map((k) => `${k.nome} (${k.score})`).join(', ')
    );
  if (c.windchill)
    parti.push(`windchill ${Math.round(c.windchill.gradi)}° — ${c.windchill.etichetta}`);
  const perModello = (c.tPerModello || []).filter((m) => Number.isFinite(m.t));
  if (perModello.length > 1) {
    parti.push(
      'T per modello: ' + perModello.map((m) => `${m.nome} ${Math.round(m.t)}°`).join(', ')
    );
  }
  if (c.tFascia?.accordo) parti.push(`accordo modelli T: ${c.tFascia.accordo}`);
  if (c.aff)
    parti.push(
      `affidabilità ${c.aff.pct}% (${c.aff.etichetta})${c.aff.soloLead ? ' — solo lead time' : ''}`
    );
  if (Number.isFinite(c.quotaCella) && Number.isFinite(c.eleM)) {
    const delta = Math.abs(c.quotaCella - c.eleM);
    if (delta > 0)
      parti.push(`cella modello a ${c.quotaCella} m (sentiero ${Math.round(c.eleM)} m)`);
  }
  if (c.fontePercepita) parti.push(`percepita: ${escapeHtml(c.fontePercepita)}`);
  return parti.join(' · ') || 'nessun dettaglio disponibile';
}

// Selezione arrivata da mappa o profilo: evidenzia e scorri alla riga
export function evidenziaRiga(i) {
  righeDati.forEach((tr) => tr.classList.toggle('selezionata', Number(tr.dataset.idx) === i));
  righeDati[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
