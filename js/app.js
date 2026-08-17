// ─────────────────────────────────────────────────────────────────────────
// Orchestratore: ingestione percorso → ETA → selezione modelli → chiamate
// meteo in parallelo → assemblaggio → render. Regole ereditate da
// meteo-rotta: nessuna degradazione silenziosa (ogni ripiego produce un
// avviso), pulizia dei pannelli al cambio percorso (mai numeri vecchi
// sotto etichette nuove), epoca di caricamento per scartare le risposte
// di un percorso abbandonato.
// ─────────────────────────────────────────────────────────────────────────

import { VARIABILI_PRIMARIO, VARIABILI_SECONDARIO, VARIABILI_CONFRONTO, PASSI, SOGLIA_DELTA_QUOTA_M, MODELLI } from './config.js';
import * as storage from './storage.js';
import { dataLocaleAUtc, formattaOra, formattaDataOra, oraApiUtc } from './tempo.js';
import { campionaTraccia, bboxPunti } from './geo.js';
import { percorsoDaGpx, percorsoDaKomoot, costruisciPercorso, campioniPerQuota, applicaQuote } from './percorso.js';
import { calcolaEta, orarioAllaDistanza, tempoAllaDistanza } from './eta.js';
import { scegliModelli, quindiciMinDisponibile, motivoNiente15Min } from './api/modelli.js';
import { meteoModello, meteoConfronto, fusoOrario, quoteDem, quoteCelle } from './api/meteo.js';
import { fascia, classeDispersione } from './dispersione.js';
import { ensemblePrecipitazione } from './api/ensemble.js';
import { estraiUserId, estraiTourId, elencaTourPianificati, coordinateTour, dettagliTour } from './api/komoot.js';
import { scaricaGpxOa, estraiIdOa } from './api/outdooractive.js';
import { percepita, FONTE_PERCEPITA } from './percepita.js';
import { scoreCanali, fusione, canaliAttivi } from './rischio.js';
import { affidabilita, etichettaAffidabilita } from './affidabilita.js';
import { initMappa, disegnaTraccia, evidenziaCampione, pulisciTraccia, escapeHtml } from './ui/mappa.js';
import { renderProfilo, evidenziaProfilo } from './ui/profilo.js';
import { renderTabella, evidenziaRiga, descriviWmo } from './ui/tabella.js';
import { initImpostazioni } from './ui/impostazioni.js';

const $ = (id) => document.getElementById(id);

let percorsoCorrente = null;
let epocaCorrente = 0;

// ── Messaggi ────────────────────────────────────────────────────────────

function mostraMessaggio(tipo, testo) {
  const div = document.createElement('div');
  div.className = `messaggio ${tipo}`;
  div.textContent = testo;
  $('messaggi').appendChild(div);
}
function pulisciMessaggi() {
  $('messaggi').innerHTML = '';
}

// Pulizia dei pannelli risultato: mai numeri vecchi sotto etichette nuove
// (anche mappa e traccia, non solo i pannelli di testo)
function pulisciRisultato() {
  $('riepilogo').hidden = true;
  $('profilo').hidden = true;
  $('tabella').hidden = true;
  $('sezione-risultato').hidden = true;
  pulisciTraccia();
}

// Spinner a contatore: più operazioni sovrapposte (carico un GPX mentre
// una previsione è in corso) non si spengono lo spinner a vicenda
let operazioniAttive = 0;
function caricamento(attivo) {
  operazioniAttive = Math.max(0, operazioniAttive + (attivo ? 1 : -1));
  $('caricamento').hidden = operazioniAttive === 0;
  $('bottone-prevedi').disabled = operazioniAttive > 0 || !percorsoCorrente;
}

// Contatore delle richieste di ingestione: su caricamenti sovrapposti
// vince l'ULTIMO click dell'utente, non l'ultima risposta arrivata
let richiestaIngest = 0;

// ── Ingestione percorso ─────────────────────────────────────────────────

