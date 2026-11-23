// Polpo Studio — Bluetooth LE: nomi dei servizi, valori letti, dispositivi autorizzati, testi del modulo Bluetooth.
// Copia JavaScript delle parti pure di studio/polpo_studio/devices/ble.py e app/tools/bluetooth_tools.py, più la
// tabella dei produttori del firmware (polpo/src/apps/wireless_apps.cpp) e le righe della scansione del Polpo
// (app/tools/polpo_tools.py), che ha la stessa forma della scansione del telefono.
//
// Nel telefono i dati arrivano dagli eventi di PolpoNativo (android/PONTE.md): `ble.risultato {devices: [{name, addr,
// rssi, mfr_id, connectable}]}`, `ble.collegato {addr, servizi: [{uuid, caratteristiche: [{uuid, proprieta}]}]}`,
// `ble.letto` / `ble.notifica {servizio, caratteristica, dati}` (dati in base64). Come in Polpo Studio per PC: scansione
// passiva, ci si collega solo ai dispositivi autorizzati (tuoi), solo letture e notifiche (nessuna scrittura), le
// scansioni non si salvano.

import { daBase64 } from "../link/proto.js";
import { jsonPython } from "../sicurezza/formati.js";
import { chiavePy, codificaUtf8, errorePy, formatValorePy, formattaData, hexPy, nomeTipoPy, prendiPy, strPy, veroPy } from "../strumenti/convertitore.js";
import { ErrorePy, elementiPy } from "./flipper.js";

// ---------------- servizi (ble.py) ----------------

/** Alcuni UUID standard del Bluetooth SIG (primi 8 caratteri, minuscoli), per dare un nome ai servizi più comuni. */
export const SERVIZI_NOTI = Object.freeze({
  "00001800": "Accesso generico",
  "00001801": "Attributi generici",
  "0000180a": "Informazioni dispositivo",
  "0000180f": "Batteria",
  "0000180d": "Frequenza cardiaca",
  "00001809": "Termometro",
  "0000181a": "Sensori ambientali",
  "00001812": "HID su BLE",
  "0000fe59": "Aggiornamento firmware (Nordic)",
});

/** BleUnavailable di ble.py: Bluetooth assente, spento o non permesso. */
export class BleNonDisponibile extends ErrorePy {
  static tipo = "BleUnavailable";
}

/** Il nome di un servizio: quello della tabella, altrimenti la descrizione data (o ""). */
export function nomeServizio(uuid, descrizione = "") {
  const k = Array.from(uuid.toLowerCase()).slice(0, 8).join("");
  return Object.hasOwn(SERVIZI_NOTI, k) ? SERVIZI_NOTI[k] : descrizione || "";
}

/** Un errore del Bluetooth in parole semplici (`testo` è il messaggio, `tipo` il nome dell'errore se il messaggio è vuoto). */
export function spiegaErrore(testo, tipo = "Exception") {
  const t = testo || tipo;
  const basso = t.toLowerCase();
  if (basso.includes("no bluetooth adapters") || (basso.includes("adapter") && basso.includes("not"))) return "nessun adattatore Bluetooth trovato o acceso";
  if (basso.includes("dbus") || basso.includes("bluez") || basso.includes("org.bluez")) return "servizio Bluetooth del sistema (BlueZ) non disponibile";
  if (basso.includes("permission") || basso.includes("not authorized")) return "permesso Bluetooth negato dal sistema";
  return t;
}

const UTF8_RIGIDO = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
// I caratteri non stampabili per Python (str.isprintable): categorie C e Z, tranne lo spazio.
const NON_STAMPABILE = /[\p{C}\p{Z}]/u;

/** Un valore letto: esadecimale maiuscolo e, se è testo UTF-8 tutto stampabile, anche il testo («...»). */
export function formattaValore(dati) {
  const esa = hexPy(dati, " ").toUpperCase();
  let testo;
  try {
    testo = UTF8_RIGIDO.decode(Uint8Array.from(dati));
  } catch {
    return esa;
  }
  if (testo && Array.from(testo).every((c) => c === " " || !NON_STAMPABILE.test(c))) return `${esa}  «${testo}»`;
  return esa;
}

