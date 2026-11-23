// Polpo Studio — le app integrate: manifest, permessi dichiarati, compatibilità con l'hardware, testi del modulo App.
// Copia JavaScript delle parti pure di studio/polpo_studio/core/apps.py (lettura del manifest, permessi e comandi che
// concedono, controlli dell'interfaccia offerta alle app) e di app/tools/apps_tools.py (catalogo filtrato, righe
// della tabella, dettagli, messaggi). La valutazione della compatibilità è quella di core/capability.py.
//
// Nel telefono ci sono solo le app integrate (convertitore, codici di controllo, tempo radio, costruttore NDEF): le
// app di terze parti sono programmi Python e restano nel programma per PC. Il manifest ha le chiavi di manifest.json
// (id, name, description, version, category, author, icon, permissions, hardware, vault_categories, builtin,
// experimental).

import { ETICHETTA, PRESENZA, STATO } from "../catalogo.js";
import { MANIFEST as MANIFEST_TEMPO_RADIO } from "../protocolli/budget_radio.js";
import { ErrorePy, elementiPy } from "../protocolli/flipper.js";
import { CATEGORIE as CATEGORIE_CASSAFORTE } from "../sicurezza/cassaforte.js";
import { MANIFEST as MANIFEST_CONVERTITORE, errorePy, nomeTipoPy, prendiPy, reprPy, strPy, stripPy, veroPy } from "./convertitore.js";
import { MANIFEST as MANIFEST_CRC } from "./crc.js";
import { MANIFEST as MANIFEST_NDEF } from "./ndef_app.js";

/** I permessi che un'app può dichiarare, con la spiegazione mostrata. */
export const PERMESSI = Object.freeze({
  "polpo.info": "leggere informazioni e stato del Polpo",
  "polpo.ir": "inviare segnali infrarossi con il Polpo",
  "polpo.radio.rx": "ricevere codici radio con il Polpo",
  "polpo.nfc.read": "leggere tag NFC con il Polpo",
  "polpo.files.read": "leggere file dalla microSD del Polpo",
  "vault.read": "leggere file della cassaforte (solo le categorie indicate)",
  "vault.write": "salvare file nella cassaforte (solo le categorie indicate)",
});

/** I comandi di Polpo Link concessi da ciascun permesso. Nessun permesso concede trasmissioni o scritture. */
export const COMANDI_PER_PERMESSO = Object.freeze({
  "polpo.info": Object.freeze(["diag", "info"]),
  "polpo.ir": Object.freeze(["ir.send"]),
  "polpo.radio.rx": Object.freeze(["rf.rx.start", "rf.rx.stop"]),
  "polpo.nfc.read": Object.freeze(["nfc.read"]),
  "polpo.files.read": Object.freeze(["fs.list", "fs.read"]),
});

/** Le categorie delle app, nell'ordine del menu. */
export const CATEGORIE_APP = Object.freeze(["strumenti", "convertitori", "analizzatori", "radio", "nfc", "infrarossi", "elettronica", "altro"]);

/** Gli id dell'hardware che un manifest può chiedere (core/hardware.py). */
export const ID_HARDWARE = Object.freeze([
  "polpo", "polpo.ir_tx", "polpo.ir_unit", "polpo.rf433", "polpo.rfid2", "polpo.wifi", "polpo.ble", "polpo.usb_hid",
  "pc.usb", "pc.serial", "pc.hid", "pc.ble", "pc.pcsc", "rfid125.usb", "rfid125.rdm6300", "bridge", "bridge.onewire",
]);

/** Le app integrate, nell'ordine di Polpo Studio (polpo_studio/apps/__init__.py). */
export const MANIFEST_INTEGRATI = Object.freeze([MANIFEST_CONVERTITORE, MANIFEST_CRC, MANIFEST_TEMPO_RADIO, MANIFEST_NDEF]);

/** AppError di core/apps.py: manifest non valido. */
export class ErroreApp extends ErrorePy {
  static tipo = "AppError";
}

