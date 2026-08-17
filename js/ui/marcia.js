// ─────────────────────────────────────────────────────────────────────────
// Tabella di marcia: punti di controllo ogni 15 minuti di tabella, con
// meteo, quota, pendenza media del tratto, parziali di distanza e tempo.
// Esportazione PDF senza librerie: si apre una finestra di stampa con un
// documento autonomo (bianco su nero di stampa) e si lascia al browser
// il "Salva come PDF". Funziona anche offline.
// ─────────────────────────────────────────────────────────────────────────

import { escapeHtml } from './mappa.js';
import { formattaOra } from '../tempo.js';

const hmm = (min) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const num = (v, dec = 0, unita = '') =>
  Number.isFinite(v) ? `${v.toFixed(dec)}${unita}` : '–';

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

export function renderMarcia(el, r) {
  if (!r.marcia?.length) {
    el.hidden = true;
    return;
  }
  const righe = righeDati(r);
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
      <div class="contenitore-tabella"><table class="tratti">
        <thead><tr>
          <th>#</th><th>ora</th><th>tempo<br>parz/tot</th><th>km<br>parz/tot</th>
          <th>quota</th><th>pend.</th><th>T</th><th>perc.</th>
          <th>raffiche<br>km/h</th><th>prob.</th><th>mm</th><th>rete</th>
        </tr></thead>
        <tbody>${righe
          .map(
            (x) => `<tr>
          <td>${x.n}</td><td>${escapeHtml(x.ora)}</td><td>${x.tempo}</td><td>${x.km}</td>
          <td>${x.quota}</td><td>${x.pend}</td><td>${x.t}</td><td>${x.perc}</td>
          <td>${x.raff}</td><td>${x.prob}</td><td>${x.mm}</td><td>${reteDot(x.rete)}</td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </div>`;
  el.hidden = false;
  el.querySelector('#bottone-pdf-marcia')?.addEventListener('click', () => esportaPdf(r));
}

// Documento di stampa autonomo: il "Salva come PDF" del browser fa il
// resto. Nessuna libreria, nessuna rete.
function esportaPdf(r) {
  const righe = righeDati(r);
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Tabella di marcia — ${escapeHtml(r.nome || 'percorso')}</title>
<style>
  body { font: 12px/1.4 system-ui, sans-serif; color: #000; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { margin: 0 0 12px; color: #333; }
  .allarme { border: 2px solid #000; padding: 6px 8px; margin: 0 0 12px; font-weight: bold; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: center; }
  th { background: #eee; }
  .pie { margin-top: 10px; color: #555; font-size: 10px; }
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
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
