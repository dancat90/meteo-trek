// ─────────────────────────────────────────────────────────────────────────
// Tabella per tratto (stile WeatherGPX esteso): una riga per campione con
// tutte le variabili richieste, riga di dettaglio espandibile al tap.
// Prima colonna sticky, scroll orizzontale sotto i 480 px.
// ─────────────────────────────────────────────────────────────────────────

import { COLORI_SEVERITA, ETICHETTE_RISCHIO, ESPOSIZIONE } from '../config.js';
import { intensitaSolare } from '../nuvole.js';
import { classificaAffidabilitaGlobale } from '../affidabilita.js';
import { descriviConvezione } from '../rischio.js';
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

// Cella sole: intensità qualitativa, con «(velato)» quando il sole resta
// forte sotto una copertura quasi totale (velo alto luminoso). Il badge
// UV appare solo da fascia «alto» in su: sotto non cambia il comportamento
export function cellaSole(wm2, coperturaPct, uv = null) {
  const s = intensitaSolare(wm2);
  const badge =
    uv && uv.fascia >= 2
      ? ` <span class="badge-uv" style="background:${uv.colore}" title="UV ${uv.uv} (${uv.etichetta})">UV ${Math.round(uv.uv)}</span>`
      : '';
  if (!s) return badge ? `–${badge}` : '–';
  const velato = s.livello >= 3 && Number.isFinite(coperturaPct) && coperturaPct >= 80;
  return `${velato ? `${s.etichetta} <span class="forbice">(velato)</span>` : s.etichetta}${badge}`;
}

// Cella nuvolosità: percentuale + piano dominante (basse/medie/alte) +
// quota base (~ = stima LCL, senza tilde = valore del modello);
// «in nube» quando la base è sotto il tratto con nubi basse consistenti
export function cellaNuvole(n) {
  if (!n || !Number.isFinite(n.coperturaPct)) return '–';
  const piano = n.tipologia ? ` <span class="forbice">${n.tipologia}</span>` : '';
  let base = '';
  if (Number.isFinite(n.baseM)) {
    base = n.inNube
      ? ' <span class="forbice in-nube">in nube</span>'
      : ` <span class="forbice">${n.stima ? '~' : ''}${n.baseM} m</span>`;
  }
  return `${Math.round(n.coperturaPct)}%${piano}${base}`;
}

// Cella visibilità: compatta in km (o metri sotto il chilometro),
// con enfasi quando scende sotto i 4 km
export function cellaVisibilita(vis) {
  if (!vis || !Number.isFinite(vis.km)) return '–';
  const testo =
    vis.km < 1 ? `${Math.round(vis.km * 1000)} m` : vis.km < 10 ? `${vis.km.toFixed(1)} km` : `${Math.round(vis.km)} km`;
  return vis.km < 4 ? `<span class="in-nube">${testo}</span>` : testo;
}

// Pallino della stima copertura Vodafone (OpenCelliD)
const COLORE_RETE = { probabile: '#2ea043', incerta: '#f2cc60', assente: '#da3633' };
function cellaRete(rete) {
  if (!rete) return '–';
  const colore = COLORE_RETE[rete.classe] || '#8b949e';
  return `<span class="chip" style="background:${colore}" title="Vodafone ${rete.etichetta}"></span>`;
}
function cellaFascia(valore, f) {
  if (!f) return num(valore, 0, '°');
  const cl = CLASSE_ACCORDO[f.accordo] || '';
  return `${num(f.mediana, 0, '°')} <span class="forbice ${cl}">[${num(f.min, 0)}–${num(f.max, 0)}]</span>`;
}

// Marcatore della correzione orografica nelle colonne vento/raffiche:
// i numeri restano quelli del modello, l'efficace sta nel dettaglio.
// ▾ = riparo (efficace più basso), ▴ = cresta o pendio esposto.
function marcatoreEsposizione(c) {
  const f = c.esposizione?.fattore;
  if (!Number.isFinite(f) || Math.abs(f - 1) < ESPOSIZIONE.sogliaMarcatore) return '';
  return ` <span class="forbice" title="corretto per orografia: vedi dettaglio">${f > 1 ? '▴' : '▾'}</span>`;
}

// Nome del rombo di bussola dalla direzione in gradi
const ROMBI = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const rombo = (g) => ROMBI[Math.round((((g % 360) + 360) % 360) / 45) % 8];

