// Polpo Studio — dispositivi USB e schede collegate: nomi dei produttori, dei chip USB-seriale e delle classi USB.
// Copia JavaScript delle parti pure di studio/polpo_studio/devices/usb_list.py e serial_ports.py, e dei pannelli che
// trasformano gli elenchi in righe e messaggi (app/tools/usb_tools.py: «Periferiche», «Porte seriali», «HID»;
// app/tools/gpio_tools.py: «Schede collegate» e l'elenco delle porte della console e del Polpo Bridge).
//
// Nel telefono l'elenco arriva da PolpoNativo.usbElenco() (android/PONTE.md):
//   [{id, nome, produttore, vid, pid, classi: [int], seriale, polpo, permesso}]
// e `dispositivoDaTelefono` / `portaDaTelefono` lo portano nella forma usata qui (quella di Polpo Studio per PC).
// Solo elenco: nessun dispositivo viene aperto.

import { formatIntPy, formatValorePy, strPy } from "../strumenti/convertitore.js";

// ---------------- tabelle (usb_list.py, serial_ports.py) ----------------

const tabella = (righe) => Object.freeze(Object.fromEntries(righe));

/** Classi USB (bDeviceClass) → nome. */
export const NOMI_CLASSI = tabella([
  [0x00, "per interfaccia"], [0x01, "Audio"], [0x02, "Comunicazioni (CDC)"], [0x03, "HID (tastiere, mouse…)"],
  [0x05, "Fisica"], [0x06, "Immagini"], [0x07, "Stampante"], [0x08, "Memoria di massa"], [0x09, "Hub"],
  [0x0a, "Dati CDC"], [0x0b, "Smart card"], [0x0e, "Video"], [0x0f, "Salute"], [0x10, "Audio/Video"],
  [0xdc, "Diagnostica"], [0xe0, "Wireless (Bluetooth…)"], [0xef, "Varie"], [0xfe, "Specifica applicazione"], [0xff, "Del produttore"],
]);

/** Codici dei produttori (VID) → nome. */
export const PRODUTTORI = tabella([
  [0x303a, "Espressif"], [0x1a86, "WCH (QinHeng)"], [0x10c4, "Silicon Labs"], [0x0403, "FTDI"], [0x067b, "Prolific"],
  [0x2341, "Arduino"], [0x2a03, "Arduino"], [0x2e8a, "Raspberry Pi"], [0x239a, "Adafruit"], [0x1b4f, "SparkFun"],
  [0x046d, "Logitech"], [0x045e, "Microsoft"], [0x05ac, "Apple"], [0x0bda, "Realtek"], [0x8087, "Intel"],
  [0x8086, "Intel"], [0x072f, "Advanced Card Systems (ACS)"], [0x1d6b, "Linux Foundation"], [0x0781, "SanDisk"],
  [0x0951, "Kingston"], [0x04e8, "Samsung"], [0x18d1, "Google"], [0x0a12, "Cambridge Silicon Radio"], [0x0b05, "ASUS"],
  [0x1050, "Yubico"], [0x04f2, "Chicony"], [0x0c45, "Microdia"], [0x13d3, "IMC Networks"], [0x8564, "Transcend"],
]);

/** Chip USB-seriale [VID, PID]: se compaiono tra le periferiche ma senza porta seriale, manca il driver. */
export const CHIP_SERIALI = Object.freeze([
  [0x1a86, 0x7523], [0x1a86, 0x55d4], [0x1a86, 0x5523], [0x10c4, 0xea60], [0x0403, 0x6001], [0x0403, 0x6010], [0x0403, 0x6014],
  [0x0403, 0x6015], [0x067b, 0x2303],
].map((c) => Object.freeze(c)));

/** Chip riconosciuti [VID, PID (null = qualsiasi), descrizione]. Codici pubblici dei produttori. */
export const CHIP_NOTI = Object.freeze([
  [0x303a, null, "Espressif, USB nativa (ESP32-S2/S3/C3/C6)"],
  [0x1a86, 0x7523, "WCH CH340"],
  [0x1a86, 0x5523, "WCH CH341"],
  [0x1a86, 0x55d4, "WCH CH9102"],
  [0x10c4, 0xea60, "Silicon Labs CP210x"],
  [0x0403, 0x6001, "FTDI FT232R"],
  [0x0403, 0x6010, "FTDI FT2232"],
  [0x0403, 0x6014, "FTDI FT232H"],
  [0x0403, 0x6015, "FTDI FT231X"],
  [0x067b, 0x2303, "Prolific PL2303"],
  [0x2341, null, "Arduino"],
  [0x2a03, null, "Arduino (arduino.org)"],
  [0x2e8a, null, "Raspberry Pi (RP2040/RP2350)"],
  [0x239a, null, "Adafruit"],
  [0x1b4f, null, "SparkFun"],
].map((c) => Object.freeze(c)));