function impostaPercorso(percorso, vocaCronologia = null) {
  percorsoCorrente = percorso;
  epocaCorrente++;
  pulisciRisultato();
  const box = $('percorso-caricato');
  box.innerHTML = `
    <div class="titolo-percorso">
      <span class="nome">${escapeHtml(percorso.nome || 'Percorso senza nome')}</span>
      <span class="fonte">${escapeHtml(percorso.fonte)}</span>
    </div>
    <div class="dati-percorso">
      <span class="dato">${percorso.totKm.toFixed(1)} km<small>distanza</small></span>
      <span class="dato">+${percorso.dPlusM} m<small>dislivello</small></span>
      <span class="dato">−${percorso.dMinusM} m<small>discesa</small></span>
      <span class="dato">${percorso.punti.length}<small>punti</small></span>
    </div>`;
  box.hidden = false;
  $('bottone-prevedi').disabled = operazioniAttive > 0;
  if (vocaCronologia) {
    storage.cronologiaAggiungi(vocaCronologia);
    renderCronologia();
  }
}

// Traccia ridotta per mappa, profilo e storage offline (≤ 500 punti)
function tracciaRidotta(percorso, maxPunti = 500) {
  const passo = Math.max(1, Math.ceil(percorso.punti.length / maxPunti));
  const punti = [];
  for (let i = 0; i < percorso.punti.length; i += passo) {
    const p = percorso.punti[i];
    punti.push({ lat: p.lat, lon: p.lon, d: p.dCumKm, e: p.eleM });
  }
  const ultimo = percorso.punti[percorso.punti.length - 1];
  if (punti[punti.length - 1].d !== ultimo.dCumKm) {
    punti.push({ lat: ultimo.lat, lon: ultimo.lon, d: ultimo.dCumKm, e: ultimo.eleM });
  }
  return punti;
}