// campioni: voci arricchite (vedi app.js assemblaCampioni)
// unitaVento: 'kmh' | 'ms'
export function renderTabella(el, { campioni, unitaVento, affGlobalePct = null, sosta = null }, onSelezione = null) {
  selezioneCb = onSelezione;
  const inMs = unitaVento === 'ms';
  const vFmt = (kmh) =>
    Number.isFinite(kmh) ? (inMs ? (kmh / 3.6).toFixed(1) : Math.round(kmh)) : '–';
  const uVento = inMs ? 'm/s' : 'km/h';

  const testata = `
    <tr>
      <th>km</th><th>ora</th><th>quota</th><th>T</th><th>perc.</th>
      <th>vento<br>${uVento}</th><th>raffiche<br>${uVento}</th><th>umid.</th>
      <th>sole<br>UV</th><th>nuvole<br>base</th><th>visib.</th><th>pioggia<br>prob.</th><th>mm</th><th>rischio</th><th>rete</th>
    </tr>`;

  // Riga della sosta pranzo: inserita fra i due campioni a cavallo del
  // punto di fermata (colore dedicato, distinto dalla scala del rischio)
  const rigaSosta = sosta
    ? `<tr class="riga-sosta"><td colspan="15">🍽 Sosta pranzo — ${sosta.durataMin} min al km ${sosta.dKm.toFixed(1)} (${escapeHtml(sosta.oraInizio)}–${escapeHtml(sosta.oraFine)})</td></tr>`
    : '';
  const idxSosta = sosta ? campioni.findIndex((c) => c.dCumKm > sosta.dKm) : -1;

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
      if (Number.isFinite(v.snowfall) && v.snowfall > 0) {
        mm += ` <span class="neve">❄ ${num(v.snowfall, 1)} cm</span>`;
      } else if (quotaSopraZero && v.precipitation > 0) {
        // Quantità di neve assente o zero: solo il simbolo, mai «– cm»
        mm += ` <span class="neve" title="quota sopra lo zero termico: probabile neve">❄</span>`;
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
      return `${i === idxSosta ? rigaSosta : ''}
        <tr class="riga-dati" data-idx="${i}">
          <td>${c.dCumKm.toFixed(1)}</td>
          <td>${escapeHtml(c.oraLocale)}</td>
          <td>${num(c.eleM, 0, ' m')}</td>
          <td>${cellaFascia(v.temperature_2m, c.tFascia)}</td>
          <td>${cellaFascia(c.percepitaC, c.percFascia)}</td>
          <td>${vFmt(v.wind_speed_10m)}${marcatoreEsposizione(c)}</td>
          <td>${vFmt(v.wind_gusts_10m)}${marcatoreEsposizione(c)}</td>
          <td>${num(v.relative_humidity_2m, 0, '%')}</td>
          <td>${cellaSole(v.shortwave_radiation, v.cloud_cover, c.uv)}</td>
          <td>${cellaNuvole(c.nuvole)}</td>
          <td>${cellaVisibilita(c.visibilita)}</td>
          <td>${pop}</td>
          <td>${mm}</td>
          <td>${rischioHtml}</td>
          <td>${cellaRete(c.rete)}</td>
        </tr>
        <tr class="riga-dettagli" hidden><td colspan="15">${dettagli}</td></tr>`;
    })
    .join('');

  // Badge dell'affidabilità complessiva (media dei tratti), dal rosso
  // al verde. Assente sui risultati salvati prima della funzione.
  const affG = classificaAffidabilitaGlobale(affGlobalePct);
  const badgeAff = affG
    ? `<div class="affidabilita-globale">Affidabilità della previsione:
        <span class="valore" style="background:${affG.colore}">${affGlobalePct}% — ${affG.etichetta}</span>
        <span class="forbice">media dei tratti: accordo fra modelli, ensemble e distanza nel tempo</span>
      </div>`
    : '';

  // Sosta oltre l'ultimo campione: riga in coda (caso limite)
  const righeConCoda = sosta && idxSosta === -1 ? righe + rigaSosta : righe;

  el.innerHTML = `${badgeAff}<div class="contenitore-tabella"><table class="tratti">
    <thead>${testata}</thead><tbody>${righeConCoda}</tbody></table></div>`;
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
  if (Number.isFinite(v.cloud_cover)) {
    let nb = '';
    if (Number.isFinite(c.nuvole?.baseM)) {
      nb = `, base ${c.nuvole.stima ? 'stimata ~' : ''}${c.nuvole.baseM} m slm${c.nuvole.inNube ? ' — TRATTO IN NUBE' : ''}`;
    }
    parti.push(`nuvolosità ${Math.round(v.cloud_cover)}%${nb}`);
    if (Number.isFinite(c.nuvole?.bassePct)) {
      parti.push(
        `nubi basse ${Math.round(c.nuvole.bassePct)}% / medie ${Math.round(c.nuvole.mediePct ?? 0)}% / alte ${Math.round(c.nuvole.altePct ?? 0)}%`
      );
    }
  }
  if (c.visibilita) {
    parti.push(
      `visibilità ${c.visibilita.km < 1 ? Math.round(c.visibilita.km * 1000) + ' m' : c.visibilita.km.toFixed(1) + ' km'} (${c.visibilita.etichetta}, ${escapeHtml(c.visibilita.fonte || 'GFS')})`
    );
  }
  if (Number.isFinite(v.relative_humidity_2m) && v.relative_humidity_2m >= 95) {
    parti.push('UR ≥95%: possibile foschia o nebbia locale che i modelli larghi non vedono');
  }
  if (Number.isFinite(v.shortwave_radiation))
    parti.push(`sole ${Math.round(v.shortwave_radiation)} W/m²`);
  if (c.uv) {
    // Trasparenza completa: badge OMS + grezzo, fonte e correzioni.
    // L'UV corretto entra anche nel canale di rischio caldo.
    const dQuota = Math.round((c.uv.fattoreQuota - 1) * 100);
    const dettagliUv = [
      `grezzo ${c.uv.grezzo.toFixed(1)}${c.uv.fonte ? ` (${escapeHtml(c.uv.fonte)})` : ''}`,
      dQuota !== 0
        ? `${dQuota > 0 ? '+' : ''}${dQuota}% per ${Math.abs(Math.round(c.uv.deltaM))} m ${c.uv.deltaM >= 0 ? 'sopra' : 'sotto'} la cella`
        : null,
      c.uv.fattoreNeve > 1 ? `+${Math.round((c.uv.fattoreNeve - 1) * 100)}% neve prevista` : null,
    ]
      .filter(Boolean)
      .join(', ');
    parti.push(
      `<span class="badge-uv" style="background:${c.uv.colore}">UV ${c.uv.uv.toFixed(1)}</span> ${c.uv.etichetta} — ${dettagliUv}; usato nel rischio caldo`
    );
  } else if (Number.isFinite(v.uv_index)) {
    // Risultati salvati prima della funzione: resta la vecchia riga
    parti.push(`UV ${v.uv_index.toFixed(1)}`);
  }
  // Indici convettivi (assenti sui risultati salvati prima della funzione)
  const conv = descriviConvezione(c.convezione);
  if (conv) parti.push(escapeHtml(conv));
  if (Number.isFinite(v.wind_direction_10m)) {
    let voceVento = `vento da ${Math.round(v.wind_direction_10m)}° (${rombo(v.wind_direction_10m)})`;
    const e = c.esposizione;
    if (e && Number.isFinite(e.fattore) && Math.abs(e.fattore - 1) >= ESPOSIZIONE.sogliaMarcatore) {
      const eff = [];
      if (Number.isFinite(e.ventoEffKmh)) eff.push(`efficace ${vFmt(e.ventoEffKmh)} ${uVento}`);
      if (Number.isFinite(e.raffEffKmh)) eff.push(`raffiche ${vFmt(e.raffEffKmh)} ${uVento}`);
      const nomeClasse =
        { riparo: 'riparo orografico', cresta: 'cresta esposta', pendio: 'pendio esposto' }[e.classe] ||
        'correzione orografica';
      voceVento += ` — ${eff.join(', ')}: ${nomeClasse} (fattore ${e.fattore.toFixed(2)})`;
    }
    parti.push(voceVento);
  }
  if (Number.isFinite(v.freezing_level_height))
    parti.push(`zero termico ${Math.round(v.freezing_level_height)} m`);
  if (Number.isFinite(c.precip15Max))
    parti.push(`max 15 min: ${c.precip15Max.toFixed(1)} mm`);
  if (c.canaliAttivi?.length) {
    // In grassetto e col colore della classe di rischio del tratto:
    // deve saltare all'occhio in mezzo al resto del dettaglio
    parti.push(
      `<strong class="dettaglio-rischio" style="color:${COLORI_SEVERITA[c.score ?? 0]}">rischio da: ${c.canaliAttivi.map((k) => `${k.nome} (${k.score})`).join(', ')}</strong>`
    );
  }
  if (c.windchill) {
    // Tre varianti: governa la colonna / non governa / risultato salvato
    // prima della fusione (campo percepitaGoverna assente)
    const wcTxt = `windchill ${Math.round(c.windchill.gradi)}°`;
    if (c.percepitaGoverna === 'windchill')
      parti.push(`${wcTxt} (governa la percepita) — ${c.windchill.etichetta}`);
    else if (c.percepitaGoverna)
      parti.push(`${wcTxt} (la percepita mostrata è già più severa) — ${c.windchill.etichetta}`);
    else parti.push(`${wcTxt} — ${c.windchill.etichetta}`);
  }
  if (c.rete)
    parti.push(
      `rete Vodafone ${c.rete.etichetta}${Number.isFinite(c.rete.distKm) ? ` (cella nota a ${c.rete.distKm.toFixed(1)} km)` : ''}${c.rete.emergenzaAltraRete ? ' — altra rete vicina: chiamata 112 possibile' : ''} — stima OpenCelliD, non garanzia`
    );
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