// Come `x in dizionario` di Python: i valori non «hashable» (liste, dizionari) danno TypeError.
function chiaveDi(tabella, x) {
  const tipo = nomeTipoPy(x);
  if (tipo === "list" || tipo === "dict") throw errorePy("TypeError", `unhashable type: '${tipo}'`);
  return typeof x === "string" && Object.hasOwn(tabella, x);
}

const PRIMI = (s, n) => Array.from(s).slice(0, n).join("");
// `^[a-z][a-z0-9_]{2,40}$` di Python: «$» vale anche prima di un a capo finale.
const ID_APP = /^[a-z][a-z0-9_]{2,40}\n?$/;
const HARDWARE = Object.freeze(Object.fromEntries(ID_HARDWARE.map((h) => [h, true])));

/**
 * Legge un manifest (oggetto JSON) come parse_manifest: lancia ErroreApp con lo stesso messaggio se un campo manca o
 * non è valido; nomi e testi troppo lunghi si accorciano, una categoria sconosciuta diventa «altro».
 */
export function leggiManifest(dati, { integrata = false } = {}) {
  const serve = (k) => {
    const v = prendiPy(dati, k);
    if (typeof v !== "string" || !stripPy(v)) throw new ErroreApp(`manifest: campo «${k}» mancante o non valido`);
    return v;
  };
  const id = serve("id");
  if (!ID_APP.test(id)) throw new ErroreApp("manifest: id con lettere minuscole, cifre e _ (3-41 caratteri)");
  const permessi = prendiPy(dati, "permissions", []);
  if (!Array.isArray(permessi) || permessi.some((p) => !chiaveDi(PERMESSI, p))) {
    const sconosciuti = elementiPy(permessi).filter((p) => !chiaveDi(PERMESSI, p));
    throw new ErroreApp(`manifest: permessi sconosciuti ${reprPy(sconosciuti)}`);
  }
  const hw = prendiPy(dati, "hardware", []);
  if (!Array.isArray(hw) || hw.some((alt) => !Array.isArray(alt) || alt.some((h) => !chiaveDi(HARDWARE, h)))) {
    throw new ErroreApp("manifest: «hardware» deve essere una lista di alternative con id hardware noti");
  }
  const categorie = prendiPy(dati, "vault_categories", []);
  if (!Array.isArray(categorie) || categorie.some((c) => !CATEGORIE_CASSAFORTE.includes(c))) {
    throw new ErroreApp("manifest: categorie della cassaforte sconosciute");
  }
  const categoria = prendiPy(dati, "category", "altro");
  const name = PRIMI(serve("name"), 60);
  const description = PRIMI(serve("description"), 400);
  const version = PRIMI(serve("version"), 20);
  const author = PRIMI(serve("author"), 80);
  return {
    id,
    name,
    description,
    version,
    category: CATEGORIE_APP.includes(categoria) ? categoria : "altro",
    author,
    icon: strPy(prendiPy(dati, "icon", "apps")),
    permissions: [...permessi],
    hardware: hw.map((a) => [...a]),
    vault_categories: [...categorie],
    builtin: integrata,
    experimental: veroPy(prendiPy(dati, "experimental", false)),
  };
}

/** I manifest delle app integrate, già letti. */
export function appIntegrate() {
  return MANIFEST_INTEGRATI.map((m) => leggiManifest(m, { integrata: true }));
}

// ---------------- compatibilità (core/capability.py) ----------------

/** La funzione del catalogo che corrisponde all'app (stessa forma del catalogo: id, titolo, strade...). */
export function capacita(m) {
  return {
    id: "app." + m.id,
    titolo: m.name,
    descrizione: m.description,
    strade: m.hardware.map((h) => ({ hardware: [...h], sperimentale: false, nota: null })),
    sperimentale: m.experimental || !m.builtin,
    laboratorio: !m.builtin,
    esclusa: null,
  };
}

/** Il motivo per le app che non chiedono hardware (in Polpo Studio per PC: «Funziona sul PC, non serve hardware.»). */
export const MOTIVO_SOLO_SOFTWARE = "Funziona nel telefono, non serve hardware.";