/** Usi HID [pagina, uso, nome]. */
export const USI_HID = Object.freeze([
  [0x01, 0x02, "mouse"], [0x01, 0x06, "tastiera"], [0x01, 0x05, "gamepad"], [0x01, 0x04, "joystick"], [0x0c, 0x01, "tasti multimediali"],
  [0x0d, 0x04, "touchscreen"], [0x0d, 0x05, "touchpad"],
].map((c) => Object.freeze(c)));

/** VID di Espressif: con USB nativa è il Polpo o un'altra scheda ESP32 (solo un indizio: conferma il ping di Polpo Link). */
export const VID_ESPRESSIF = 0x303a;
/** Adattatori USB-seriale e Arduino originali, per i suggerimenti della scheda «Schede collegate». */
export const VID_ADATTATORI = Object.freeze([0x1a86, 0x10c4, 0x0403, 0x067b]);
export const VID_ARDUINO = Object.freeze([0x2341, 0x2a03]);

// Come `tabella.get(k)` di Python con chiavi intere: i booleani valgono 0 e 1, i testi non sono mai chiavi.
function daTabella(t, k) {
  if (typeof k === "boolean" || typeof k === "bigint") k = Number(k);
  return typeof k === "number" && Number.isInteger(k) && Object.hasOwn(t, String(k)) ? t[k] : undefined;
}

// ---------------- dispositivi e porte ----------------

/**
 * Un dispositivo USB, come UsbDevice di usb_list.py: {vid, pid, nome, produttore, numeroSerie, posizione, velocita,
 * classe (bDeviceClass o null), driver}.
 */
export function dispositivo(vid, pid, nome, { produttore = "", numeroSerie = "", posizione = "", velocita = "", classe = null, driver = "" } = {}) {
  return { vid, pid, nome, produttore, numeroSerie, posizione, velocita, classe, driver };
}

/**
 * Una porta seriale, come PortInfo di serial_ports.py: {dispositivo, descrizione, vid, pid, numeroSerie, produttore, chip};
 * `vid` e `pid` sono null se la porta non è USB. Il chip si ricava da VID e PID.
 */
export function porta(dispositivoPorta, { descrizione = "", vid = null, pid = null, numeroSerie = "", produttore = "", id } = {}) {
  const p = { dispositivo: dispositivoPorta, descrizione, vid, pid, numeroSerie, produttore, chip: nomeChip(vid, pid) };
  if (id !== undefined) p.id = id;
  return p;
}

/** "VID:PID" in esadecimale maiuscolo ("303A:1001"). */
export function usbId(vid, pid) {
  return `${formatIntPy(vid, "04X")}:${formatIntPy(pid, "04X")}`;
}

/** "VID:PID" di una porta, "" se non è USB. */
export function usbIdPorta(p) {
  return p.vid !== null && p.vid !== undefined && p.pid !== null && p.pid !== undefined ? usbId(p.vid, p.pid) : "";
}

/** Il produttore di un dispositivo: quello che dichiara, altrimenti quello del VID ("" se sconosciuto). */
export function nomeProduttore(d) {
  return d.produttore || (daTabella(PRODUTTORI, d.vid) ?? "");
}

/** Il nome di una classe USB ("" se sconosciuta o assente). */
export function nomeClasse(classe) {
  return classe === null || classe === undefined ? "" : (daTabella(NOMI_CLASSI, classe) ?? "");
}

/** Il chip USB-seriale riconosciuto da VID e PID ("" se sconosciuto). */
export function nomeChip(vid, pid) {
  if (vid === null || vid === undefined) return "";
  const esatto = CHIP_NOTI.find(([v, p]) => v === vid && p === pid && p !== null);
  if (esatto) return esatto[2];
  const famiglia = CHIP_NOTI.find(([v, p]) => v === vid && p === null);
  return famiglia ? famiglia[2] : "";
}

