// ─────────────────────────────────────────────────────────────────────────
// Stato del FONDO del sentiero: che cosa è successo al terreno nei giorni
// PRIMA del passaggio. Risponde alla domanda che nessuna previsione
// istantanea copre: «trovo fango, neve fresca o ghiaccio?».
//
// Tre fenomeni, tre finestre retrospettive diverse (config.js FONDO):
// - fango:    72 h. La pioggia asciuga in 2-3 giorni.
// - neve:    120 h. Il manto resta al suolo per settimane.
// - ghiaccio: 48 h per l'acqua sul terreno + 18 h per il gelo notturno.
//   Il ghiaccio non nasce dal freddo da solo: serve acqua liquida PRIMA.
//   Un sentiero asciutto a −5 °C non ha ghiaccio.
//
// Tre scelte che alzano la fedeltà rispetto a una stima a occhio:
// 1. le temperature arrivano già alla quota del sentiero (parametro
//    elevation della chiamata), e la fonte separa pioggia da neve alla
//    quota giusta: niente ricalcolo della fase con soglie arbitrarie;
// 2. il gelo si valuta sulla temperatura del SUOLO, non dell'aria: il
//    terreno ha inerzia termica e l'aria a −1 °C non gela una pozza se il
//    fondo sta a +4 °C;
// 3. la fusione della neve si modula col versante (versante.js): a nord
//    la neve dura molto di più che a sud, a parità di quota.
//
// Regola di prudenza non negoziabile: senza copertura dati sufficiente lo
// stato è «ignoto», MAI «asciutto». Silenzio e via libera non devono
// confondersi.
//
// Modulo puro: nessuna rete, nessun DOM, testabile in Node.
// ─────────────────────────────────────────────────────────────────────────

import { FONDO, FONDO_CLASSI } from './config.js';

// ── Estrazione e sanificazione delle serie ──────────────────────────────

// serieCampione: { t0Ms, valori: {nomeVar: array} } da meteoSerie().
// Ritorna { t0Ms, n, rain, snowfall, snowDepth, tAria, tSuolo, et0 }
// con gli array grezzi (i null restano null: la copertura li conta).
export function preparaFondo(serieCampione) {
  const v = serieCampione?.valori;
  if (!serieCampione || !Number.isFinite(serieCampione.t0Ms) || !v) return null;
  const rain = v.rain || [];
  const n = Math.max(
    rain.length,
    v.snowfall?.length || 0,
    v.temperature_2m?.length || 0
  );
  if (!n) return null;
  return {
    t0Ms: serieCampione.t0Ms,
    n,
    rain,
    snowfall: v.snowfall || [],
    snowDepth: v.snow_depth || [], // METRI: la conversione avviene sotto
    tAria: v.temperature_2m || [],
    tSuolo: v.soil_temperature_0cm || [],
    et0: v.et0_fao_evapotranspiration || [],
  };
}

