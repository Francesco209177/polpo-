// Stato di ogni funzione, dal vivo: la copia JavaScript di studio/polpo_studio/core/capability.py e hardware.py.
// Le parole sono sempre scritte, mai solo un colore: Disponibile, Richiede hardware esterno, Simulato, Sperimentale,
// Non disponibile.

export const STATO = Object.freeze({
  DISPONIBILE: "disponibile",
  HARDWARE: "richiede_hardware",
  SIMULATO: "simulato",
  SPERIMENTALE: "sperimentale",
  NON_DISPONIBILE: "non_disponibile",
});

export const ETICHETTA = Object.freeze({
  disponibile: "Disponibile",
  richiede_hardware: "Richiede hardware esterno",
  simulato: "Simulato",
  sperimentale: "Sperimentale",
  non_disponibile: "Non disponibile",
});

/** Classe del distintivo del sito per ogni stato. */
export const CLASSE = Object.freeze({
  disponibile: "ok", richiede_hardware: "need", simulato: "sim", sperimentale: "exp", non_disponibile: "off",
});

export const PRESENZA = Object.freeze({
  RILEVATO: "rilevato", DICHIARATO: "dichiarato", SIMULATO: "simulato", NON_VERIFICABILE: "non_verificabile", ASSENTE: "assente",
});

const MODULI_POLPO = ["ir_tx", "ir_unit", "rf433", "rfid2", "wifi", "ble", "usb_hid"];

/**
 * Le funzioni che l'app per Android ha già. Le altre restano nell'elenco, segnate «Non disponibile» con il motivo:
 * niente viene finto.
 */
export const NELL_APP = new Set([
  "polpo.info", "polpo.diag", "polpo.sd_backup", "polpo.wifi_scan", "polpo.ble_scan",
  "radio.bands", "radio.rx", "radio.raw", "radio.analysis", "radio.archive", "radio.tx",
  "nfc.detect", "nfc.read", "nfc.analysis", "nfc.ndef", "nfc.archive", "nfc.write",
  "ir.library", "ir.send", "ir.learn",
  "gpio.grove",
  "files.browse", "files.io", "files.integrity",
  "script.files", "script.check", "script.run", "script.debug",
]);
const SOLO_PC = new Set(["apps.third_party"]);
const MOTIVO_SOLO_PC = "Solo nel programma per PC: le app di terze parti sono programmi Python.";
const MOTIVO_PROSSIMA = "Non ancora nell'app per Android: è in Polpo Studio per PC e arriverà in una prossima versione dell'app.";

/**
 * Presenza dell'hardware. `polpo`: null se non collegato, altrimenti {simulato, moduli} con i moduli come li riporta
 * `info` (available, missing, unverifiable, simulated). `dichiarati`: {id: true} per ciò che hai dichiarato.
 */
export function presenze({ polpo = null, dichiarati = {}, catalogo }) {
  const st = {};
  const dichiarabile = (id) => (dichiarati[id]
    ? { presenza: PRESENZA.DICHIARATO, dettaglio: "dichiarato da te in Impostazioni" }
    : { presenza: PRESENZA.NON_VERIFICABILE, dettaglio: "non rilevabile automaticamente" });
  for (const h of catalogo.hardware) {
    if (h.gruppo === "esterno") st[h.id] = dichiarabile(h.id);
    if (h.gruppo === "pc") st[h.id] = { presenza: PRESENZA.ASSENTE, dettaglio: "non c'è nel telefono" };
  }
  if (!polpo) {
    st.polpo = { presenza: PRESENZA.ASSENTE, dettaglio: "Polpo non collegato" };
    for (const m of MODULI_POLPO) st["polpo." + m] = { presenza: PRESENZA.ASSENTE, dettaglio: "Polpo non collegato" };
  } else {
    st.polpo = polpo.simulato
      ? { presenza: PRESENZA.SIMULATO, dettaglio: "Polpo virtuale" }
      : { presenza: PRESENZA.RILEVATO, dettaglio: "collegato via USB" };
    for (const m of MODULI_POLPO) {
      const v = (polpo.moduli || {})[m] ?? "missing";
      const id = "polpo." + m;
      // il Polpo virtuale è il firmware vero: ciò che «c'è» o «potrebbe esserci» nel suo mondo è comunque simulato
      if (polpo.simulato && (v === "available" || v === "unverifiable" || v === "simulated")) st[id] = { presenza: PRESENZA.SIMULATO, dettaglio: "simulato" };
      else if (v === "available") st[id] = { presenza: PRESENZA.RILEVATO, dettaglio: "rilevato dal Polpo" };
      else if (v === "simulated") st[id] = { presenza: PRESENZA.SIMULATO, dettaglio: "simulato" };
      else if (v === "unverifiable") st[id] = dichiarabile(id);
      else st[id] = { presenza: PRESENZA.ASSENTE, dettaglio: "non trovato dal Polpo" };
    }
  }
  if ((st.bridge?.presenza ?? PRESENZA.ASSENTE) === PRESENZA.ASSENTE || st.bridge?.presenza === PRESENZA.NON_VERIFICABILE) {
    st["bridge.onewire"] = { presenza: PRESENZA.ASSENTE, dettaglio: "serve il Polpo Bridge" };
  }
  return st;
}

