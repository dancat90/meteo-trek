# Meteo Trek

PWA statica (vanilla JS, zero build, zero backend) che mostra il meteo
previsto **tratto per tratto** lungo un percorso di trekking, **all'orario
in cui ci passerai**: temperatura, percepita (mai più mite del
windchill), umidità, vento e raffiche (con correzione orografica),
intensità solare a 5 livelli (nulla &lt; 10 W/m² &lt; scarsa &lt; 150 &lt; media
&lt; 400 &lt; forte &lt; 700 &lt; molto forte, valore già filtrato dalle nubi
previste, «(velato)» quando resta forte sotto un velo quasi totale —
W/m² e UV nel dettaglio), visibilità prevista (fonte GFS, con classi
scarsa/ridotta/discreta/buona/ottima e avviso sotto 1 km), nuvolosità
con piano dominante (basse/medie/alte) e quota della base delle nubi
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
   di controllo ogni 15 minuti (esportabile in PDF e in CSV per Excel).
4. In alternativa «Trova la finestra migliore (24-72 h)»: heatmap
   giorno × ora delle partenze candidate (fascia 04-14 locale), cella
   colorata sul rischio massimo lungo il percorso, badge tramonto,
   click sulla cella → dettaglio e previsione completa su quell'orario.
   Il pianificatore usa il solo modello primario dell'area (celle grigie
   oltre il suo orizzonte) e resta indicativo: la previsione completa è
   il riferimento.
5. Facoltativo, per chi ha l'orologio con altimetro barometrico: incolla
   le coordinate decimali del parcheggio all'attacco del sentiero (o
   prendile dal GPS del telefono se sei già lì) e premi «Quota e
   pressione»: quota del parcheggio dal modello del terreno, pressione
   prevista alla partenza in millibar (QNH e alla quota) e deriva attesa
   dello strumento fino all'arrivo. Il parcheggio resta agganciato al
   percorso nei recenti e finisce nel riepilogo, nel PDF, nel CSV e sulla
   mappa.

L'ultima previsione resta consultabile offline (bottone «Ultimo
risultato»): utile sul sentiero senza campo.

## Rischio temporali e UV

Il canale temporale combina CAPE, lifted index (ponte GFS: i primari
regionali non lo espongono), potenziale di fulminazione LPI (solo
ICON-2I/D2) e CIN come inibitore (magnitudine ≥100 J/kg declassa di 1
lo score indiretto, mai sotto 1 con CAPE sopra soglia: il sollevamento
orografico rompe il tappo). L'evidenza indiretta non supera mai lo
score 2: il weather_code temporalesco resta l'unico 3 diretto. Un
avviso aggregato conta i tratti pomeridiani (12-18) con canale ≥2.

L'indice UV (ponte GFS) è corretto per quota (+10%/1000 m sul delta
sentiero−cella) e neve prevista (+25%, i nevai preesistenti non sono
rilevabili) e classificato sulla scala OMS a 5 fasce: badge nella
colonna sole da «alto» in su, trasparenza completa nel dettaglio.
Il canale caldo usa l'UV corretto.

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

- **La percepita mostrata non è mai più mite del windchill**: quando il
  windchill esiste (T ≤ 10 °C, vento ≥ 4,8 km/h) la colonna mostra
  min(indice termico, windchill Environment Canada). Fusione prudente,
  coerente con la filosofia del rischio (massimo dei canali); nel
  dettaglio è dichiarato quale indice governa il numero.
- **Indice termico = UTCI** (polinomio ufficiale Bröde a0.002 su
  temperatura media radiante alla Di Napoli, la catena di ECMWF/ERA5):
  integra vento, umidità e sole. Se al modello mancano gli ingressi
  radiativi, ripiego dichiarato sulla `apparent_temperature` di
  Open-Meteo. Validazione: `node tools/valida_utci.mjs` (720 casi
  contro pythermalcomfort, scarto zero nel dominio del modello).
- **Nota sui regimi**: nel freddo ventoso l'UTCI è quasi sempre più
  severo del windchill, quindi la fusione di rado cambia il numero
  UTCI. Il windchill governa soprattutto nel ripiego Steadman e nelle
  giornate serene con vento debole, dove per prudenza il sole non alza
  la percepita sopra il windchill. Oltre 61 km/h il polinomio UTCI
  satura il vento ma resta più severo; il windchill nel dettaglio
  continua a scendere col vento ed è il riferimento del congelamento.
- **Windchill** nella riga di dettaglio nei casi invernali, con la
  classe di rischio congelamento della pelle esposta e avviso
  aggregato (ancorati al windchill, non alla percepita). Calcolato col
  vento efficace (vedi correzione orografica).
- **Temperatura e percepita in fascia multi-modello**: mediana di 4
  modelli con forbice min-max colorata per accordo (verde ≤2 °C, ambra
  ≤4 °C, rosso oltre); i valori per modello sono nella riga di
  dettaglio. La fusione col windchill si applica con lo stesso metro a
  ogni modello, col vento del rispettivo modello.

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

## Taratura dell'altimetro al parcheggio

Chi cammina con un altimetro barometrico lo tara prima di partire. Dalle
coordinate del parcheggio l'app calcola (pressioni in millibar, 1 mbar =
1 hPa):

