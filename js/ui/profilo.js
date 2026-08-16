// ─────────────────────────────────────────────────────────────────────────
// Profilo altimetrico: SVG inline responsive, quota colorata per rischio
// del tratto, tacche agli orari pieni di passaggio, selezione
// sincronizzata con tabella e mappa. Nessuna libreria.
// ─────────────────────────────────────────────────────────────────────────

import { COLORI_SEVERITA } from '../config.js';

const W = 800;
const H = 220;
const M = { sx: 44, dx: 10, su: 12, giu: 26 };

let contenitore = null;
let selezioneCb = null;

// profilo: [{d, e}] quota lungo la traccia (decimata)
// campioni: [{dCumKm, score}]; tacche: [{d, label}] orari pieni
export function renderProfilo(el, { profilo, campioni, tacche }, onSelezione = null) {
  contenitore = el;
  selezioneCb = onSelezione;
  const validi = profilo.filter((p) => Number.isFinite(p.e));
  if (validi.length < 2) {
    el.innerHTML = '<p class="nota">Profilo non disponibile (quote assenti)</p>';
    el.hidden = false; // senza unhide la nota resterebbe invisibile
    return;
  }
  const dMax = profilo[profilo.length - 1].d || 1;
  let eMin = Math.min(...validi.map((p) => p.e));
  let eMax = Math.max(...validi.map((p) => p.e));
  if (eMax - eMin < 100) {
    // Escursione minima: si allarga la scala per non appiattire il grafico
    const centro = (eMax + eMin) / 2;
    eMin = centro - 50;
    eMax = centro + 50;
  }
  const X = (d) => M.sx + (d / dMax) * (W - M.sx - M.dx);
  const Y = (e) => M.su + (1 - (e - eMin) / (eMax - eMin)) * (H - M.su - M.giu);

  const pezzi = [];

  // Assi e griglia quota (3 linee)
  for (const frac of [0, 0.5, 1]) {
    const e = eMin + frac * (eMax - eMin);
    const y = Y(e);
    pezzi.push(`<line class="profilo-asse" x1="${M.sx}" y1="${y}" x2="${W - M.dx}" y2="${y}"/>`);
    pezzi.push(`<text class="profilo-tacca" x="4" y="${y + 3}">${Math.round(e)} m</text>`);
  }

  // Linea quota spezzata per campione, colorata per rischio del tratto
  for (let i = 0; i < campioni.length - 1; i++) {
    const da = campioni[i].dCumKm;
    const a = campioni[i + 1].dCumKm;
    const punti = profilo.filter((p) => p.d >= da - 1e-6 && p.d <= a + 1e-6 && Number.isFinite(p.e));
    if (punti.length < 2) continue;
    const score = Math.max(campioni[i].score ?? 0, campioni[i + 1].score ?? 0);
    const path = punti
      .map((p, k) => `${k ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.e).toFixed(1)}`)
      .join('');
    pezzi.push(
      `<path d="${path}" fill="none" stroke="${COLORI_SEVERITA[score]}" stroke-width="2.5" stroke-linejoin="round"/>`
    );
  }

  // Tacche orarie: posizione prevista a ogni ora piena
  for (const t of tacche || []) {
    const x = X(t.d);
    pezzi.push(`<line class="profilo-asse" x1="${x}" y1="${H - M.giu}" x2="${x}" y2="${H - M.giu + 5}"/>`);
    pezzi.push(
      `<text class="profilo-tacca" x="${x}" y="${H - 8}" text-anchor="middle">${t.label}</text>`
    );
  }

  // Zone cliccabili e marker di selezione per campione
  campioni.forEach((c, i) => {
    const x = X(c.dCumKm);
    pezzi.push(
      `<circle data-idx="${i}" class="profilo-clic" cx="${x}" cy="${Y(quotaA(profilo, c.dCumKm) ?? eMin)}" r="4" fill="${COLORI_SEVERITA[c.score ?? 0]}" stroke="#0d1117" stroke-width="1"/>`
    );
    pezzi.push(
      `<rect data-idx="${i}" class="profilo-clic" x="${x - 8}" y="0" width="16" height="${H - M.giu}" fill="transparent"/>`
    );
  });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profilo altimetrico col rischio meteo">${pezzi.join('')}</svg>`;
  el.hidden = false;

  el.querySelectorAll('.profilo-clic').forEach((n) => {
    n.style.cursor = 'pointer';
    n.addEventListener('click', () => selezioneCb?.(Number(n.dataset.idx)));
  });
}

function quotaA(profilo, d) {
  let vicino = null;
  let dMin = Infinity;
  for (const p of profilo) {
    if (!Number.isFinite(p.e)) continue;
    const dd = Math.abs(p.d - d);
    if (dd < dMin) {
      dMin = dd;
      vicino = p.e;
    }
  }
  return vicino;
}

// Evidenzia il campione selezionato (cerchio più grande temporaneo)
export function evidenziaProfilo(i) {
  if (!contenitore) return;
  contenitore.querySelectorAll('circle.profilo-clic').forEach((c) => {
    c.setAttribute('r', Number(c.dataset.idx) === i ? '7' : '4');
  });
}