/** Vero se la porta potrebbe essere il Polpo (VID Espressif). Solo un indizio: lo conferma il ping di Polpo Link. */
export function forsePolpo(p) {
  return p.vid === VID_ESPRESSIF;
}

// Confronto dei testi come Python (per punti di codice, non per unità UTF-16).
function confrontaTesti(a, b) {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** Le porte nell'ordine di Polpo Studio: prima quelle che possono essere il Polpo, poi le USB, poi le altre, per nome. */
export function ordinaPorte(porte) {
  const chiave = (p) => [forsePolpo(p) ? 0 : 1, p.vid === null || p.vid === undefined ? 1 : 0];
  return [...porte].sort((a, b) => {
    const [ka, kb] = [chiave(a), chiave(b)];
    return ka[0] - kb[0] || ka[1] - kb[1] || confrontaTesti(a.dispositivo, b.dispositivo);
  });
}

/** Chip USB-seriale presenti ma senza porta seriale (`idSeriali`: coppie [vid, pid] delle porte): probabilmente manca il driver. */
export function driverMancanti(dispositivi, idSeriali) {
  const ha = (lista, v, p) => lista.some(([a, b]) => a === v && b === p);
  return dispositivi.filter((d) => ha(CHIP_SERIALI, d.vid, d.pid) && !ha(idSeriali, d.vid, d.pid));
}

/** Le coppie [vid, pid] delle porte USB (come `{(p.vid, p.pid) for p in ports if p.vid is not None}`). */
export function idPorte(porte) {
  return porte.filter((p) => p.vid !== null && p.vid !== undefined).map((p) => [p.vid, p.pid]);
}

// ---------------- righe e messaggi delle pagine ----------------

/** Intestazioni delle tabelle. */
export const COLONNE = Object.freeze({
  periferiche: Object.freeze(["Nome", "VID:PID", "Produttore", "Classe", "Velocità", "Driver", "Posizione"]),
  porte: Object.freeze(["Porta", "Descrizione", "VID:PID", "Chip", "Produttore"]),
  hid: Object.freeze(["Prodotto", "VID:PID", "Produttore", "Tipo", "Interfaccia"]),
  schede: Object.freeze(["Porta", "Chip riconosciuto", "VID:PID", "Descrizione", "Note"]),
});

/** Nota della scheda HID. */
export const NOTA_HID = "Solo elenco: Polpo Studio non apre e non invia nulla ai dispositivi HID.";

/** Le righe della tabella «Periferiche». */
export function righeDispositivi(dispositivi) {
  return dispositivi.map((d) => [d.nome, usbId(d.vid, d.pid), nomeProduttore(d), nomeClasseDispositivo(d), d.velocita, d.driver, d.posizione]);
}

/** Il messaggio dopo «Aggiorna» delle periferiche. */
export function messaggioDispositivi(dispositivi) {
  return dispositivi.length ? `${dispositivi.length} periferiche USB.` : "Nessuna periferica elencata (o elenco non disponibile su questo sistema).";
}

/** Le righe della tabella «Porte seriali». */
export function righePorte(porte) {
  return porte.map((p) => [p.dispositivo, p.descrizione, usbIdPorta(p), p.chip, p.produttore]);
}

/** La nota sotto le porte seriali (driver mancanti). */
export function notaDriver(mancanti) {
  if (!mancanti.length) return "Nessun problema di driver rilevato.";
  return "Possibile driver mancante per: " + mancanti.map((d) => `${d.nome} (${usbId(d.vid, d.pid)})`).join(", ") + ". Installa il driver del produttore del chip.";
}

/** Il suggerimento della scheda «Schede collegate» per un VID. */
export function suggerimentoScheda(vid) {
  if (vid === VID_ESPRESSIF) return "ESP32 con USB nativa: il Polpo o un'altra scheda Espressif";
  if (VID_ADATTATORI.includes(vid)) return "adattatore USB-seriale (tipico di ESP32 DevKit, Arduino Nano compatibili)";
  if (VID_ARDUINO.includes(vid)) return "Arduino originale (5 V per Uno/Mega)";
  return "";
}

/** Le righe della tabella «Schede collegate» (modulo GPIO). */
export function righeSchede(porte) {
  return porte.map((p) => [p.dispositivo, p.chip || "—", usbIdPorta(p), p.descrizione, suggerimentoScheda(p.vid)]);
}

/** La voce di una porta negli elenchi a discesa: "COM3 · WCH CH340" (con uno spazio finale se il chip è sconosciuto). */
export function etichettaPorta(p) {
  return `${p.dispositivo} ${p.chip ? "· " + p.chip : ""}`;
}

/**
 * Le voci [etichetta, porta] per la console seriale e il Polpo Bridge: tutte le porte tranne `occupata` (quella del
 * Polpo, usata da Polpo Link). Le porte del telefono si riconoscono dall'`id`, le altre dal nome.
 */
export function vociPorte(porte, occupata = null) {
  const chiave = (p) => p.id ?? p.dispositivo;
  return porte.filter((p) => occupata === null || chiave(p) !== occupata).map((p) => [etichettaPorta(p), chiave(p)]);
}

/** Il tipo di un'interfaccia HID: nome dell'uso, oppure "0xPPPP/0xUUUU". */
export function tipoHid(pagina, uso) {
  const u = USI_HID.find(([p, q]) => p === pagina && q === uso);
  const altrimenti = `0x${formatValorePy(pagina, "04X")}/0x${formatValorePy(uso, "04X")}`; // Python lo calcola comunque
  return u ? u[2] : altrimenti;
}

/** Una riga della tabella HID da un elemento di hid.enumerate() (programma per PC: il telefono non dà questi dati). */
export function rigaHid(d) {
  const v = (k, p) => (Object.hasOwn(d, k) && d[k] !== undefined ? d[k] : p);
  return [
    v("product_string", null) || "—",
    `${formatValorePy(v("vendor_id", 0), "04X")}:${formatValorePy(v("product_id", 0), "04X")}`,
    v("manufacturer_string", null) || "",
    tipoHid(v("usage_page", 0), v("usage", 0)),
    strPy(v("interface_number", "")),
  ];
}

/** Il messaggio dopo l'elenco HID. */
export function messaggioHid(n) {
  return `${n} interfacce HID.`;
}

// ---------------- il telefono (android/PONTE.md) ----------------

/**
 * I nomi delle classi di un dispositivo del telefono (`classi` di usbElenco: classe del dispositivo e delle interfacce),
 * senza ripetizioni; «per interfaccia» (0x00) solo se non c'è altro.
 */
export function nomiClassi(classi) {
  const nomi = [];
  for (const c of classi) {
    const n = nomeClasse(c);
    if (n && !nomi.includes(n)) nomi.push(n);
  }
  const altri = nomi.filter((n) => n !== NOMI_CLASSI[0]);
  return (altri.length ? altri : nomi).join(", ");
}

/** La classe da mostrare: quella del dispositivo (PC) o i nomi delle classi del telefono. */
export function nomeClasseDispositivo(d) {
  return Array.isArray(d.classi) ? nomiClassi(d.classi) : nomeClasse(d.classe);
}

/**
 * Un elemento di usbElenco() come dispositivo di questo modulo. Il nome manca → produttore del VID → "USB" (come
 * l'elenco di Linux di usb_list.py); posizione, velocità, numero di serie e driver il telefono non li dice. Restano
 * anche `id`, `classi`, `seriale` (c'è un driver seriale), `polpo` e `permesso`.
 */
export function dispositivoDaTelefono(x) {
  const d = dispositivo(x.vid, x.pid, x.nome || daTabella(PRODUTTORI, x.vid) || "USB", { produttore: x.produttore || "" });
  return { ...d, id: x.id, classi: Array.isArray(x.classi) ? [...x.classi] : [], seriale: !!x.seriale, polpo: !!x.polpo, permesso: !!x.permesso };
}

/** Un elemento di usbElenco() o serialeElenco() come porta seriale (il nome del dispositivo fa da nome della porta). */
export function portaDaTelefono(x) {
  return porta(x.nome || "USB", { descrizione: x.nome || "", vid: x.vid ?? null, pid: x.pid ?? null, produttore: x.produttore || "", id: x.id });
}

/** I dispositivi e le porte seriali del telefono, già ordinati come in Polpo Studio, con i driver mancanti. */
export function elencoTelefono(elenco) {
  const dispositivi = elenco.map(dispositivoDaTelefono);
  const porte = ordinaPorte(elenco.filter((x) => x.seriale).map(portaDaTelefono));
  return { dispositivi, porte, mancanti: driverMancanti(dispositivi, idPorte(porte)) };
}