const nomi = (ids, n) => ids.map((i) => (Object.hasOwn(n, i) ? n[i] : i)).join(", ");

function valutaStrada(f, strada, hw, n) {
  const assenti = [], nonVerificabili = [], simulati = [], dichiarati = [];
  for (const h of strada.hardware) {
    const p = (Object.hasOwn(hw, h) ? hw[h] : { presenza: PRESENZA.ASSENTE }).presenza;
    if (p === PRESENZA.ASSENTE) assenti.push(h);
    else if (p === PRESENZA.NON_VERIFICABILE) nonVerificabili.push(h);
    else if (p === PRESENZA.SIMULATO) simulati.push(h);
    else if (p === PRESENZA.DICHIARATO) dichiarati.push(h);
  }
  if (assenti.length) {
    const serve = [...assenti, ...nonVerificabili];
    return { stato: STATO.HARDWARE, motivo: `Serve: ${nomi(serve, n)}`, usabile: false, mancanti: serve };
  }
  if (nonVerificabili.length) {
    return {
      stato: STATO.HARDWARE,
      motivo: `Non rilevabile automaticamente: ${nomi(nonVerificabili, n)}. Se è collegato, dichiaralo in Impostazioni › Hardware.`,
      usabile: true,
      mancanti: nonVerificabili,
    };
  }
  if (simulati.length) return { stato: STATO.SIMULATO, motivo: "Con il Polpo virtuale: dati inventati.", usabile: true, mancanti: [] };
  const stato = f.sperimentale || strada.sperimentale ? STATO.SPERIMENTALE : STATO.DISPONIBILE;
  let motivo = `Pronto con: ${nomi(strada.hardware, n)}`;
  if (dichiarati.length) motivo += ` (dichiarato da te: ${nomi(dichiarati, n)})`;
  return { stato, motivo, usabile: true, mancanti: [] };
}

function rango(v) {
  if (v.stato === STATO.DISPONIBILE) return [0, 0];
  if (v.stato === STATO.SPERIMENTALE) return [0, 1];
  if (v.stato === STATO.SIMULATO) return [1, 0];
  return [v.usabile ? 2 : 3, v.mancanti.length];
}

/**
 * Lo stato dell'app con l'hardware attuale (`hw`: id → {presenza}, come presenze() del catalogo; `n`: id → nome):
 * {stato, etichetta, motivo, usabile, mancanti}. Senza hardware richiesto l'app è Disponibile (o Sperimentale).
 */
export function valutaApp(m, hw = {}, n = {}) {
  const f = capacita(m);
  let v;
  if (!f.strade.length) {
    v = { stato: f.sperimentale ? STATO.SPERIMENTALE : STATO.DISPONIBILE, motivo: MOTIVO_SOLO_SOFTWARE, usabile: true, mancanti: [] };
  } else {
    let migliore = null;
    for (const s of f.strade) {
      const x = valutaStrada(f, s, hw, n);
      const [a, b] = rango(x);
      if (!migliore || a < migliore.r[0] || (a === migliore.r[0] && b < migliore.r[1])) migliore = { v: x, r: [a, b] };
    }
    v = migliore.v;
  }
  return { ...v, etichetta: ETICHETTA[v.stato] };
}

// ---------------- catalogo (apps_tools.py) ----------------

/** Intestazioni della tabella delle app. */
export const COLONNE = Object.freeze(["App", "Versione", "Categoria", "Autore", "Permessi", "Stato", "Tipo"]);

export const TESTI = Object.freeze({
  tutteLeCategorie: "Tutte le categorie",
  cerca: "Cerca un'app…",
  seleziona: "Seleziona un'app.",
  nota: "Le app di terze parti si installano e si aprono solo in modalità laboratorio. Non sono isolate: installa solo quelle di cui conosci l'autore.",
  nonDisinstallabili: "Le app integrate non si disinstallano.",
  notaTerzeParti: "App di terze parti, Sperimentale e non isolata: gira con gli stessi permessi di Polpo Studio.",
  integrata: "integrata",
  terzeParti: "terze parti",
});

