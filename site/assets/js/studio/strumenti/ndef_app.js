// Polpo Studio — costruttore di messaggi NDEF: i byte che verrebbero scritti su un tag e quanto spazio occupano.
// Copia JavaScript di studio/polpo_studio/apps/ndef_app.py, più gli aiuti della pagina NFC
// (studio/polpo_studio/app/tools/nfc_tools.py): analisi di una lettura `nfc.read`, analizzatore NDEF,
// argomenti di `nfc.write_ndef`, report. Si scrivono solo link e testi su tag propri; niente chiavi, niente emulazione.

import * as ndef from "../protocolli/ndef.js";
import * as type2 from "../protocolli/type2.js";
import {
  codificaUtf8,
  decodificaAscii,
  escapeHtml,
  eValueErrorPy,
  formatIntPy,
  formattaData,
  fromhexPy,
  hexPy,
  intPy,
  prendiPy,
  splitPy,
  stripPy,
  strPy,
  veroPy,
} from "./convertitore.js";

export const MANIFEST = Object.freeze({
  id: "costruttore_ndef",
  name: "Costruttore NDEF",
  description: "Prepara un link o un testo NDEF e mostra i byte (con TLV) e lo spazio occupato su NTAG213/215/216.",
  version: "1.0",
  category: "nfc",
  author: "Progetto Polpo",
  icon: "nfc",
});

/** Byte utili dei tag più comuni. */
export const CAPACITA = Object.freeze({ NTAG213: 144, NTAG215: 504, NTAG216: 888 });

/** I byte da scrivere sul tag (messaggio NDEF dentro il TLV). `tipo` è "uri" oppure testo. */
export function costruisci(tipo, valore, lingua = "it") {
  const msg = tipo === "uri" ? ndef.messaggioUri(valore) : ndef.messaggioTesto(valore, lingua);
  return ndef.avvolgiTlv(msg);
}

/** Quello che mostra la pagina del costruttore: {byte: "03 0F D1 …", spazio: "NTAG213: entra · … (n byte)"}. */
export function descrivi(tipo, valore) {
  const tlv = costruisci(tipo, valore);
  const spazio =
    Object.entries(CAPACITA)
      .map(([m, c]) => `${m}: ${tlv.length <= c ? "entra" : "troppo grande"}`)
      .join(" · ") + ` (${tlv.length} byte)`;
  return { byte: hexPy(tlv, " ").toUpperCase(), spazio };
}

// ======================================================================================================
// Aiuti della pagina NFC (da app/tools/nfc_tools.py): HTML, testi, argomenti dei comandi. Niente interfaccia.
// ======================================================================================================

const simulatoSuffisso = (simulato) => (simulato ? " · SIMULATO" : "");

/** I testi fissi della pagina NFC. */
export const TESTI_PAGINA = Object.freeze({
  iniziale: "<p>Appoggia un tag sul modulo RFID2 e premi «Leggi dal Polpo».</p>",
  scrittura:
    "Scrive un link o un testo su un tag NTAG/Ultralight TUO. Serve la modalità laboratorio; il Polpo chiede conferma sul suo schermo e poi verifica la scrittura.",
  valoreIniziale: "https" + ":/" + "/", // a pezzi: il controllo del sito rifiuta gli indirizzi scritti per intero
  analizzatore: "Incolla i byte in esadecimale: un messaggio NDEF oppure la memoria dalla pagina 4 (con TLV).",
  esempioAnalizzatore: "03 11 D1 01 0D 55 04 65 78 61 6D 70 6C 65 2E 6F 72 67 FE",
  primaLeggi: "Leggi prima un tag.",
  selezionaLettura: "Seleziona una lettura salvata.",
});

