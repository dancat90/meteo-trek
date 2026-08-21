// ─────────────────────────────────────────────────────────────────────────
// Pannello del pianificatore: heatmap giorno × ora locale delle partenze
// candidate, cella colorata sul rischio massimo lungo il percorso (stesse
// 4 classi della tabella), badge tramonto, dettaglio al click con
// click-through verso la previsione completa.
// ─────────────────────────────────────────────────────────────────────────

import { COLORI_SEVERITA, ETICHETTE_RISCHIO, PIANIFICATORE, FONDO_CLASSI } from '../config.js';
import { formattaOra } from '../tempo.js';
import { escapeHtml } from './mappa.js';

const GRIGIO = '#8b949e';

// Etichetta italiana del giorno da "YYYY-MM-DD" (il giorno locale è già
// stato risolto nel fuso del percorso: qui si formatta solo la data)
function etichettaGiorno(dataIso) {
  const d = new Date(dataIso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

function badgeTramonto(f) {
  if (!f.tramonto) return '';
  if (f.tramonto.classe === 'dopo') return '<span class="tramonto-badge" title="arrivo DOPO il tramonto">☾</span>';
  if (f.tramonto.classe === 'stretto') return '<span class="tramonto-badge" title="arrivo a meno di 1 h dal tramonto">!</span>';
  return '';
}

// Marcatore del fondo nella cella: SOLO neve e ghiaccio, che entrano nel
// rischio. Il fango resta nel dettaglio: in una cella da 40 px un quarto
// simbolo la renderebbe illeggibile senza aggiungere una decisione.
function badgeFondo(f) {
  const c = f?.fondo?.classe;
  if (c !== 'neve' && c !== 'ghiaccio' && c !== 'crosta') return '';
  const cl = FONDO_CLASSI[c];
  return `<span class="fondo-badge" title="${escapeHtml(f.fondo.testo || cl.etichetta)}">${cl.icona}</span>`;
}

function motivoGrigio(f, nomeModello, orizzonteOre) {
  if (f.stato === 'oltreOrizzonte') return `oltre l'orizzonte di ${nomeModello} (${orizzonteOre} h)`;
  if (f.stato === 'senzaDati') return 'dati non disponibili';
  return '';
}

// dati: { finestre, tz, fasciaOreLocali, nomeModello, orizzonteOre, note }
// onScegli: (finestra) => void — click-through verso prevedi()
export function renderPianificatore(container, dati, onScegli) {
  const { finestre, tz, fasciaOreLocali = PIANIFICATORE.fasciaOreLocali, nomeModello, orizzonteOre, note = [] } = dati;
  const ore = [];
  for (let h = fasciaOreLocali[0]; h <= fasciaOreLocali[1]; h++) ore.push(h);

  // Raggruppa per giorno locale, indicizza per ora
  const giorni = [];
  const perCella = new Map();
  for (const f of finestre) {
    if (!giorni.includes(f.dataIso)) giorni.push(f.dataIso);
    perCella.set(`${f.dataIso}|${parseInt(f.oraLocale, 10)}`, f);
  }

  const testata =
    `<div class="cella-griglia intestazione"></div>` +
    ore.map((h) => `<div class="cella-griglia intestazione">${String(h).padStart(2, '0')}</div>`).join('');

  const righe = giorni
    .map((g) => {
      const celle = ore
        .map((h) => {
          const f = perCella.get(`${g}|${h}`);
          if (!f) return '<div class="cella-griglia vuota" title="nel passato o fuori griglia"></div>';
          const idx = finestre.indexOf(f);
          if (f.scoreMax === null || f.stato === 'oltreOrizzonte' || f.stato === 'senzaDati') {
            return `<div class="cella-griglia grigia" title="${escapeHtml(motivoGrigio(f, nomeModello, orizzonteOre))}">·</div>`;
          }
          const parziale = f.stato === 'datiParziali' ? '<span class="parziale" title="dati parziali su alcuni tratti">~</span>' : '';
          return `<div class="cella-griglia attiva" data-idx="${idx}"
            style="background:${COLORI_SEVERITA[f.scoreMax]}"
            title="${escapeHtml(`partenza ${f.oraLocale}: rischio massimo ${ETICHETTE_RISCHIO[f.scoreMax]}`)}"
            role="button" tabindex="0">${f.scoreMax}${parziale}${badgeFondo(f)}${badgeTramonto(f)}</div>`;
        })
        .join('');
      return `<div class="cella-griglia intestazione riga-giorno">${escapeHtml(etichettaGiorno(g))}</div>${celle}`;
    })
    .join('');

  const noteHtml = note.length
    ? `<div class="avvisi">${note.map((a) => `<div>⚠ ${escapeHtml(a)}</div>`).join('')}</div>`
    : '';

  container.innerHTML = `
    <div class="pannello pianificatore">
      <div class="marcia-testata"><strong>Finestre di partenza (prossime ${PIANIFICATORE.orizzonteOre} h)</strong>
        — modello ${escapeHtml(nomeModello)} · ore locali ${escapeHtml(tz)}</div>
      ${noteHtml}
      <div class="griglia-pianificatore" style="grid-template-columns: auto repeat(${ore.length}, minmax(40px, 1fr))">
        ${testata}${righe}
      </div>
      <div class="legenda-pianificatore forbice">
        Cella = rischio massimo lungo il percorso per quella partenza (0 buono → 3 severo) ·
        ☾ arrivo dopo il tramonto · ! margine sotto 1 h · ~ dati parziali · · oltre orizzonte o senza dati ·
        ❄ neve al suolo · 🧊 ghiaccio o crosta dura (il fango non compare qui: apri il dettaglio).
        Il pianificatore valuta solo il rischio a 5 canali sul modello primario: dettaglio 15 min,
        confronto fra modelli, UV, instabilità (lifted index) e affidabilità restano nella previsione
        completa, che è il riferimento — lo score di una cella può differire fino a 2 classi nei casi
        estremi (UV o instabilità marcati che qui non sono valutati).
      </div>
      <div class="dettaglio-pianificatore" hidden></div>
    </div>`;
  container.hidden = false;

  const dettaglio = container.querySelector('.dettaglio-pianificatore');
  const celle = [...container.querySelectorAll('.cella-griglia.attiva')];
  const seleziona = (cella) => {
    const f = finestre[Number(cella.dataset.idx)];
    if (!f) return;
    celle.forEach((c) => c.classList.toggle('selezionata', c === cella));
    const distr = (f.distribuzione || [])
      .map((n, s) => (n ? `<span class="chip" style="background:${COLORI_SEVERITA[s]}"></span> ${n} ${ETICHETTE_RISCHIO[s]}` : null))
      .filter(Boolean)
      .join(' · ');
    const canali = f.peggior?.canali?.length
      ? `tratto peggiore al km ${f.peggior.dCumKm.toFixed(1)}: ${f.peggior.canali.map((k) => `${k.nome} (${k.score})`).join(', ')}`
      : 'nessun canale di rischio attivo';
    const tram = f.tramonto
      ? f.tramonto.classe === 'dopo'
        ? `arrivo ${-f.tramonto.margineMin} min DOPO il tramonto delle ${formattaOra(new Date(f.tramonto.tramontoUtcMs), tz)}`
        : `margine sul tramonto ${f.tramonto.margineMin} min (tramonto ${formattaOra(new Date(f.tramonto.tramontoUtcMs), tz)})`
      : 'tramonto non calcolabile';
    // Stato del fondo del giorno candidato: ogni partenza ha la sua
    // storia di pioggia, neve e gelo nei giorni precedenti
    const fondoTxt = f.fondo
      ? `fondo: ${FONDO_CLASSI[f.fondo.classe]?.icona ?? ''} ${FONDO_CLASSI[f.fondo.classe]?.etichetta ?? f.fondo.classe} al km ${f.fondo.dCumKm.toFixed(1)} — ${f.fondo.testo}`
      : 'stato del fondo non valutato per questa partenza';
    dettaglio.innerHTML = `
      <div><strong>${escapeHtml(etichettaGiorno(f.dataIso))} ${escapeHtml(f.oraLocale)}</strong>
        → arrivo ${formattaOra(new Date(f.arrivoUtcMs), tz)}</div>
      <div>${distr || '—'}</div>
      <div>${canali}</div>
      <div>${escapeHtml(fondoTxt)}</div>
      <div>${escapeHtml(tram)}${f.campioniSenzaDati ? ` · ${f.campioniSenzaDati} tratti senza dati` : ''}</div>
      <button type="button" class="scegli-finestra">Prevedi per questo orario</button>`;
    dettaglio.hidden = false;
    dettaglio.querySelector('.scegli-finestra')?.addEventListener('click', () => onScegli?.(f));
  };
  celle.forEach((cella) => {
    cella.addEventListener('click', () => seleziona(cella));
    cella.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        seleziona(cella);
      }
    });
  });
}