async function caricaKomoot() {
  pulisciMessaggi();
  const input = $('campo-komoot').value.trim();
  if (!input) return mostraMessaggio('info', 'Inserisci il link del profilo o di un tour Komoot.');
  const mia = ++richiestaIngest;
  caricamento(true);
  try {
    const tourId = estraiTourId(input);
    if (tourId) {
      await caricaTourKomoot(tourId, mia);
      return;
    }
    const userId = estraiUserId(input);
    if (!userId) throw new Error('Link non riconosciuto: serve un profilo o un tour Komoot');
    const tours = await elencaTourPianificati(userId);
    if (mia !== richiestaIngest) return; // l'utente ha già chiesto altro
    const lista = $('lista-tour');
    if (!tours.length) {
      lista.hidden = true;
      mostraMessaggio(
        'avviso',
        'Nessun tour pianificato pubblico su questo profilo. Rendi pubblico il tour su Komoot o usa il file GPX.'
      );
      return;
    }
    lista.innerHTML = '';
    for (const t of tours) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span>${escapeHtml(t.nome)}</span><small>${t.km ?? '–'} km · +${t.dPlusM ?? '–'} m</small>`;
      b.addEventListener('click', () => {
        lista.hidden = true;
        const miaClick = ++richiestaIngest;
        caricamento(true);
        caricaTourKomoot(t.id, miaClick)
          .catch((e) =>
            mostraMessaggio(
              'errore',
              `Komoot non risponde come previsto: ${e.message}. In alternativa carica il GPX.`
            )
          )
          .finally(() => caricamento(false));
      });
      lista.appendChild(b);
    }
    lista.hidden = false;
  } catch (e) {
    mostraMessaggio('errore', `Komoot non risponde come previsto: ${e.message}. In alternativa carica il GPX.`);
  } finally {
    caricamento(false);
  }
}

async function caricaTourKomoot(tourId, mia = null) {
  const [dettagli, items] = await Promise.all([
    dettagliTour(tourId).catch(() => ({ id: tourId, nome: `Tour ${tourId}` })),
    coordinateTour(tourId),
  ]);
  if (mia !== null && mia !== richiestaIngest) return; // richiesta superata
  const percorso = percorsoDaKomoot(items, { nome: dettagli.nome });
  impostaPercorso(percorso, {
    id: `komoot:${tourId}`,
    fonte: 'komoot',
    nome: percorso.nome,
    km: percorso.totKm,
    payload: { tourId },
  });
}

async function caricaOa(urlForzato = null) {
  pulisciMessaggi();
  const url = urlForzato || $('campo-oa').value.trim();
  if (!url) return mostraMessaggio('info', 'Incolla il link del percorso Outdooractive.');
  const mia = ++richiestaIngest;
  caricamento(true);
  try {
    const testo = await scaricaGpxOa(url);
    if (mia !== richiestaIngest) return; // richiesta superata
    const percorso = percorsoDaGpx(testo, { fonte: 'outdooractive' });
    impostaPercorso(percorso, {
      id: `oa:${estraiIdOa(url)}`,
      fonte: 'outdooractive',
      nome: percorso.nome,
      km: percorso.totKm,
      payload: { url },
    });
  } catch (e) {
    mostraMessaggio('errore', e.message);
  } finally {
    caricamento(false);
  }
}

function caricaGpx(file) {
  pulisciMessaggi();
  if (!file) return;
  const mia = ++richiestaIngest;
  const lettore = new FileReader();
  lettore.onload = () => {
    if (mia !== richiestaIngest) return; // richiesta superata
    try {
      const percorso = percorsoDaGpx(String(lettore.result), {
        nomeFallback: file.name.replace(/\.gpx$/i, ''),
      });
      impostaPercorso(percorso, {
        id: `gpx:${file.name}:${percorso.totKm}`,
        fonte: 'gpx',
        nome: percorso.nome,
        km: percorso.totKm,
        // Il file non è ri-scaricabile: in cronologia va la traccia ridotta
        payload: { punti: tracciaRidotta(percorso).map((p) => ({ lat: p.lat, lon: p.lon, eleM: p.e })) },
      });
    } catch (e) {
      mostraMessaggio('errore', e.message);
    }
  };
  lettore.onerror = () => mostraMessaggio('errore', 'Lettura del file fallita');
  lettore.readAsText(file);
}

function renderCronologia() {
  const box = $('cronologia');
  const voci = storage.cronologiaLeggi();
  if (!voci.length) {
    box.hidden = true;
    return;
  }
  box.innerHTML = '';
  for (const v of voci) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${escapeHtml(v.nome || 'percorso')} <small>${v.km ?? ''} km · ${escapeHtml(v.fonte)}</small>`;
    b.addEventListener('click', async () => {
      pulisciMessaggi();
      const mia = ++richiestaIngest;
      caricamento(true);
      try {
        if (v.fonte === 'komoot') await caricaTourKomoot(v.payload.tourId, mia);
        else if (v.fonte === 'outdooractive') await caricaOa(v.payload.url);
        else {
          const percorso = costruisciPercorso({ nome: v.nome, fonte: 'gpx', punti: v.payload.punti });
          if (mia === richiestaIngest) impostaPercorso(percorso);
        }
      } catch (e) {
        mostraMessaggio('errore', e.message);
      } finally {
        caricamento(false);
      }
    });
    box.appendChild(b);
  }
  box.hidden = false;
}

// ── Previsione ──────────────────────────────────────────────────────────

async function prevedi() {
  if (!percorsoCorrente) return;
  pulisciMessaggi();
  pulisciRisultato();
  const epoca = ++epocaCorrente;
  caricamento(true);
  try {
    const risultato = await calcolaPrevisione(percorsoCorrente);
    if (epoca !== epocaCorrente) return; // percorso cambiato nel frattempo
    render(risultato);
    storage.ultimoRisultatoScrivi(risultato);
    $('bottone-ultimo').hidden = false;
  } catch (e) {
    if (epoca !== epocaCorrente) return;
    mostraMessaggio('errore', e.messaggioUtente || e.message || 'Errore imprevisto');
  } finally {
    caricamento(false);
  }
}

