# Meteo Trek

PWA statica (vanilla JS, zero build, zero backend) che mostra il meteo
previsto **tratto per tratto** lungo un percorso di trekking, **all'orario
in cui ci passerai**: temperatura, percepita, umidità, vento e raffiche,
intensità solare a 5 livelli (nulla &lt; 10 W/m² &lt; scarsa &lt; 150 &lt; media
&lt; 400 &lt; forte &lt; 700 &lt; molto forte, valore già filtrato dalle nubi
previste — W/m² e UV nel dettaglio), nuvolosità con quota della base delle nubi
(dal modello dove disponibile — MeteoSwiss sulle Alpi — altrimenti
stima dal livello di condensazione, marcata con «~»; «in nube» quando
la base è sotto il sentiero), probabilità e quantità di precipitazione,
più un livello di rischio per tratto.

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
   altimetrico con gli orari di passaggio, tabella di marcia con punti
   di controllo ogni 15 minuti (esportabile in PDF).

L'ultima previsione resta consultabile offline (bottone «Ultimo
risultato»): utile sul sentiero senza campo.

## Come stima i tempi

Nomogramma ufficiale Schweizer Wanderwege 1996 (lo stesso dietro i
cartelli svizzeri e wandern.ch): per ogni segmento si combinano in
norma-q il tempo orizzontale (4,2 km/h, con la spinta delle discese
dolci) e quello verticale (400 m/h in salita, 800 m/h in discesa).
Sulle pendenze dolci i tempi sono più corti della vecchia regola
additiva dei cartelli CAI (5 km +300 m ≈ 1 h 20, non 1 h 56); sul
ripido i due metodi coincidono. Il totale è calibrato sul passo
personale. Assunzione dichiarata: il fattore personale scala l'intero
itinerario, non solo le salite. Pause brevi spalmate + eventuale sosta
pranzo.

## Percepita, windchill, fascia multi-modello

- **Percepita = UTCI** (polinomio ufficiale Bröde a0.002 su temperatura
  media radiante alla Di Napoli, la catena di ECMWF/ERA5): integra
  vento, umidità e sole. Se al modello mancano gli ingressi radiativi,
  ripiego dichiarato sulla `apparent_temperature` di Open-Meteo.
  Validazione: `node tools/valida_utci.mjs` (720 casi contro
  pythermalcomfort, scarto zero nel dominio del modello).
- **Windchill** (formula Environment Canada) nella riga di dettaglio nei
  casi invernali (T ≤ 10 °C, vento ≥ 4,8 km/h), con la classe di rischio
  congelamento della pelle esposta e avviso aggregato.
- **Temperatura e percepita in fascia multi-modello**: mediana di 4
  modelli con forbice min-max colorata per accordo (verde ≤2 °C, ambra
  ≤4 °C, rosso oltre); i valori per modello sono nella riga di dettaglio.

## Tabella di marcia

Punti di controllo ogni 15 minuti di tabella (pause incluse): ora
prevista, tempo e distanza parziali/totali, quota, pendenza media del
tratto, meteo del punto, stima rete. Mappa dedicata con i punti
numerati sulla traccia colorata per rischio: click su una riga →
evidenzia il punto sulla mappa, click su un punto → evidenzia la riga.
Bottone «Esporta PDF» (stampa del browser): il PDF include la mappa
topografica vera, composta dai tile OpenTopoMap (CORS aperto); se i
tile non arrivano, ripiego dichiarato sulla sola traccia. Calcolo del
tramonto sul punto di arrivo: se l'arrivo previsto è a meno di 1 ora
dal tramonto scatta l'avviso.

## Copertura Vodafone (stima)

Colonna «rete» nelle tabelle: stima della copertura Vodafone per tratto,
da una mappa statica derivata da [OpenCelliD](https://opencellid.org/)
(dati celle CC-BY-SA 4.0, ~118k celle note in Italia di cui ~27k
Vodafone). Classi per distanza dalla cella nota più vicina: verde ≤2 km,
ambra ≤6 km (dipende dall'orografia), rosso oltre. Con Vodafone assente
ma un'altra rete vicina, il dettaglio segnala che la chiamata al 112
resta possibile (le emergenze passano su ogni rete). **Indicazione, non
garanzia**: il database è crowdsourced e i rilievi schermano il segnale.
Rigenerazione mappa: scaricare il dump MCC 222 da OpenCelliD e lanciare
`node tools/genera_copertura.mjs <222.csv>`.

## Aree protette e cani

Sotto il riepilogo compare l'elenco delle aree protette attraversate
(parchi, riserve), rilevate da OpenStreetMap via Overpass (con mirror
di riserva). Per ciascuna: regola sull'accesso dei cani — dal tag OSM
se esiste, altrimenti dalla tabella curata dei parchi nazionali
(`dati/parchi-cani.json`, fonti ufficiali degli enti, con data di
verifica) — e collegamento al sito dell'ente. Divieti e limitazioni
finiscono anche fra gli avvisi. **Indicazione, non garanzia**: le
regole cambiano e variano per zona e stagione, fa fede l'ente.

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
- Validazione UTCI contro pythermalcomfort: `node tools/valida_utci.mjs`
- Smoke test di rete: `node tools/smoke_meteo.mjs`
- Icone: `python tools/genera_icone.py`
- Deploy: GitHub Pages dal branch `main`. **A ogni deploy bumpare la
  costante `CACHE` in `sw.js`.**