const nomi = (ids, n) => ids.map((i) => n[i] ?? i).join(", ");

function valutaStrada(f, strada, hw, n) {
  const assenti = [], nonVerificabili = [], simulati = [], dichiarati = [];
  for (const h of strada.hardware) {
    const p = (hw[h] ?? { presenza: PRESENZA.ASSENTE }).presenza;
    if (p === PRESENZA.ASSENTE) assenti.push(h);
    else if (p === PRESENZA.NON_VERIFICABILE) nonVerificabili.push(h);
    else if (p === PRESENZA.SIMULATO) simulati.push(h);
    else if (p === PRESENZA.DICHIARATO) dichiarati.push(h);
  }
  if (assenti.length) {
    const serve = [...assenti, ...nonVerificabili];
    return { stato: STATO.HARDWARE, motivo: `Serve: ${nomi(serve, n)}`, usabile: false, strada, mancanti: serve };
  }
  if (nonVerificabili.length) {
    return {
      stato: STATO.HARDWARE,
      motivo: `Non rilevabile automaticamente: ${nomi(nonVerificabili, n)}. Se è collegato, dichiaralo in Impostazioni › Hardware.`,
      usabile: true, strada, mancanti: nonVerificabili,
    };
  }
  if (simulati.length) return { stato: STATO.SIMULATO, motivo: "Con il Polpo virtuale: dati inventati.", usabile: true, strada, mancanti: [] };
  const stato = f.sperimentale || strada.sperimentale ? STATO.SPERIMENTALE : STATO.DISPONIBILE;
  let motivo = `Pronto con: ${nomi(strada.hardware, n)}`;
  if (dichiarati.length) motivo += ` (dichiarato da te: ${nomi(dichiarati, n)})`;
  if (strada.nota) motivo += " — " + strada.nota;
  return { stato, motivo, usabile: true, strada, mancanti: [] };
}

function rango(v) {
  if (v.stato === STATO.DISPONIBILE) return [0, 0];
  if (v.stato === STATO.SPERIMENTALE) return [0, 1];
  if (v.stato === STATO.SIMULATO) return [1, 0];
  return [v.usabile ? 2 : 3, v.mancanti.length];
}

/** Lo stato di una funzione del catalogo, con il motivo da mostrare. */
export function valuta(f, hw, n = {}) {
  if (f.esclusa) return { stato: STATO.NON_DISPONIBILE, motivo: f.esclusa, usabile: false, mancanti: [] };
  if (SOLO_PC.has(f.id)) return { stato: STATO.NON_DISPONIBILE, motivo: MOTIVO_SOLO_PC, usabile: false, mancanti: [] };
  if (!NELL_APP.has(f.id)) return { stato: STATO.NON_DISPONIBILE, motivo: MOTIVO_PROSSIMA, usabile: false, mancanti: [] };
  if (!f.strade.length) {
    return { stato: f.sperimentale ? STATO.SPERIMENTALE : STATO.DISPONIBILE, motivo: "Funziona nel telefono, non serve hardware.", usabile: true, mancanti: [] };
  }
  let migliore = null;
  for (const s of f.strade) {
    const v = valutaStrada(f, s, hw, n);
    const [a, b] = rango(v);
    if (!migliore || a < migliore.r[0] || (a === migliore.r[0] && b < migliore.r[1])) migliore = { v, r: [a, b] };
  }
  return migliore.v;
}

/** Cerca una funzione per id nel catalogo. */
export function funzione(catalogo, id) {
  for (const m of catalogo.moduli) for (const f of m.funzioni) if (f.id === id) return f;
  return null;
}

/** id → nome dell'hardware, per i messaggi. */
export function nomiHardware(catalogo) {
  return Object.fromEntries(catalogo.hardware.map((h) => [h.id, h.nome]));
}