async function calcolaPrevisione(percorsoIn) {
  const imp = storage.impostazioni();
  const avvisi = [];
  let percorso = percorsoIn;

  // 1. Quote mancanti: ricostruzione dal DEM (Copernicus 90 m)
  if (percorso.serveElevation) {
    const campQ = campioniPerQuota(percorso);
    const quote = await quoteDem(campQ);
    percorso = applicaQuote(
      percorso,
      campQ.map((c, i) => ({ idx: c.idx, eleM: quote[i] }))
    );
    if (percorso.serveElevation) {
      avvisi.push('Quote non ricostruibili: tempi stimati come se fosse in piano');
    } else {
      avvisi.push('Quote GPX assenti: ricostruite dal modello del terreno (90 m)');
    }
  }

  // 2. Fuso orario del punto di partenza
  let tz = await fusoOrario(percorso.punti[0]);
  if (!tz) {
    tz = 'Europe/Rome';
    avvisi.push('Fuso del punto di partenza non determinato: uso Europe/Rome');
  }

  // 3. Partenza e ETA
  const dataIso = $('campo-data').value;
  const oraStr = $('campo-ora').value || '08:00';
  if (!dataIso) throw new Error('Scegli la data della gita');
  const partenzaUtc = dataLocaleAUtc(dataIso, oraStr, tz);
  if (partenzaUtc.getTime() < Date.now() - 2 * 3600000) {
    throw new Error('La partenza è nel passato: controlla data e ora');
  }
  const mhSalita = Number($('campo-passo').value) || imp.mhSalita;
  const pausaMinOra = Math.max(0, Number($('campo-pause').value) || 0);
  const sostaMin = Math.max(0, Number($('campo-sosta').value) || 0);
  const sostaDopoOre = Math.max(0, Number($('campo-sosta-dopo').value) || 0);
  const eta = calcolaEta(percorso, {
    mhSalita,
    pausaMinOra,
    sosta: sostaMin > 0 ? { dopoOre: sostaDopoOre, durataMin: sostaMin } : null,
  });
  avvisi.push(...eta.avvisi);

  // 4. Campioni meteo e orari di passaggio
  const campioni = campionaTraccia(percorso.punti, percorso.cum);
  const orari = campioni.map((c) =>
    orarioAllaDistanza(partenzaUtc, percorso.cum, eta.tCumMin, c.dCumKm)
  );
  const arrivo = orari[orari.length - 1];

  // Limite duro del calendario Open-Meteo: il giorno oggi+15 UTC è
  // l'ULTIMO utilizzabile (oltre: HTTP 400) → limite a fine giornata
  const limiteApiMs =
    Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00Z') + 16 * 86400000 - 1;
  if (arrivo.getTime() > limiteApiMs) {
    throw new Error('Gita oltre i 15 giorni: nessun modello arriva così lontano');
  }

  // 5. Selezione modelli
  const bbox = bboxPunti(campioni);
  const leadOreMax = Math.max(1, (arrivo.getTime() - Date.now()) / 3600000);
  const scelta = scegliModelli(bbox, leadOreMax);
  avvisi.push(...scelta.avvisi);
  if (!scelta.primario) throw new Error('Nessun modello disponibile per quest’area');
  const quindici = quindiciMinDisponibile(bbox, leadOreMax);

  let startHour = oraApiUtc(new Date(orari[0].getTime() - 3600000));
  let endHour = oraApiUtc(new Date(arrivo.getTime() + 3600000), 'su');
  if (Date.parse(endHour.slice(0, 10) + 'T00:00Z') > limiteApiMs) {
    endHour = `${new Date(limiteApiMs).toISOString().slice(0, 10)}T23:00`;
  }
  const finestra = { startHour, endHour };

  // 6. Chiamate in parallelo: una per modello + ensemble
  const chiamata = (modello, variabili) =>
    meteoModello({
      campioni,
      orari,
      modello,
      variabili,
      ...finestra,
      quindici: quindici && modello.id === 'icon_d2',
    });

  const [primEsito, secEsito, ensEsito, celleEsito, confEsito] = await Promise.allSettled([
    chiamata(scelta.primario, VARIABILI_PRIMARIO),
    scelta.secondario
      ? chiamata(scelta.secondario, VARIABILI_SECONDARIO)
      : Promise.resolve(null),
    ensemblePrecipitazione({ campioni, orari, ...finestra }),
    // Quota VERA delle celle: la risposta con elevation esplicito fa solo
    // eco del valore inviato, serve la chiamata dedicata
    quoteCelle(campioni, scelta.primario),
    // Modelli globali di confronto (fascia di temperatura): una sola HTTP
    scelta.confronto?.length
      ? meteoConfronto({
          campioni,
          orari,
          modelli: scelta.confronto,
          variabili: VARIABILI_CONFRONTO,
          ...finestra,
        })
      : Promise.resolve(null),
  ]);

  // 7. Degradazioni esplicite, mai silenziose
  let modelloUsato = scelta.primario;
  let prim = primEsito.status === 'fulfilled' ? primEsito.value : null;
  if (!prim || prim.copertura < 0.5) {
    if (!scelta.secondario) {
      throw Object.assign(new Error('primario non disponibile'), {
        messaggioUtente: `${scelta.primario.nome} non copre il percorso e non c’è un modello di riserva: riprova più tardi.`,
      });
    }
    avvisi.push(
      `${scelta.primario.nome} non copre il percorso: passo a ${scelta.secondario.nome}`
    );
    modelloUsato = scelta.secondario;
    prim = await chiamata(scelta.secondario, VARIABILI_PRIMARIO);
    if (!prim || prim.copertura < 0.5) {
      throw Object.assign(new Error('nessun modello copre il percorso'), {
        messaggioUtente: 'Nessun modello meteo copre il percorso in questo momento.',
      });
    }
  }
  const sec =
    modelloUsato.id === scelta.primario.id &&
    secEsito.status === 'fulfilled' &&
    secEsito.value &&
    secEsito.value.copertura >= 0.5
      ? secEsito.value
      : null;
  if (scelta.secondario && !sec) {
    avvisi.push('Secondo modello non disponibile: affidabilità senza confronto fra modelli');
  }
  const ens = ensEsito.status === 'fulfilled' ? ensEsito.value : null;
  if (!ens) avvisi.push('Ensemble non disponibile: niente forbice di probabilità');

  // Modelli di confronto: tengo solo quelli con copertura decente e
  // diversi dal modello effettivamente usato (dopo un eventuale ripiego
  // il secondario è diventato primario)
  const conf =
    confEsito.status === 'fulfilled' && Array.isArray(confEsito.value)
      ? confEsito.value.filter((r) => r.copertura >= 0.5 && r.modello.id !== modelloUsato.id)
      : [];
  if (scelta.confronto?.length && !conf.length) {
    avvisi.push('Modelli di confronto non disponibili: fascia di temperatura ridotta');
  }

  // Quote celle: valide solo se il modello usato è rimasto il primario
  const quotaCelleArr =
    modelloUsato.id === scelta.primario.id && celleEsito.status === 'fulfilled'
      ? celleEsito.value
      : null;

  // Il dettaglio a 15 minuti arriva SOLO dalla chiamata ICON-D2,
  // qualunque ruolo abbia (primario o secondario)
  const d2Res =
    modelloUsato.id === 'icon_d2'
      ? prim
      : scelta.secondario?.id === 'icon_d2' &&
          secEsito.status === 'fulfilled' &&
          secEsito.value
        ? secEsito.value
        : null;
  const motivo15 = motivoNiente15Min(bbox, leadOreMax);
  if (motivo15 === 'area') {
    avvisi.push('Dettaglio a 15 minuti non nativo in quest’area (resta il dato orario)');
  } else if (motivo15 === 'orizzonte') {
    avvisi.push('Dettaglio a 15 minuti oltre le 48 ore del suo modello (resta il dato orario)');
  } else if (!d2Res) {
    avvisi.push('Dettaglio a 15 minuti non disponibile (chiamata ICON-D2 fallita)');
  }

  // 8. Assemblaggio per campione
  const arricchiti = [];
  let trattiQuotaLontana = 0;
  let forbiceAmpia = false;
  for (let i = 0; i < campioni.length; i++) {
    const c = campioni[i];
    const p = prim.perCampione[i];
    const valori = p?.valori || {};
    const percepitaC = percepita(valori);
    const ensI = ens?.perCampione?.[i] || null;
    // ICON-2I in Appennino non ha probabilità di precipitazione: per il
    // canale pioggia vale la PoP k/N dell'ensemble
    const valoriRischio =
      !Number.isFinite(valori.precipitation_probability) && Number.isFinite(ensI?.popKN)
        ? { ...valori, precipitation_probability: ensI.popKN }
        : valori;
    const canali = p ? scoreCanali(valoriRischio, percepitaC) : {};
    const score = p ? fusione(canali) : 0;

    const vSec = sec?.perCampione?.[i]?.valori;

    // Fascia multi-modello di T e percepita: modello usato + secondario +
    // modelli di confronto, tutti già alla quota del sentiero
    const perModello = [];
    if (p) {
      perModello.push({ nome: modelloUsato.nome, t: valori.temperature_2m, perc: percepitaC });
    }
    if (vSec) {
      perModello.push({
        nome: scelta.secondario.nome,
        t: vSec.temperature_2m,
        perc: vSec.apparent_temperature,
      });
    }
    for (const r of conf) {
      const vc = r.perCampione?.[i]?.valori;
      if (vc) perModello.push({ nome: r.modello.nome, t: vc.temperature_2m, perc: vc.apparent_temperature });
    }
    const tFasciaBase = fascia(perModello.map((m) => m.t));
    const tFascia = tFasciaBase
      ? { ...tFasciaBase, accordo: classeDispersione(tFasciaBase.spread) }
      : null;
    const percFasciaBase = fascia(perModello.map((m) => m.perc));
    const percFascia = percFasciaBase
      ? { ...percFasciaBase, accordo: classeDispersione(percFasciaBase.spread) }
      : null;

    // La divergenza fra modelli alimenta l'affidabilità: con la fascia
    // disponibile vale lo spread min-max, altrimenti il vecchio confronto
    // a coppia primario-secondario
    const diffTempC = tFascia
      ? tFascia.spread
      : vSec && Number.isFinite(valori.temperature_2m) && Number.isFinite(vSec.temperature_2m)
        ? Math.abs(valori.temperature_2m - vSec.temperature_2m)
        : null;
    const diffRaffKmh =
      vSec && Number.isFinite(valori.wind_gusts_10m) && Number.isFinite(vSec.wind_gusts_10m)
        ? Math.abs(valori.wind_gusts_10m - vSec.wind_gusts_10m)
        : null;
    const aff = affidabilita({
      sigmaTempC: ensI?.sigmaTemp,
      diffTempC,
      diffRaffKmh,
      leadGiorni: (orari[i].getTime() - Date.now()) / 86400000,
    });

    const quotaCella = quotaCelleArr?.[i] ?? null;
    if (
      p &&
      Number.isFinite(quotaCella) &&
      Number.isFinite(c.eleM) &&
      Math.abs(quotaCella - c.eleM) > SOGLIA_DELTA_QUOTA_M
    ) {
      trattiQuotaLontana++;
    }
    if (
      ensI &&
      Number.isFinite(valori.precipitation_probability) &&
      Math.abs(valori.precipitation_probability - ensI.popKN) > 30
    ) {
      forbiceAmpia = true;
    }

    const oraLocale = formattaOra(orari[i], tz);
    const popup = [
      `<strong>${escapeHtml(oraLocale)}</strong> · km ${c.dCumKm.toFixed(1)} · ${Math.round(c.eleM ?? 0)} m`,
      Number.isFinite(valori.temperature_2m)
        ? `T ${Math.round(valori.temperature_2m)}° (percepita ${Math.round(percepitaC ?? valori.temperature_2m)}°)`
        : null,
      Number.isFinite(valori.wind_gusts_10m)
        ? `raffiche ${Math.round(valori.wind_gusts_10m)} km/h`
        : null,
      Number.isFinite(valori.precipitation) && valori.precipitation > 0
        ? `pioggia ${valori.precipitation.toFixed(1)} mm`
        : null,
      descriviWmo(valori.weather_code),
    ]
      .filter(Boolean)
      .join('<br>');

    arricchiti.push({
      lat: c.lat,
      lon: c.lon,
      eleM: c.eleM,
      dCumKm: c.dCumKm,
      orarioIso: orari[i].toISOString(),
      oraLocale,
      valori,
      percepitaC,
      tFascia,
      percFascia,
      tPerModello: perModello,
      canali,
      canaliAttivi: p ? canaliAttivi(canali) : [],
      score,
      ens: ensI,
      aff: { ...aff, etichetta: etichettaAffidabilita(aff.pct) },
      quotaCella,
      precip15Max: p?.precip15Max ?? d2Res?.perCampione?.[i]?.precip15Max ?? null,
      fontePercepita: FONTE_PERCEPITA,
      senzaDati: !p,
    });
  }
  if (trattiQuotaLontana) {
    avvisi.push(
      `Su ${trattiQuotaLontana} tratti la cella del modello dista oltre ${SOGLIA_DELTA_QUOTA_M} m di quota dal sentiero`
    );
  }
  if (forbiceAmpia) {
    avvisi.push('Probabilità di pioggia molto diversa fra i modelli: guarda la forbice, non il numero secco');
  }
  const senzaDati = arricchiti.filter((a) => a.senzaDati).length;
  if (senzaDati) {
    avvisi.push(`${senzaDati} campioni senza dati (fuori dominio del modello)`);
  }

  // 9. Tacche orarie per il profilo (posizione prevista a ogni ora piena)
  const tacche = [];
  for (let h = 1; h * 60 < eta.durataTotaleMin; h++) {
    const tMin = h * 60;
    // Ricerca della distanza in cui il tempo cumulato raggiunge tMin
    let lo = 0;
    let hi = percorso.totKm;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (tempoAllaDistanza(percorso.cum, eta.tCumMin, mid) < tMin) lo = mid;
      else hi = mid;
    }
    tacche.push({
      d: lo,
      label: formattaOra(new Date(partenzaUtc.getTime() + tMin * 60000), tz),
    });
  }

  return {
    nome: percorso.nome,
    fonte: percorso.fonte,
    totKm: percorso.totKm,
    dPlusM: percorso.dPlusM,
    dMinusM: percorso.dMinusM,
    tz,
    partenzaIso: partenzaUtc.toISOString(),
    arrivoIso: arrivo.toISOString(),
    durataTotaleMin: Math.round(eta.durataTotaleMin),
    durataMovimentoMin: Math.round(eta.durataMovimentoMin),
    mhSalita,
    modello: { id: modelloUsato.id, nome: modelloUsato.nome, risoluzioneKm: modelloUsato.risoluzioneKm },
    secondarioNome: sec ? scelta.secondario.nome : null,
    ensembleNome: ens?.modello || null,
    avvisi,
    campioni: arricchiti,
    traccia: tracciaRidotta(percorso),
    tacche,
    unitaVento: imp.unitaVento,
    generatoIl: Date.now(),
  };
}