const numero = (arr, i) => {
  const x = arr?.[i];
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

// Peso di recency della pioggia per distanza in ore dal passaggio
export function pesoPioggia(oreFa) {
  if (oreFa < 24) return FONDO.pesiPioggia[0];
  if (oreFa < 48) return FONDO.pesiPioggia[1];
  if (oreFa < FONDO.orePioggia) return FONDO.pesiPioggia[2];
  return 0;
}

// Score da soglie crescenti: 1/2/3 al superamento
function aSoglie(valore, soglie) {
  if (!Number.isFinite(valore)) return 0;
  let s = 0;
  for (let i = 0; i < soglie.length; i++) if (valore >= soglie[i]) s = i + 1;
  return s;
}

// ── Motore ──────────────────────────────────────────────────────────────

// prep: da preparaFondo(); istanteMs: passaggio sul tratto;
// quotaM: quota del sentiero; versante: da versantiDaQuote() o null.
export function statoFondo(prep, { istanteMs, quotaM = null, versante = null } = {}) {
  if (!prep) return statoIgnoto('serie non disponibili', versante);
  const idx = Math.round((istanteMs - prep.t0Ms) / 3600000);
  if (idx < 0 || idx >= prep.n) {
    return statoIgnoto('istante fuori dalla finestra scaricata', versante);
  }

  const fEspo = Number.isFinite(versante?.fattoreFusione) ? versante.fattoreFusione : 1;
  // Fusione oraria per grado sopra zero, già modulata col versante
  const fusionePerGrado = (FONDO.fusioneCmGradoGiorno / 24) * fEspo;

  // ── Simulazione sequenziale del manto nevoso (120 h) ──────────────────
  // Sequenziale e non a somme cumulate: la fusione non può «spendersi»
  // prima che la neve cada. Con le somme, una settimana calda PRIMA della
  // nevicata cancellerebbe neve mai fusa — sottostima anti-prudente.
  let manto = 0; // cm
  let cadutaFinestra = 0; // cm caduti nella finestra neve
  let cadutaValanga = 0; // cm caduti nelle ultime 72 h
  let fusioneAcqua = 0; // cm fusi nelle ultime 48 h → acqua sul terreno
  let oreNeveValide = 0;
  const daNeve = idx - FONDO.oreNeve + 1;
  for (let k = daNeve; k <= idx; k++) {
    if (k < 0 || k >= prep.n) continue;
    const nevicata = numero(prep.snowfall, k);
    const t = numero(prep.tAria, k);
    if (nevicata === null && t === null) continue;
    oreNeveValide++;
    const oreFa = idx - k;
    if (nevicata !== null && nevicata > 0) {
      manto += nevicata;
      cadutaFinestra += nevicata;
      if (oreFa < FONDO.oreValanga) cadutaValanga += nevicata;
    }
    if (t !== null && t > 0 && manto > 0) {
      const fuso = Math.min(manto, t * fusionePerGrado);
      manto -= fuso;
      if (oreFa < FONDO.oreAcqua) fusioneAcqua += fuso;
    }
  }
  const cmBilancio = manto;

  // Manto previsto dal modello all'ora di passaggio (metri → cm).
  // Include la neve preesistente che il bilancio non può vedere (nevaio
  // di stagione caduto prima della finestra): si tiene la stima PIÙ
  // SEVERA delle due, mai la media.
  const depthM = numero(prep.snowDepth, idx);
  const cmModello = depthM === null ? null : depthM * 100;
  const cmNeve = Math.max(cmBilancio, cmModello ?? 0);

  // ── Bilancio idrico pesato (72 h) ─────────────────────────────────────
  let mmPioggia = 0;
  let mmEt0 = 0;
  let rovescioMax = 0;
  let orePioggiaValide = 0;
  const daPioggia = idx - FONDO.orePioggia + 1;
  for (let k = daPioggia; k <= idx; k++) {
    if (k < 0 || k >= prep.n) continue;
    const p = numero(prep.rain, k);
    const e = numero(prep.et0, k);
    if (p === null && e === null) continue;
    orePioggiaValide++;
    const peso = pesoPioggia(idx - k);
    if (p !== null) {
      mmPioggia += p * peso;
      if (idx - k < 24) rovescioMax = Math.max(rovescioMax, p);
    }
    if (e !== null) mmEt0 += e * peso;
  }
  const mmNetti = Math.max(0, mmPioggia - mmEt0);
  let livFango = aSoglie(mmNetti, FONDO.sogliePioggiaMm);
  const rovescio = rovescioMax >= FONDO.rovescioMmOra;
  // Rovescio violento: il sentiero si incide anche col totale basso
  if (rovescio) livFango = Math.max(livFango, 2);

  // ── Ghiaccio: acqua (48 h) + gelo (18 h) ──────────────────────────────
  let acquaMm = 0;
  const daAcqua = idx - FONDO.oreAcqua + 1;
  for (let k = daAcqua; k <= idx; k++) {
    if (k < 0 || k >= prep.n) continue;
    const p = numero(prep.rain, k);
    if (p !== null) acquaMm += p;
  }
  // 1 cm di manto fuso ≈ 1 mm di acqua liquida sul terreno
  acquaMm += fusioneAcqua;

  // Temperatura di riferimento del gelo: il SUOLO. L'aria è il ripiego
  // dichiarato quando il modello non espone il suolo.
  const seriegelo = prep.tSuolo?.length ? prep.tSuolo : prep.tAria;
  const fonteT = prep.tSuolo?.length ? 'suolo' : 'aria';
  let tMin = null;
  let oreGeloValide = 0;
  const daGelo = idx - FONDO.oreGelo + 1;
  for (let k = daGelo; k <= idx; k++) {
    if (k < 0 || k >= prep.n) continue;
    const t = numero(seriegelo, k);
    if (t === null) continue;
    oreGeloValide++;
    tMin = tMin === null ? t : Math.min(tMin, t);
  }
  const tOra = numero(seriegelo, idx);

  // Cicli gelo-disgelo (48 h): ogni discesa sotto zero dopo essere stati
  // sopra. Su neve residua producono la crosta dura, il caso peggiore:
  // un pendio nevoso ghiacciato non frena una scivolata.
  let cicli = 0;
  let sopraZero = null;
  const daCicli = idx - FONDO.oreCicli + 1;
  for (let k = daCicli; k <= idx; k++) {
    if (k < 0 || k >= prep.n) continue;
    const t = numero(seriegelo, k);
    if (t === null) continue;
    const ora = t > 0;
    if (sopraZero === true && ora === false) cicli++;
    sopraZero = ora;
  }

  const acquaCe = acquaMm >= FONDO.acquaMinimaMm;
  let esito = 'no';
  let livGhiaccio = 0;
  if (cmNeve >= FONDO.neveCrostaCm && cicli >= 1) {
    esito = 'crosta';
    livGhiaccio = 3;
  } else if (acquaCe && tOra !== null && tOra <= FONDO.sogliaGeloCertoC) {
    esito = 'certo';
    livGhiaccio = 3;
  } else if (acquaCe && tMin !== null && tMin <= FONDO.sogliaGeloCertoC) {
    esito = 'probabile';
    livGhiaccio = 2;
  } else if (acquaCe && tMin !== null && tMin <= FONDO.sogliaGeloC) {
    esito = 'possibile';
    livGhiaccio = 1;
  }

  const livNeve = aSoglie(cmNeve, FONDO.soglieNeveCm);

  // ── Copertura: senza abbastanza ore la risposta è «ignoto» ────────────
  // Il denominatore è la finestra PIENA richiesta, non quella disponibile:
  // una serie troncata (trek fra 6 giorni, modello che non arriva indietro)
  // deve far scattare «dati insufficienti», non un falso «asciutto».
  const valide = oreNeveValide + orePioggiaValide + oreGeloValide;
  const coperturaAssoluta =
    valide / (FONDO.oreNeve + FONDO.orePioggia + FONDO.oreGelo);
  if (coperturaAssoluta < FONDO.coperturaMinima) {
    return statoIgnoto(
      `finestra retrospettiva coperta solo al ${Math.round(coperturaAssoluta * 100)}%`,
      versante,
      { coperturaPct: coperturaAssoluta }
    );
  }

  const valanga =
    cadutaValanga >= FONDO.valangaNeveCm &&
    Number.isFinite(versante?.pendenzaPct) &&
    versante.pendenzaPct >= FONDO.valangaPendenzaPct;

  const neveStabile =
    Number.isFinite(quotaM) && quotaM >= FONDO.quotaNeveStabileM && cmNeve > 0;

  const livello = Math.max(livFango, livNeve, livGhiaccio);
  // Tetti differenziati nel canale di rischio (scelta dichiarata):
  // - ghiaccio e crosta: fino al livello massimo, è pericolo di caduta;
  // - neve: si ferma a 2, rallenta e fa arrivare al buio ma non è un
  //   pericolo diretto;
  // - fango: FUORI dalla fusione, altrimenti ogni gita autunnale con
  //   cielo perfetto risulterebbe rischiosa e gli avvisi perderebbero
  //   credibilità.
  const scoreRischio = Math.max(livGhiaccio, Math.min(2, livNeve));

  const classe =
    esito === 'crosta'
      ? 'crosta'
      : livGhiaccio >= 1
        ? 'ghiaccio'
        : livNeve >= 1
          ? 'neve'
          : livFango >= 1
            ? ['umido', 'fangoso', 'saturo'][livFango - 1]
            : 'asciutto';

  const stato = {
    dati: coperturaAssoluta >= 0.95 ? 'completi' : 'parziali',
    coperturaPct: coperturaAssoluta,
    fango: {
      livello: livFango,
      mmNetti,
      mmPioggia,
      mmEt0,
      rovescioMmOra: rovescioMax,
      rovescio,
    },
    neve: {
      livello: livNeve,
      cm: cmNeve,
      cmModello,
      cmBilancio,
      cadutaCm: cadutaFinestra,
      cadutaCm72: cadutaValanga,
      valanga,
      quotaStabile: neveStabile,
    },
    ghiaccio: {
      livello: livGhiaccio,
      esito,
      acquaMm,
      tMinC: tMin,
      tOraC: tOra,
      cicli,
      fonteT,
    },
    versante: versante
      ? {
          nome: versante.nome,
          aspectGradi: versante.aspectGradi,
          pendenzaPct: versante.pendenzaPct,
          fattoreFusione: versante.fattoreFusione,
        }
      : null,
    classe,
    livello,
    scoreRischio,
  };
  stato.testo = descriviFondo(stato);
  return stato;
}

function statoIgnoto(motivo, versante = null, extra = {}) {
  return {
    dati: 'assenti',
    coperturaPct: 0,
    motivo,
    fango: null,
    neve: null,
    ghiaccio: null,
    versante: versante
      ? { nome: versante.nome, pendenzaPct: versante.pendenzaPct }
      : null,
    classe: 'ignoto',
    livello: 0,
    scoreRischio: 0,
    testo: `stato del fondo non valutabile: ${motivo}`,
    ...extra,
  };
}

// ── Testo per l'interfaccia ─────────────────────────────────────────────

const ESITO_GHIACCIO = {
  possibile: 'ghiaccio possibile',
  probabile: 'ghiaccio probabile',
  certo: 'ghiaccio al passaggio',
  crosta: 'crosta dura su neve',
};

const un = (v, dec = 0, u = '') =>
  Number.isFinite(v) ? `${v.toFixed(dec).replace('.', ',')}${u}` : '–';

// Frase pronta, usata da tabella, dettaglio, CSV e PDF (una sola fonte)
export function descriviFondo(s) {
  if (!s || s.classe === 'ignoto') {
    return s?.motivo ? `stato del fondo non valutabile: ${s.motivo}` : 'stato del fondo non valutabile';
  }
  const parti = [];
  if (s.ghiaccio?.livello >= 1) {
    const t =
      s.ghiaccio.esito === 'crosta'
        ? `crosta dura: ${un(s.neve?.cm, 0, ' cm')} di neve e ${s.ghiaccio.cicli} ${s.ghiaccio.cicli === 1 ? 'ciclo' : 'cicli'} gelo-disgelo in 48 h`
        : `${ESITO_GHIACCIO[s.ghiaccio.esito]}: ${un(s.ghiaccio.acquaMm, 1, ' mm')} di acqua sul terreno in 48 h, minima del ${s.ghiaccio.fonteT} ${un(s.ghiaccio.tMinC, 1, ' °C')}`;
    parti.push(t);
  }
  if (s.neve?.livello >= 1) {
    const fonte =
      Number.isFinite(s.neve.cmModello) && s.neve.cmModello >= s.neve.cmBilancio
        ? 'manto previsto dal modello'
        : 'bilancio nevicate meno fusione';
    parti.push(`neve al suolo ${un(s.neve.cm, 0, ' cm')} (${fonte})`);
    if (s.neve.cadutaCm72 > 0) {
      parti.push(`nevicata in 72 h ${un(s.neve.cadutaCm72, 0, ' cm')}`);
    }
  }
  if (s.fango?.livello >= 1) {
    parti.push(
      `bilancio idrico ${un(s.fango.mmNetti, 1, ' mm')} netti in 72 h (pioggia pesata ${un(s.fango.mmPioggia, 1)}, evaporata ${un(s.fango.mmEt0, 1)})`
    );
  }
  if (s.fango?.rovescio) {
    parti.push(`rovescio da ${un(s.fango.rovescioMmOra, 1, ' mm/h')} nelle ultime 24 h: sentiero inciso`);
  }
  if (!parti.length) {
    // Con un bilancio non nullo ma sotto soglia la frase «nessun segnale»
    // si contraddice col numero che la segue: due testi distinti
    const mm = s.fango?.mmNetti ?? 0;
    parti.push(
      mm >= 1
        ? `terreno appena umido: ${un(mm, 1, ' mm')} netti in 72 h, sotto la soglia del fango`
        : 'nessun segnale di pioggia, neve o gelo recenti nei dati del modello'
    );
  }
  if (s.versante?.nome && Number.isFinite(s.versante.pendenzaPct) && s.versante.pendenzaPct >= 10) {
    parti.push(
      `versante ${s.versante.nome} (pendenza ${un(s.versante.pendenzaPct, 0, '%')}, fusione ×${un(s.versante.fattoreFusione, 2)})`
    );
  }
  if (s.neve?.valanga) {
    parti.push('neve fresca oltre 30 cm su pendio ripido: consulta il bollettino valanghe ufficiale');
  }
  if (s.neve?.quotaStabile) {
    parti.push('sopra 2.500 m la stima di neve residua perde significato: qui la neve non è un evento recente');
  }
  if (s.dati === 'parziali') {
    parti.push(`finestra coperta al ${Math.round((s.coperturaPct ?? 0) * 100)}%`);
  }
  return parti.join(' · ');
}

// Etichetta breve per la cella di tabella
export function etichettaFondo(s) {
  const c = FONDO_CLASSI[s?.classe] || FONDO_CLASSI.ignoto;
  return { ...c, classe: s?.classe ?? 'ignoto', livello: s?.livello ?? 0 };
}

// ── Aggregazione sul percorso ───────────────────────────────────────────

// Riga di sintesi sopra la tabella: classe peggiore, quota da cui inizia
// il problema, conteggio dei tratti coinvolti.
// stati: array allineato ai campioni (elementi null ammessi);
// campioni: [{eleM, dCumKm}]
export function sintesiFondo(stati, campioni) {
  if (!Array.isArray(stati) || !stati.length) return null;
  let peggiore = null;
  let idxPeggiore = -1;
  let ignoti = 0;
  let quotaMin = null; // quota più bassa in cui il problema peggiore compare
  const conteggio = {};
  for (let i = 0; i < stati.length; i++) {
    const s = stati[i];
    if (!s) {
      ignoti++;
      continue;
    }
    if (s.classe === 'ignoto') ignoti++;
    conteggio[s.classe] = (conteggio[s.classe] || 0) + 1;
    if (!peggiore || s.livello > peggiore.livello) {
      peggiore = s;
      idxPeggiore = i;
    }
  }
  if (!peggiore) return { classe: 'ignoto', livello: 0, ignoti, testo: 'stato del fondo non valutabile su nessun tratto' };

  // Quota di inizio del problema: la più bassa fra i tratti che
  // condividono la classe peggiore (l'utente vuole sapere «da che quota»)
  for (let i = 0; i < stati.length; i++) {
    const s = stati[i];
    if (!s || s.classe !== peggiore.classe) continue;
    const q = campioni?.[i]?.eleM;
    if (Number.isFinite(q) && (quotaMin === null || q < quotaMin)) quotaMin = q;
  }
  const trattiClasse = conteggio[peggiore.classe] || 0;
  return {
    classe: peggiore.classe,
    livello: peggiore.livello,
    scoreRischio: peggiore.scoreRischio,
    idxPeggiore,
    trattiClasse,
    totale: stati.length,
    quotaInizioM: quotaMin,
    ignoti,
    conteggio,
    valanga: stati.some((s) => s?.neve?.valanga),
    testoPeggiore: peggiore.testo,
  };
}
