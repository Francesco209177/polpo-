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
  "polpo.info", "polpo.diag", "polpo.sd_backup", "polpo.wifi_scan", "polpo.ble_scan", "polpo.firmware",
  "radio.bands", "radio.rx", "radio.raw", "radio.analysis", "radio.archive", "radio.tx", "radio.editor", "radio.report",
  "nfc.detect", "nfc.read", "nfc.analysis", "nfc.ndef", "nfc.archive", "nfc.write",
  "ble.scan", "ble.gatt", "ble.rw", "ble.connect", "ble.authorized",
  "ir.library", "ir.send", "ir.learn", "ir.import", "ir.profiles",
  "gpio.grove", "gpio.calc", "gpio.console", "gpio.boards", "gpio.bridge",
  "ib.read", "ib.analysis", "ib.archive",
  "apps.catalog", "apps.builtin",
  "rfid125.read", "rfid125.formats", "rfid125.archive",
  "usb.devices", "usb.serial", "usb.hid", "usb.tester", "usb.ducky", "usb.ducky_copy",
  "files.browse", "files.io", "files.integrity",
  "script.files", "script.check", "script.run", "script.debug",
]);
const SOLO_PC = new Set(["apps.third_party"]);

/**
 * L'hardware del telefono, che il programma per PC non conosce. Nel telefono il ruolo del PC lo fanno questi:
 * il suo NFC, il suo Bluetooth, il suo emettitore infrarossi (pochi modelli) e il cavo USB OTG.
 */
export const HARDWARE_TELEFONO = Object.freeze([
  { id: "telefono.nfc", nome: "NFC del telefono", come: "Attiva l'NFC nelle impostazioni di Android (di solito in «Dispositivi connessi»).", gruppo: "telefono" },
  { id: "telefono.ble", nome: "Bluetooth del telefono", come: "Attiva il Bluetooth; la prima volta Android chiede il permesso di cercare dispositivi vicini.", gruppo: "telefono" },
  { id: "telefono.ir", nome: "Emettitore infrarossi del telefono", come: "Solo alcuni telefoni lo hanno (per esempio molti Xiaomi). Senza, usa il Polpo.", gruppo: "telefono" },
  { id: "telefono.usb", nome: "Cavo USB OTG", come: "Un cavo o un adattatore OTG per collegare dispositivi USB al telefono.", gruppo: "telefono" },
  { id: "otg.seriale", nome: "Porta seriale USB (via OTG)", come: "Una scheda o un adattatore USB-seriale (CH340, CP210x, FTDI, CDC) collegato al telefono con il cavo OTG.", gruppo: "telefono" },
]);

/**
 * Nel telefono alcune funzioni passano da strade diverse da quelle del PC: queste sostituiscono le strade del catalogo
 * (l'hardware «pc.*» nel telefono non c'è).
 */
const STRADE_TELEFONO = {
  "nfc.detect": [["polpo", "polpo.rfid2"], ["telefono.nfc"]],
  "nfc.read": [["polpo", "polpo.rfid2"], ["telefono.nfc"]],
  "nfc.write": [["polpo", "polpo.rfid2"], ["telefono.nfc"]],
  "ble.scan": [["telefono.ble"], ["polpo", "polpo.ble"]],
  "ble.gatt": [["telefono.ble"]],
  "ble.rw": [["telefono.ble"]],
  "ble.connect": [["telefono.ble"]],
  "ir.send": [["polpo", "polpo.ir_tx"], ["telefono.ir"]],
  "usb.devices": [["telefono.usb"]],
  "usb.serial": [["otg.seriale"]],
  "usb.hid": [["telefono.usb"]],
  "gpio.console": [["otg.seriale"]],
  "gpio.boards": [["telefono.usb"]],
  "gpio.flash": [{ hardware: ["otg.seriale"], sperimentale: true }],
  // basta il Polpo collegato con il cavo (anche senza Polpo Link): l'aggiornamento cerca un dispositivo Espressif
  "polpo.firmware": [{ hardware: ["otg.seriale"], sperimentale: true }],
  "rfid125.read": [["rfid125.usb", "telefono.usb"], ["rfid125.rdm6300", "otg.seriale"]],
};