// ── Render ──────────────────────────────────────────────────────────────

function selezionaCampione(i) {
  evidenziaRiga(i);
  evidenziaProfilo(i);
  evidenziaCampione(i);
}

function render(r) {
  // Unhide PRIMA di disegnare: Leaflet con container [hidden] non disegna
  $('sezione-risultato').hidden = false;

  const durataOre = Math.floor(r.durataTotaleMin / 60);
  const durataMin = r.durataTotaleMin % 60;
  const partenza = new Date(r.partenzaIso);
  const arrivo = new Date(r.arrivoIso);
  $('riepilogo').innerHTML = `
    <div class="titolo-percorso">
      <span class="nome">${escapeHtml(r.nome || 'Percorso')}</span>
      <span class="fonte">${escapeHtml(r.fonte)}</span>
    </div>
    <div class="dati-percorso">
      <span class="dato">${r.totKm.toFixed(1)} km<small>+${r.dPlusM} / −${r.dMinusM} m</small></span>
      <span class="dato">${formattaDataOra(partenza, r.tz)}<small>partenza</small></span>
      <span class="dato">${formattaOra(arrivo, r.tz)}<small>arrivo previsto</small></span>
      <span class="dato">${durataOre} h ${String(durataMin).padStart(2, '0')}<small>durata con pause</small></span>
    </div>
    ${r.avvisi.length ? `<div class="avvisi">${r.avvisi.map((a) => `<div>⚠ ${escapeHtml(a)}</div>`).join('')}</div>` : ''}
    <div class="meta-riepilogo">
      Modello ${escapeHtml(r.modello.nome)} (~${r.modello.risoluzioneKm} km)
      ${r.secondarioNome ? ` · confronto con ${escapeHtml(r.secondarioNome)}` : ''}
      ${r.ensembleNome ? ` · probabilità da ensemble ${escapeHtml(r.ensembleNome)}` : ''}
      · orari locali ${escapeHtml(r.tz)} · passo ${r.mhSalita} m/h
      · previsione generata alle ${formattaOra(new Date(r.generatoIl), r.tz)}
    </div>`;
  $('riepilogo').hidden = false;

  disegnaTraccia({ traccia: r.traccia, campioni: r.campioni.map((c) => ({ ...c, popupHtml: popupCampione(c) })) }, selezionaCampione);
  renderProfilo(
    $('profilo'),
    {
      profilo: r.traccia.map((p) => ({ d: p.d, e: p.e })),
      campioni: r.campioni,
      tacche: r.tacche,
    },
    selezionaCampione
  );
  renderTabella($('tabella'), { campioni: r.campioni, unitaVento: r.unitaVento }, selezionaCampione);
}