/** Le app che corrispondono ai filtri: `categoria` (null = tutte) e testo cercato nel nome o nella descrizione. */
export function filtraApp(manifest, { categoria = null, cerca = "" } = {}) {
  const q = stripPy(cerca).toLowerCase();
  return manifest.filter((m) => (categoria === null || m.category === categoria) && (!q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)));
}

/** Le righe della tabella: nome, versione, categoria, autore, permessi, stato (a parole), tipo. */
export function righeApp(manifest, hw = {}, n = {}) {
  return manifest.map((m) => [m.name, m.version, m.category, m.author, m.permissions.join(", ") || "—", valutaApp(m, hw, n).etichetta, m.builtin ? TESTI.integrata : TESTI.terzeParti]);
}

/**
 * I dettagli di un'app: {titolo, html}. L'HTML è quello della finestra di Polpo Studio, SENZA escape dei campi del
 * manifest (come in Python): va bene per le app integrate; per altro testo usare i campi uno per uno.
 * `problemi`: per un'app di terze parti, l'esito del controllo d'integrità (elenco vuoto = file come all'installazione).
 */
export function dettagliApp(m, n = {}, problemi = null) {
  const permessi = m.permissions.map((p) => `<li>${p}: ${PERMESSI[p]}</li>`).join("") || "<li>nessuno</li>";
  const serve = m.hardware.map((alt) => alt.map((h) => (Object.hasOwn(n, h) ? n[h] : h)).join(" + ")).join(" oppure ") || "nessuno";
  let integrita = "";
  if (!m.builtin) integrita = "<p>" + (!problemi || !problemi.length ? "Integrità: file come all'installazione." : "Integrità: " + problemi.join("; ")) + "</p>";
  return {
    titolo: m.name,
    html: `<b>${m.name}</b> ${m.version} · ${m.author}<p>${m.description}</p><p>Permessi:</p><ul>${permessi}</ul><p>Hardware: ${serve}</p>${integrita}`,
  };
}

/** Il titolo della finestra di un'app. */
export function titoloFinestra(m) {
  return m.name + (m.builtin ? "" : " · app di terze parti");
}

/** La voce del registro delle attività quando si apre un'app: [categoria, messaggio, livello]. */
export function attivitaApertura(m) {
  return ["app", `Aperta l'app «${m.name}»`, "info"];
}

/** Il messaggio quando un'app non si apre. */
export function messaggioErroreApertura(m, e) {
  return `Impossibile aprire «${m.name}»: ${e instanceof Error ? e.message : strPy(e)}`;
}

// ---------------- l'interfaccia offerta alle app (AppApi) ----------------

/** PermissionError di Python: l'app chiede ciò che non ha dichiarato. */
export class ErrorePermesso extends ErrorePy {
  static tipo = "PermissionError";
}

/** I comandi di Polpo Link che i permessi dell'app concedono (in ordine alfabetico). */
export function comandiConcessi(m) {
  const tutti = new Set();
  for (const p of m.permissions) for (const c of COMANDI_PER_PERMESSO[p] ?? []) tutti.add(c);
  return [...tutti].sort();
}

/** Lancia ErrorePermesso se il comando non è concesso all'app (come AppApi.request). */
export function controllaComando(m, cmd) {
  if (!comandiConcessi(m).includes(cmd)) throw new ErrorePermesso(`comando ${cmd} non concesso all'app «${m.name}»`);
}

/**
 * Lancia ErrorePermesso se l'app non può leggere (`scrittura` falso) o salvare nella categoria della cassaforte, come
 * AppApi.vault_items / vault_get / vault_put: prima il permesso, poi la categoria.
 */
export function controllaCassaforte(m, categoria, scrittura = false) {
  const permesso = scrittura ? "vault.write" : "vault.read";
  if (!m.permissions.includes(permesso)) throw new ErrorePermesso(`l'app «${m.name}» non ha dichiarato il permesso ${permesso}`);
  if (!m.vault_categories.includes(categoria)) throw new ErrorePermesso(`categoria ${categoria} non dichiarata`);
}