- la **quota del parcheggio** dal modello del terreno Copernicus GLO-90
  (Elevation API di Open-Meteo, la stessa fonte delle quote mancanti dei
  GPX), sul punto esatto e non dalla cache per cella;
- la **pressione prevista all'ora di partenza** al livello del mare
  (QNH, `pressure_msl`) e alla quota del parcheggio (QFE,
  `surface_pressure` chiesta al modello con `elevation` = quota DEM: il
  modello la riporta a quella quota, verificato il 22/08/2026 — a Campo
  Imperatore 2133 m → 793,4 mbar con QNH 1018,7), più la temperatura;
- la **deriva attesa dell'altimetro** fra partenza e arrivo: la pressione
  alla quota del parcheggio cambia durante la gita (fronte in arrivo, ma
  anche il semplice riscaldamento diurno della colonna d'aria, ~3 mbar
  fra notte e mezzogiorno a 2000 m) e lo strumento la legge come
  dislivello, Δh ≈ −(R·T/g)·(ΔP/P): 8 m per mbar al mare, 10-11 m per
  mbar a 2000 m. Segno positivo = all'arrivo segna più del vero. Sotto
  15 m è trascurabile (accuratezza dello strumento), oltre 30 m (più di
  una curva di livello delle carte 1:25.000) l'app consiglia di
  ricalibrare su una quota nota lungo il percorso. Modello: lo stesso
  della traccia (ICON-2I sull'Appennino), ripiego dichiarato sul best
  match.

**Tara sulla quota, usa la QNH solo come controllo.** La QNH prevista ha
un errore di ±1-2 mbar (≈ ±10-20 m) e l'orologio converte pressione in
quota con l'atmosfera standard (15 °C al mare, −6,5 °C/km): tarato sulla
QNH sbaglia del 3,5 % del dislivello ogni 10 °C di scarto dalla standard
(a Campo Imperatore in estate ~75 m). Per lo stesso motivo, una volta
tarato sulla quota, l'orologio mostra come «pressione al mare» un valore
diverso dalla QNH reale (a 2133 m con 11,5 °C: ~1028 mbar contro 1018,7):
l'app lo dichiara riga per riga, **non correggere la quota per far
tornare la QNH**. Il controllo onesto è la pressione assoluta letta dal
barometro, che deve stare entro 1-2 mbar dalla QFE prevista.

Il GPS del telefono serve solo a riempire le coordinate quando si è già
sul posto («Usa la mia posizione»): la sua quota NON va usata
(ellissoidica WGS84, in Italia ~45-50 m sopra il livello del mare).

Limiti dichiarati: il DEM a 90 m su un pendio può scostarsi di ±10 m
dalla quota del piazzale (se un cartello riporta la quota, vale il
cartello); la deriva è stimata alla quota del parcheggio con la
temperatura prevista, in vetta può differire; la pressione locale può
scostarsi di 1-2 mbar dal modello a ~2 km. Ogni dato mancante è
dichiarato, mai sostituito da un numero.

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

## Vento efficace (correzione orografica)

Il vento di cella del modello (~2-11 km) non sa se il sentiero è
sottovento a un crinale o su una cresta esposta. Per ogni campione
l'app sonda il modello del terreno (Copernicus GLO-90) in 8 direzioni
di bussola a 300/600/1200 m e ne ricava un fattore per direzione del
vento incidente:

- barriera sopravento che domina il punto → **riparo** (fino a ×0,6);
- terreno che scende da entrambi i lati → **cresta** (fino a ×1,3);
- terreno che scende solo sopravento → **pendio esposto** (moderato).

Il fattore, interpolato sulla direzione oraria del vento, produce il
**vento efficace**: lo usano percepita, windchill e canale di rischio
raffiche. Regola di trasparenza: **le colonne vento/raffiche mostrano
i numeri del modello** (confrontabili coi bollettini), con marcatore
▾/▴ quando la correzione supera il 10%; il vento efficace e il fattore
sono nella riga di dettaglio. L'affidabilità resta sui valori grezzi
(misura l'accordo fra modelli, non va scalata). Le quote DEM sono in
cache locale: ricalcolare lo stesso percorso non riscarica nulla.

**Euristica geometrica, non fluidodinamica**: range volutamente
asimmetrico e prudente (riduzione max −40%, perché sottovento restano
raffiche turbolente; amplificazione max +30%, anche se su crinale le
misure danno di più). Limite dichiarato: nel ripiego Steadman la
percepita usa la `apparent_temperature` del modello (vento grezzo);
windchill e rischio usano comunque l'efficace.

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
- La correzione orografica del vento è un'euristica sul DEM a 90 m:
  non vede canalizzazioni, brezze di valle e favonio. Se il modello
  del terreno non risponde, il vento resta quello di cella (avviso
  esplicito).

## Sviluppo

- Test della logica pura: `node tools/test_logica.mjs`
- Validazione UTCI contro pythermalcomfort: `node tools/valida_utci.mjs`
- Smoke test di rete: `node tools/smoke_meteo.mjs`
- Smoke dell'altimetro al parcheggio (DEM + pressione ICON-2I alla quota):
  `node tools/smoke_parcheggio.mjs`
- Icone: `python tools/genera_icone.py`
- Deploy: GitHub Pages dal branch `main`. **A ogni deploy bumpare la
  costante `CACHE` in `sw.js`.**