function popupCampione(c) {
  const v = c.valori || {};
  return [
    `<strong>${escapeHtml(c.oraLocale)}</strong> · km ${c.dCumKm.toFixed(1)} · ${Math.round(c.eleM ?? 0)} m`,
    Number.isFinite(v.temperature_2m)
      ? `T ${Math.round(v.temperature_2m)}° (percepita ${Math.round(c.percepitaC ?? v.temperature_2m)}°)`
      : 'dati non disponibili',
    Number.isFinite(v.wind_gusts_10m) ? `raffiche ${Math.round(v.wind_gusts_10m)} km/h` : null,
    Number.isFinite(v.precipitation) && v.precipitation > 0
      ? `pioggia ${v.precipitation.toFixed(1)} mm`
      : null,
    descriviWmo(v.weather_code),
  ]
    .filter(Boolean)
    .join('<br>');
}

function mostraUltimo() {
  const r = storage.ultimoRisultatoLeggi();
  if (!r) return;
  pulisciMessaggi();
  mostraMessaggio(
    'info',
    `Previsione salvata ${formattaDataOra(new Date(r.generatoIl), r.tz)} — offline la mappa resta senza sfondo`
  );
  render(r);
}

// ── Avvio ───────────────────────────────────────────────────────────────

function init() {
  const imp = storage.impostazioni();

  // Data default: domani nel giorno LOCALE (con toISOString, tra
  // mezzanotte e le 2 il fuso italiano proporrebbe oggi)
  const domani = new Date(Date.now() + 86400000);
  const p2 = (x) => String(x).padStart(2, '0');
  $('campo-data').value = `${domani.getFullYear()}-${p2(domani.getMonth() + 1)}-${p2(domani.getDate())}`;
  $('campo-pause').value = String(imp.pausaMinOra);

  // Select del passo dai valori di config
  $('campo-passo').innerHTML = PASSI.map(
    (p) => `<option value="${p.mOra}"${p.mOra === imp.mhSalita ? ' selected' : ''}>${p.etichetta}</option>`
  ).join('');

  // Schede sorgente
  const pannelli = { komoot: $('pannello-komoot'), oa: $('pannello-oa'), gpx: $('pannello-gpx') };
  document.querySelectorAll('input[name="sorgente"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      for (const [nome, pan] of Object.entries(pannelli)) pan.hidden = nome !== radio.value;
    });
  });

  $('bottone-komoot').addEventListener('click', caricaKomoot);
  $('bottone-oa').addEventListener('click', () => caricaOa());
  $('campo-gpx').addEventListener('change', (e) => {
    caricaGpx(e.target.files?.[0]);
    // Reset: senza, riselezionare lo STESSO file non genera l'evento
    e.target.value = '';
  });

  // Invio nei campi link deve caricare il percorso, non lanciare Prevedi
  // sul percorso precedente (implicit submission del form)
  for (const [campo, azione] of [
    [$('campo-komoot'), caricaKomoot],
    [$('campo-oa'), () => caricaOa()],
  ]) {
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        azione();
      }
    });
  }

  $('form-percorso').addEventListener('submit', (e) => {
    e.preventDefault();
    prevedi();
  });
  $('bottone-ultimo').addEventListener('click', mostraUltimo);
  $('bottone-ultimo').hidden = !storage.ultimoRisultatoLeggi();

  initImpostazioni({
    bottoneApri: $('bottone-impostazioni'),
    dialogo: $('dialogo-impostazioni'),
    onCronologiaSvuotata: renderCronologia,
  });
  renderCronologia();
  initMappa('mappa');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
