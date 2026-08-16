# Meteo Trek

PWA statica (vanilla JS, zero build, zero backend) che mostra il meteo
previsto **tratto per tratto** lungo un percorso di trekking, **all'orario
in cui ci passerai**: temperatura, percepita, umidità, vento e raffiche,
radiazione solare (W/m²), probabilità e quantità di precipitazione, più
un livello di rischio per tratto.

App: https://dancat90.github.io/meteo-trek/

## Come si usa

1. Carica un percorso in uno dei tre modi:
   - **Komoot**: incolla il link del tuo profilo (o di un tour) — vale
     solo per i tour pianificati **pubblici**;
   - **Outdooractive**: incolla il link di un percorso pubblicato;
   - **File GPX**: da qualunque app (via universale).
2. Imposta data, ora di partenza e il tuo passo (i metri di dislivello
   che sali in un'ora: 400 m/h è il riferimento dei cartelli CAI).
3. Prevedi: tabella per tratto, mappa colorata per rischio, profilo
   altimetrico con gli orari di passaggio.

L'ultima previsione resta consultabile offline (bottone «Ultimo
risultato»): utile sul sentiero senza campo.

## Come stima i tempi

Velocità continua in funzione della pendenza (funzione di Tobler),
riscalata sul totale della scala escursionistica svizzera
(4 km/h + 400 m/h in salita + 800 m/h in discesa, la stessa dei cartelli
CAI) e calibrata sul passo personale. Assunzione dichiarata: il fattore
personale scala l'intero itinerario, non solo le salite. Pause brevi
spalmate + eventuale sosta pranzo.

## Modelli meteo

- Alpi: MeteoSwiss ICON-CH2 (~2 km, 5 giorni) con confronto ICON-D2;
  dettaglio pioggia a 15 minuti dove ICON-D2 è nativo.
- Appennino: ItaliaMeteo/ARPAE ICON-2I (~2 km) **forzato** (il best match
  di Open-Meteo lì ricadrebbe su un modello a 7 km).
- Probabilità di precipitazione: dall'ensemble (ICON seamless o ECMWF),
  mostrata come voce ufficiale + «k membri su N» con soglia anti-drizzle.
- Ogni punto del percorso è previsto alla sua quota reale (downscaling);
  la quota della cella modello è dichiarata quando dista troppo dal
  sentiero.

Dati meteo © [Open-Meteo.com](https://open-meteo.com/) (CC-BY 4.0).

## Note e limiti

- **Stima hobbistica**: non sostituisce i bollettini ufficiali né la
  valutazione in loco.
- La lettura da Komoot usa l'API non documentata v007 (solo tour
  pubblici, in anonimo): se Komoot la cambia, resta il GPX.
- Il download da Outdooractive avviene solo su azione esplicita
  dell'utente, un percorso alla volta; il loro robots.txt vieta l'accesso
  automatico ai crawler e questa app non fa crawling. Se il download
  viene negato, esporta il GPX dal sito (gratis) e caricalo.
- Orizzonte massimo: 15 giorni (limite Open-Meteo), con degradazione
  esplicita del modello oltre il suo orizzonte nativo.

## Sviluppo

- Test della logica pura: `node tools/test_logica.mjs`
- Smoke test di rete: `node tools/smoke_meteo.mjs`
- Icone: `python tools/genera_icone.py`
- Deploy: GitHub Pages dal branch `main`. **A ogni deploy bumpare la
  costante `CACHE` in `sw.js`.**