/** Le strade di una funzione nel telefono. */
export function strade(f) {
  const t = STRADE_TELEFONO[f.id];
  if (!t) return f.strade;
  return t.map((x) => (Array.isArray(x) ? { hardware: x, sperimentale: false, nota: null } : { nota: null, ...x }));
}

/** Lo stato del telefono come lo dice l'app (PolpoNativo.telefono()); fuori dall'app non c'è nulla. */
export function statoTelefono(nativo = globalThis.PolpoNativo) {
  const vuoto = { nfc: "assente", bluetooth: "assente", ir: false, usbHost: false };
  if (!nativo || !nativo.telefono) return vuoto;
  try { return { ...vuoto, ...JSON.parse(nativo.telefono()) }; } catch { return vuoto; }
}
const MOTIVO_SOLO_PC = "Solo nel programma per PC: le app di terze parti sono programmi Python.";
const MOTIVO_PROSSIMA = "Non ancora nell'app per Android: è in Polpo Studio per PC e arriverà in una prossima versione dell'app.";

/**
 * Presenza dell'hardware. `polpo`: null se non collegato, altrimenti {simulato, moduli} con i moduli come li riporta
 * `info` (available, missing, unverifiable, simulated). `dichiarati`: {id: true} per ciò che hai dichiarato.
 */
export function presenze({ polpo = null, dichiarati = {}, catalogo, telefono = null, serialeUsb = false, bridge = null }) {
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
  // il telefono
  const tel = telefono || { nfc: "assente", bluetooth: "assente", ir: false, usbHost: false };
  const radio = (v, nome) => (v === "pronto" ? { presenza: PRESENZA.RILEVATO, dettaglio: `${nome} acceso` }
    : v === "spento" ? { presenza: PRESENZA.ASSENTE, dettaglio: `${nome} spento: attivalo nelle impostazioni di Android` }
      : { presenza: PRESENZA.ASSENTE, dettaglio: `questo telefono non ha ${nome}` });
  st["telefono.nfc"] = radio(tel.nfc, "l'NFC");
  st["telefono.ble"] = radio(tel.bluetooth, "il Bluetooth");
  st["telefono.ir"] = tel.ir ? { presenza: PRESENZA.RILEVATO, dettaglio: "emettitore presente" } : { presenza: PRESENZA.ASSENTE, dettaglio: "questo telefono non ha l'emettitore infrarossi" };
  st["telefono.usb"] = tel.usbHost ? { presenza: PRESENZA.RILEVATO, dettaglio: "il telefono può usare dispositivi USB" } : { presenza: PRESENZA.ASSENTE, dettaglio: "questo telefono non supporta l'USB OTG" };
  st["otg.seriale"] = serialeUsb ? { presenza: PRESENZA.RILEVATO, dettaglio: "porta seriale collegata" } : { presenza: PRESENZA.ASSENTE, dettaglio: "nessuna porta seriale USB collegata" };
  // il Polpo Bridge: una scheda collegata con il cavo OTG e lo sketch Polpo Bridge
  if (bridge) st.bridge = { presenza: PRESENZA.RILEVATO, dettaglio: `Polpo Bridge su ${bridge}` };
  else st.bridge = { presenza: PRESENZA.ASSENTE, dettaglio: "Polpo Bridge non collegato" };
  if (st.bridge.presenza === PRESENZA.ASSENTE) st["bridge.onewire"] = { presenza: PRESENZA.ASSENTE, dettaglio: "serve il Polpo Bridge" };
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
  const lista = strade(f);
  if (!lista.length) {
    return { stato: f.sperimentale ? STATO.SPERIMENTALE : STATO.DISPONIBILE, motivo: "Funziona nel telefono, non serve hardware.", usabile: true, mancanti: [] };
  }
  let migliore = null;
  for (const s of lista) {
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
  return Object.fromEntries([...catalogo.hardware.map((h) => [h.id, h.nome]), ...HARDWARE_TELEFONO.map((h) => [h.id, h.nome])]);
}