/** I byte di un evento `ble.letto` o `ble.notifica` (base64); dati non validi → Uint8Array vuoto. */
export function datiEvento(ev) {
  return daBase64(String(ev?.dati ?? "")) ?? new Uint8Array(0);
}

// ---------------- produttori (firmware, wireless_apps.cpp) ----------------

/** Codici dei produttori Bluetooth (Company Identifier) che il Polpo sa nominare. */
export const PRODUTTORI_BLE = Object.freeze({
  0x004c: "Apple",
  0x0006: "Microsoft",
  0x0075: "Samsung",
  0x00e0: "Google",
  0x0157: "Huami/Xiaomi",
  0x038f: "Xiaomi",
  0x0087: "Garmin",
  0x02e5: "Espressif",
  0x0059: "Nordic",
  0x000f: "Broadcom",
  0x0171: "Amazon",
});

/** Il nome del produttore Bluetooth, oppure `null` se il Polpo non lo conosce. */
export function nomeProduttoreBle(id) {
  return Number.isInteger(id) && Object.hasOwn(PRODUTTORI_BLE, String(id)) ? PRODUTTORI_BLE[id] : null;
}

/** "Apple (0x004C)" oppure "? (0x1234)", come i dettagli di un dispositivo sullo schermo del Polpo. */
export function descriviProduttore(id) {
  return `${nomeProduttoreBle(id) ?? "?"} (0x${formatValorePy(id, "04X")})`;
}

// ---------------- scansione ----------------

/** I tempi della scansione nel modulo Bluetooth (secondi) e il limite del telefono (PolpoNativo.bleScansiona). */
export const SECONDI_SCANSIONE = Object.freeze({ min: 2, max: 20, predefiniti: 5 });
export const MS_SCANSIONE_TELEFONO_MAX = 10_000;

/** I millisecondi da chiedere al telefono per una scansione di `secondi` (entro i limiti del modulo e del telefono). */
export function msScansioneTelefono(secondi = SECONDI_SCANSIONE.predefiniti) {
  const s = Math.min(SECONDI_SCANSIONE.max, Math.max(SECONDI_SCANSIONE.min, Math.trunc(Number(secondi) || SECONDI_SCANSIONE.predefiniti)));
  return Math.min(s * 1000, MS_SCANSIONE_TELEFONO_MAX);
}

/**
 * Un dispositivo dell'evento `ble.risultato` nella forma della scansione di Polpo Studio per PC:
 * {address, name, rssi, manufacturers: [id], services: [], tx_power: null}.
 */
export function dispositivoDaTelefono(x) {
  const m = x.mfr_id;
  return { address: String(x.addr ?? ""), name: x.name || "", rssi: Number.isFinite(x.rssi) ? x.rssi : null, manufacturers: Number.isInteger(m) ? [m] : [], services: [], tx_power: null };
}

/** I dispositivi dell'evento `ble.risultato`, dal segnale più forte, come la scansione di Polpo Studio per PC. */
export function dispositiviDaTelefono(ev) {
  return ordinaDispositivi((ev?.devices ?? []).map(dispositivoDaTelefono));
}

