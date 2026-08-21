// ─────────────────────────────────────────────────────────────────────────
// Pannello impostazioni: passo predefinito, pause predefinite, unità del
// vento, svuotamento cronologia. Pattern dialog di meteo-rotta (reset di
// returnValue a ogni apertura: senza, un Esc dopo un precedente Salva
// verrebbe interpretato di nuovo come 'salva').
// ─────────────────────────────────────────────────────────────────────────

import { impostazioni, salvaImpostazioni, cronologiaSvuota } from '../storage.js';
import { VERSIONE, PASSI } from '../config.js';

export function initImpostazioni({ bottoneApri, dialogo, onCronologiaSvuotata }) {
  dialogo.innerHTML = `
    <form method="dialog" class="form-impostazioni">
      <h2>Impostazioni</h2>
      <label>Passo in salita predefinito
        <select name="passo">
          ${PASSI.map((p) => `<option value="${p.mOra}">${p.etichetta}</option>`).join('')}
        </select>
        <small>I metri di dislivello che sali in un'ora a passo tuo.
        La scala di riferimento (400 m/h) è quella dei cartelli CAI/svizzeri.</small>
      </label>
      <label>Pause predefinite (minuti per ora di marcia)
        <input type="number" name="pause" min="0" max="30" step="5">
      </label>
      <label>Unità del vento
        <select name="vento">
          <option value="kmh">km/h</option>
          <option value="ms">m/s</option>
        </select>
      </label>
      <label class="riga-interruttore">
        <input type="checkbox" name="fondo">
        <span>Avvisa sullo stato del fondo (fango, neve, ghiaccio)</span>
        <small>Guarda che cosa è successo al terreno nei giorni PRIMA della gita:
        pioggia nelle ultime 72 ore, neve nelle ultime 120, gelo notturno nelle ultime 18.
        Richiede una chiamata di rete in più: spegnilo se hai poco traffico dati.</small>
      </label>
      <div class="riga-bottoni">
        <button type="button" name="svuota">Svuota cronologia</button>
        <button value="annulla">Annulla</button>
        <button value="salva" class="primario">Salva</button>
      </div>
      <small class="versione">meteo-trek v${VERSIONE}</small>
    </form>`;

  const form = dialogo.querySelector('form');

  bottoneApri.addEventListener('click', () => {
    const imp = impostazioni();
    form.elements.passo.value = String(imp.mhSalita);
    form.elements.pause.value = String(imp.pausaMinOra);
    form.elements.vento.value = imp.unitaVento;
    form.elements.fondo.checked = imp.fondoAttivo !== false;
    dialogo.returnValue = '';
    dialogo.showModal();
  });

  form.elements.svuota.addEventListener('click', () => {
    cronologiaSvuota();
    onCronologiaSvuotata?.();
    form.elements.svuota.textContent = 'Cronologia svuotata ✓';
    setTimeout(() => (form.elements.svuota.textContent = 'Svuota cronologia'), 1500);
  });

  dialogo.addEventListener('close', () => {
    if (dialogo.returnValue !== 'salva') return;
    const dentro = (v, min, max, predef) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : predef;
    };
    salvaImpostazioni({
      mhSalita: Number(form.elements.passo.value) || 400,
      pausaMinOra: dentro(form.elements.pause.value, 0, 30, 10),
      unitaVento: form.elements.vento.value === 'ms' ? 'ms' : 'kmh',
      fondoAttivo: form.elements.fondo.checked,
    });
  });
}
