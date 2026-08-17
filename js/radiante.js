// ─────────────────────────────────────────────────────────────────────────
// Temperatura media radiante (MRT) secondo Di Napoli et al. (2020), lo
// schema con cui ECMWF calcola l'UTCI da ERA5. Porting fedele dal modulo
// stress termico di meteo-casa (catena validata contro ladybug-comfort e
// pythermalcomfort), ridotto ai soli pezzi che servono qui.
//
// Le componenti a onda lunga non sono esposte da Open-Meteo e vengono
// stimate: Brutsaert (1975) per cielo sereno, corretta per nuvolosità
// alla Crawford & Duchon (1999). ASSUNZIONE dichiarata: la temperatura
// della superficie è posta uguale a quella dell'aria; in pieno sole il
// terreno è più caldo, quindi la MRT è leggermente conservativa. Albedo
// del suolo fisso (terreno naturale): con neve al suolo l'UTCI in pieno
// sole è sottostimato.
// ─────────────────────────────────────────────────────────────────────────

const SIGMA = 5.670374419e-8; // Stefan-Boltzmann [W m-2 K-4]
const ALBEDO = 0.2; // terreno naturale (meteo-casa urbano usa 0.18)
const EMISSIVITA_SUOLO = 0.97;

// Pressione di vapore [hPa] (Magnus, come nella catena di meteo-casa)
function pressioneVapore(tC, rh) {
  return (rh / 100) * 6.105 * Math.exp((17.27 * tC) / (237.7 + tC));
}

// Coseno dell'angolo zenitale solare dalla radiazione extraterrestre su
// piano orizzontale (`terrestrial_radiation` di Open-Meteo): grandezza
// puramente astronomica, evita di reimplementare l'astronomia solare.
export function cosszaDaToa(toa, giornoAnno) {
  if (toa == null || !Number.isFinite(toa) || toa <= 0) return 0;
  const e0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * (giornoAnno || 180)) / 365));
  return Math.min(1, Math.max(0, toa / e0));
}

// Radiazione infrarossa discendente dal cielo [W m-2]
function ondaLungaDiscendente(tC, rh, nuvolePct) {
  if (tC == null || !Number.isFinite(tC)) return null;
  const tK = tC + 273.15;
  const e = pressioneVapore(tC, rh == null ? 50 : rh);
  const epsSereno = 1.24 * Math.pow(Math.max(e, 0.1) / tK, 1 / 7);
  const c = nuvolePct == null ? 0 : Math.min(1, Math.max(0, nuvolePct / 100));
  const eps = Math.min(1, (1 - c) * epsSereno + c);
  return eps * SIGMA * Math.pow(tK, 4);
}

// MRT [°C]. Ingressi: temperatura, umidità relativa, nuvolosità [%],
// radiazione globale (ssrd), diretta orizzontale (fdir), diretta normale
// al raggio (dsrp, opzionale: ricavata se manca), coseno dello zenit.
export function mrtDiNapoli({ tC, rh, nuvole, ssrd, fdir, dsrp, cossza }) {
  if (tC == null || !Number.isFinite(tC)) return null;

  const strd = ondaLungaDiscendente(tC, rh, nuvole);
  if (strd == null) return null;
  const tK = tC + 273.15;
  // Risalita infrarossa dal suolo: emissione propria + quota riflessa
  const lur =
    EMISSIVITA_SUOLO * SIGMA * Math.pow(tK, 4) + (1 - EMISSIVITA_SUOLO) * strd;

  const g = Math.max(0, ssrd || 0);
  const dir = Math.max(0, Math.min(fdir == null ? 0 : fdir, g));
  const dsw = Math.max(0, g - dir); // diffusa discendente
  const rsw = ALBEDO * g; // riflessa dal suolo
  const cz = Math.min(1, Math.max(0, cossza || 0));
  // Diretta normale: se manca la si ricava dalla diretta orizzontale
  let istar = dsrp;
  if (istar == null || !Number.isFinite(istar)) istar = cz > 0.05 ? dir / cz : 0;
  istar = Math.max(0, istar);

  // Fattore di area proiettata del corpo umano in piedi, in funzione
  // dell'elevazione solare: massimo col sole basso, minimo a mezzogiorno
  const gamma = (Math.asin(cz) * 180) / Math.PI;
  const fp = 0.308 * Math.cos((Math.PI / 180) * gamma * (0.998 - (gamma * gamma) / 50000));

  const flux =
    0.5 * strd + 0.5 * lur + (0.7 / 0.97) * (0.5 * dsw + 0.5 * rsw + fp * istar);
  if (!(flux > 0)) return null;
  return Math.pow(flux / SIGMA, 0.25) - 273.15;
}

// Giorno dell'anno (1-366) da una Date UTC, per la correzione della
// distanza Terra-Sole
export function giornoAnnoUtc(d) {
  return Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
      86400000
  );
}