/** Dal segnale più forte (un segnale sconosciuto vale -127), stesso ordine per i pari. */
export function ordinaDispositivi(dispositivi) {
  return dispositivi.map((d, i) => [-(d.rssi || -127), i, d]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

/** Intestazioni della tabella dei dispositivi e dell'albero dei servizi. */
export const COLONNE = Object.freeze({
  dispositivi: Object.freeze(["Nome", "Indirizzo", "Segnale", "Produttori", "Autorizzato"]),
  servizi: Object.freeze(["Servizio / caratteristica", "Proprietà"]),
  scansionePolpo: Object.freeze(["Nome", "Indirizzo", "Segnale", "Produttore", "Connettibile"]),
});

/** Una riga della tabella dei dispositivi vicini. */
export function rigaDispositivo(d, autorizzato) {
  return [
    veroPy(d.name) ? d.name : "—",
    d.address,
    d.rssi !== null && d.rssi !== undefined ? `${strPy(d.rssi)} dBm` : "",
    d.manufacturers.map((m) => `0x${formatValorePy(m, "04X")}`).join(", "),
    autorizzato ? "sì" : "no",
  ];
}

/** Il messaggio dopo la scansione. */
export function messaggioVicini(n) {
  return `${n} dispositivi vicini.`;
}

// Come -x di Python per il valore del segnale.
function opposto(x) {
  if (typeof x === "boolean") return -Number(x);
  if (typeof x === "number" || typeof x === "bigint") return -x;
  throw errorePy("TypeError", `bad operand type for unary -: '${nomeTipoPy(x)}'`);
}

function comeDizionario(x) {
  if (nomeTipoPy(x) !== "dict") throw errorePy("AttributeError", `'${nomeTipoPy(x)}' object has no attribute 'get'`);
  return x;
}

/**
 * Le righe della scansione del Polpo (`ble.scan`) o del telefono (`ble.risultato`): dal segnale più forte (-100 se
 * manca), [nome, indirizzo, segnale, produttore, connettibile], come il modulo Polpo di Polpo Studio.
 */
export function righeScansione(dati) {
  const chiavi = elementiPy(prendiPy(dati, "devices", [])).map((x, i) => [opposto(prendiPy(comeDizionario(x), "rssi", -100)), i, x]);
  chiavi.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return chiavi.map(([, , x]) => [
    veroPy(prendiPy(x, "name")) ? prendiPy(x, "name") : "—",
    prendiPy(x, "addr", ""),
    `${strPy(prendiPy(x, "rssi"))} dBm`,
    `0x${formatValorePy(prendiPy(x, "mfr_id", 0), "04X")}`,
    veroPy(prendiPy(x, "connectable")) ? "sì" : "no",
  ]);
}

/** Il messaggio dopo la scansione del Polpo. */
export function messaggioScansione(n, simulato = false) {
  return `${n} dispositivi trovati` + (veroPy(simulato) ? " · SIMULATO" : "");
}

// ---------------- servizi GATT ----------------

/**
 * I servizi dell'evento `ble.collegato` nella forma di Polpo Studio per PC: [{uuid, name, characteristics: [{uuid, name,
 * properties, handle}]}]. Il telefono non dà le descrizioni: i nomi dei servizi vengono dalla tabella SERVIZI_NOTI.
 */
export function serviziDaTelefono(ev) {
  return (ev?.servizi ?? []).map((s) => ({
    uuid: String(s.uuid),
    name: nomeServizio(String(s.uuid), ""),
    characteristics: (s.caratteristiche ?? []).map((c) => ({ uuid: String(c.uuid), name: "", properties: [...(c.proprieta ?? [])], handle: null })),
  }));
}

/** L'albero dei servizi: [{testo, proprieta: "", caratteristiche: [{testo, proprieta, uuid}]}]. */
export function alberoServizi(servizi) {
  return servizi.map((s) => ({
    testo: `${s.name || "Servizio"} · ${s.uuid}`,
    proprieta: "",
    caratteristiche: s.characteristics.map((c) => ({ testo: `${c.name || "Caratteristica"} · ${c.uuid}`, proprieta: c.properties.join(", "), uuid: c.uuid })),
  }));
}

/** Il messaggio dopo il collegamento. */
export function messaggioServizi(n) {
  return `${n} servizi.`;
}

/** La riga del registro per un valore letto. */
export function rigaLettura(uuid, dati) {
  return `${uuid}: ${formattaValore(dati)}`;
}

/** La riga del registro per una notifica. */
export function rigaNotifica(uuid, dati) {
  return `↻ ${uuid}: ${formattaValore(dati)}`;
}

/** Una riga del registro con l'ora ("09:05:07  testo"). */
export function conOra(testo, ora) {
  return `${ora}  ${testo}`;
}

// ---------------- dispositivi autorizzati ----------------

/** Il registro dei dispositivi autorizzati sta nella cassaforte, categoria «configurazioni», con questo nome. */
export const NOME_REGISTRO = "dispositivi-bluetooth.json";
export const CATEGORIA_REGISTRO = "configurazioni";

/**
 * Il contenuto del registro (i byte salvati nella cassaforte, o un testo): di solito [{address, name, added}].
 * Nessun registro, o un contenuto che non è JSON valido, vale [] (come in Python). Differenze, mai prodotte da Polpo
 * Studio che scrive il registro: json.loads di Python accetta anche NaN e Infinity e i testi in UTF-16 o UTF-32, qui
 * valgono [].
 */
export function leggiAutorizzati(dati) {
  if (dati === null || dati === undefined) return [];
  let testo = dati;
  if (typeof dati !== "string") {
    const b = Uint8Array.from(dati);
    // json.loads di Python riconosce dai primi byte anche UTF-16 e UTF-32: qui non si scrivono mai così
    if (b.length >= 2 && (b[0] === 0 || b[1] === 0 || (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return [];
    const bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    try {
      testo = UTF8_RIGIDO.decode(bom ? b.subarray(3) : b);
    } catch {
      return [];
    }
  } else if (testo.startsWith("\ufeff")) return []; // json.loads su un testo con BOM: errore
  try {
    return JSON.parse(testo);
  } catch {
    return [];
  }
}

/** Vero se l'indirizzo è nel registro. Voci rotte → stessi errori di Python (TypeError, KeyError). */
export function autorizzato(registro, indirizzo) {
  for (const d of elementiPy(registro)) if (chiavePy(d, "address") === indirizzo) return true;
  return false;
}

/**
 * Aggiunge (o rinnova) un dispositivo: {registro, testo, dati}; `testo` è il JSON come json.dumps(indent=2,
 * ensure_ascii=False) di Python, `dati` i suoi byte UTF-8 da salvare (NOME_REGISTRO, CATEGORIA_REGISTRO).
 */
export function aggiungiAutorizzato(registro, indirizzo, nome, adesso) {
  const nuovo = elementiPy(registro).filter((d) => chiavePy(d, "address") !== indirizzo);
  nuovo.push({ address: indirizzo, name: nome, added: formattaData("%Y-%m-%d", adesso) });
  const testo = jsonPython(nuovo, { soloAscii: false, rientro: 2 });
  return { registro: nuovo, testo, dati: codificaUtf8(testo) };
}

// ---------------- testi del modulo ----------------

export const TESTI = Object.freeze({
  nota: "Ci si collega solo ai dispositivi autorizzati (tuoi). Le scansioni non vengono salvate.",
  scansione: "Scansione in corso…",
  adattatoreOk: "adattatore funzionante",
  selezionaDispositivo: "Seleziona un dispositivo.",
  selezionaCaratteristica: "Seleziona una caratteristica.",
  autorizzaPrima: "Prima autorizza il dispositivo (deve essere tuo).",
  titoloAutorizza: "Autorizzare il dispositivo?",
  notificheSpente: "Notifiche spente",
  scollegato: "Scollegato",
  nessunCollegato: "nessun dispositivo collegato",
  scansionePolpo: "Scansione Bluetooth in corso…",
});

/** Il testo della conferma prima di autorizzare un dispositivo. */
export function testoAutorizza(d) {
  return `${d.name || "—"} (${d.address})`;
}

/** La voce del registro delle attività dopo l'autorizzazione: [categoria, messaggio, livello]. */
export function attivitaAutorizzato(indirizzo) {
  return ["bluetooth", `Dispositivo autorizzato: ${indirizzo}`, "info"];
}

/**
 * Prima di collegarsi: `{errore}` se il dispositivo non è nel registro (deve essere tuo), altrimenti il messaggio
 * d'attesa.
 */
export function preparaCollegamento(d, registro) {
  if (!autorizzato(registro, d.address)) return { errore: TESTI.autorizzaPrima, messaggio: "" };
  return { errore: "", messaggio: `Collegamento a ${d.address}…` };
}

/** Dopo il collegamento: la riga del registro e la voce delle attività. */
export function esitoCollegamento(indirizzo) {
  return { riga: `Collegato a ${indirizzo}`, attivita: ["bluetooth", `Collegato a ${indirizzo}`, "info"] };
}

/** La riga del registro quando le notifiche partono. */
export function rigaNotificheAttive(uuid) {
  return `Notifiche attive su ${uuid}`;
}

/** Il messaggio di un errore del Bluetooth (e la riga del registro: il testo dell'errore). */
export function testoErrore(e) {
  const t = e instanceof Error ? e.message : strPy(e);
  return { messaggio: `Bluetooth: ${t}`, riga: t, adattatoreAssente: e instanceof BleNonDisponibile };
}