/** L'HTML dell'analisi di una lettura (risposta di `nfc.read` o lettura salvata). */
export function rendiLettura(carta, simulato) {
  if (!veroPy(prendiPy(carta, "present", true))) return "<p>Nessun tag vicino al modulo RFID2.</p>";
  const a = type2.analizzaLettura(carta);
  const righe = [
    ["UID", a.uid + (a.uidOk === null || a.uidOk === true ? "" : " ⚠")],
    ["Famiglia", a.famiglia],
    ["Modello", a.modello || "—"],
    ["ATQA / SAK", `0x${formatIntPy(intPy(prendiPy(carta, "atqa", 0)), "04X")} / 0x${formatIntPy(intPy(prendiPy(carta, "sak", 0)), "02X")}`],
  ];
  if (veroPy(prendiPy(carta, "atr"))) righe.push(["ATR", carta.atr]);
  if (veroPy(prendiPy(carta, "version"))) righe.push(["Versione", carta.version]);
  if (a.versioneCc) {
    righe.push(
      ["Formattato NDEF", a.formattatoNdef ? "sì" : "no"],
      ["Spazio dati (CC)", `${a.capacita} byte`],
      ["Scrivibile", a.scrivibile ? "sì" : "no"],
      ["Blocchi statici", a.bloccatoStatico ? "attivi" : "nessuno"],
    );
  }
  let out = "<table cellspacing='4'>" + righe.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escapeHtml(strPy(v))}</td></tr>`).join("") + "</table>";
  if (a.record.length) {
    out += "<h3>NDEF</h3><ul>" + a.record.map((r) => `<li>${escapeHtml(r.genere)}: ${escapeHtml(r.valore || hexPy(r.payload))}</li>`).join("") + "</ul>";
  }
  if (a.erroreNdef) out += `<p>NDEF: ${escapeHtml(a.erroreNdef)}</p>`;
  if (a.note.length) out += "<h3>Analisi</h3><ul>" + a.note.map((n) => `<li>${escapeHtml(n)}</li>`).join("") + "</ul>";
  if (simulato || veroPy(prendiPy(carta, "simulated"))) out += "<p><b>SIMULATO: tag inventato dal Polpo virtuale.</b></p>";
  return out;
}

/**
 * Dopo «Leggi dal Polpo» (risposta di `nfc.read`): {html, simulato, messaggio, attivita}.
 * `attivita` è la riga per il registro attività, null se non c'era nessun tag.
 */
export function esitoLettura(risposta, simulato) {
  const sim = simulato || veroPy(prendiPy(risposta, "simulated"));
  const html = rendiLettura(risposta, sim);
  if (veroPy(prendiPy(risposta, "present"))) {
    const modello = prendiPy(risposta, "model");
    return {
      html,
      simulato: sim,
      messaggio: `Tag letto: ${strPy(prendiPy(risposta, "uid"))}` + simulatoSuffisso(sim),
      attivita: `Letto un tag NFC (${strPy(veroPy(modello) ? modello : prendiPy(risposta, "family"))})`,
    };
  }
  return { html, simulato: sim, messaggio: "Nessun tag.", attivita: null };
}

/** L'analizzatore NDEF: byte in esadecimale (messaggio NDEF o memoria dalla pagina 4 con TLV) → {ok, html}. */
export function analizzaNdefEsadecimale(testo) {
  let grezzi;
  try {
    grezzi = fromhexPy(splitPy(testo).join(""));
  } catch (e) {
    if (!eValueErrorPy(e)) throw e;
    return { ok: false, html: "Esadecimale non valido." };
  }
  const msg = grezzi.length && [0x00, 0x01, 0x02, 0x03, 0xfd].includes(grezzi[0]) ? ndef.trovaNelTlv(grezzi) : grezzi;
  let record;
  try {
    record = ndef.analizza(msg ?? new Uint8Array(0));
  } catch (e) {
    if (!eValueErrorPy(e)) throw e;
    return { ok: false, html: escapeHtml(e.message) };
  }
  const voci = record.map(
    (r) =>
      `<li><b>${escapeHtml(r.genere)}</b> TNF ${r.tnf} · tipo ${escapeHtml(decodificaAscii(r.tipo))} · ${escapeHtml(r.valore || hexPy(r.payload))}` +
      (r.lingua ? ` · lingua ${escapeHtml(r.lingua)}` : "") +
      "</li>",
  );
  return { ok: true, html: "<ol>" + voci.join("") + "</ol>" };
}

/** Il messaggio NDEF del modulo di scrittura (link o testo; lingua vuota = "it"). */
export function messaggioScrittura(tipo, valore, lingua) {
  return tipo === "uri" ? ndef.messaggioUri(valore) : ndef.messaggioTesto(valore, lingua || "it");
}

/** La riga sotto il modulo di scrittura: quanti byte occupa il contenuto con il TLV. */
export function testoSpazio(tipo, valore, lingua) {
  const n = ndef.avvolgiTlv(messaggioScrittura(tipo, valore, lingua)).length;
  return `Occupa ${n} byte (NTAG213: 144, NTAG215: 504, NTAG216: 888).`;
}

/** Il campo «Lingua» accetta al massimo 5 caratteri. */
export const LINGUA_MAX = 5;

/**
 * Prepara «Scrivi sul tag…»: {ok: false, errore} oppure {ok: true, comando, args, timeout, azioneLaboratorio,
 * titoloConferma, testoConferma, messaggioAttesa}. Il comando va inviato solo dopo la conferma dell'utente e con la
 * modalità laboratorio attiva; il Polpo chiede comunque conferma sul suo schermo e poi verifica la scrittura.
 */
export function preparaScrittura(tipo, valore, lingua) {
  const v = stripPy(valore);
  if (!v || codificaUtf8(v).length > 400) return { ok: false, errore: "Contenuto vuoto o oltre 400 byte." };
  const args = { kind: tipo, value: v };
  if (tipo === "text") args.lang = lingua || "it";
  return {
    ok: true,
    comando: "nfc.write_ndef",
    args,
    timeout: 45.0,
    azioneLaboratorio: "nfc.write",
    titoloConferma: "Scrivere il tag?",
    testoConferma: `Contenuto: ${v}\nDopo la conferma sullo schermo del Polpo, appoggia il tag sul modulo RFID2 entro 15 secondi.`,
    messaggioAttesa: "Conferma sullo schermo del Polpo, poi appoggia il tag…",
  };
}

/** Dopo la scrittura (risposta di `nfc.write_ndef`): {messaggio, attivita}. */
export function esitoScrittura(risposta, simulato) {
  const d = (k) => strPy(prendiPy(risposta, k));
  return {
    messaggio: `Scritto e verificato: ${d("bytes")} byte su ${d("model")} (${d("uid")}).` + simulatoSuffisso(simulato),
    attivita: `Scritto un tag NFC (${d("uid")})`,
  };
}

/**
 * «Salva nella cassaforte»: {ok: false, errore} oppure {ok: true, nome, dati, testo, origine, meta, messaggio}.
 * `testo` è il JSON da cifrare (come json.dumps(indent=2) di Python); `adesso` è un Date (ora locale).
 */
export function salvataggioLettura(carta, simulato, adesso, nome = null) {
  if (!carta || !Object.keys(carta).length || !veroPy(prendiPy(carta, "present"))) return { ok: false, errore: "Leggi prima un tag." };
  const n = nome || `tag-${strPy(prendiPy(carta, "uid", "x"))}-${formattaData("%Y%m%d-%H%M", adesso)}.json`;
  const dati = { ...carta, letto_il: formattaData("%Y-%m-%d %H:%M", adesso) };
  return {
    ok: true,
    nome: n,
    dati,
    testo: JSON.stringify(dati, null, 2),
    origine: simulato ? "simulato" : "reale",
    meta: { uid: prendiPy(carta, "uid", ""), model: prendiPy(carta, "model", "") },
    messaggio: "Lettura salvata nella cassaforte.",
  };
}

/** Le letture salvate che la pagina considera: solo i file .json. `voci`: [{nome, …}]. */
export function vociArchivio(voci) {
  return voci.filter((v) => v.nome.endsWith(".json"));
}

/** Una riga dell'archivio: [nome, UID, modello, origine]. `voce`: {nome, meta, simulato}. */
export function rigaArchivio(voce) {
  return [voce.nome, prendiPy(voce.meta, "uid", ""), prendiPy(voce.meta, "model", ""), voce.simulato ? "SIMULATO" : "reale"];
}

/** Il report HTML delle letture salvate. `voci`: [{nome, carta, simulato}] (si usano solo i file .json). */
export function reportLetture(voci) {
  const parti = vociArchivio(voci).map((v) => `<h2>${escapeHtml(v.nome)}</h2>` + rendiLettura(v.carta, v.simulato));
  return (
    "<!doctype html><meta charset='utf-8'><title>Report NFC</title><style>body{font-family:sans-serif;margin:2em}</style><h1>Report NFC</h1>" +
    parti.join("")
  );
}
