// Polpo Studio — tag NFC Type 2 (NTAG21x, MIFARE Ultralight): modelli, CC, blocchi, analisi di una lettura.
// Copia JavaScript di studio/polpo_studio/protocols/type2.py; mappe di memoria dai datasheet pubblici NXP,
// come polpo/lib/polpo_core/src/polpo/nfc/type2.cpp.

import * as ndef from "./ndef.js";
import { diversoDaZeroPy, eValueErrorPy, fromhexPy, hexPy, intPy, prendiPy, strPy, veroPy } from "../strumenti/convertitore.js";

function modello(nome, pagineTotali, primaUtente, ultimaUtente, paginaBloccoDinamico, paginaCfg = 0) {
  // paginaBloccoDinamico 0 = nessun blocco dinamico; paginaCfg = pagina CFG0 (AUTH0) dei chip con password, 0 = nessuna
  return Object.freeze({ nome, pagineTotali, primaUtente, ultimaUtente, paginaBloccoDinamico, paginaCfg });
}

export const MODELLI = Object.freeze({
  ultralight: modello("MIFARE Ultralight", 16, 4, 15, 0),
  ul_ev1_11: modello("MIFARE Ultralight EV1 (MF0UL11)", 20, 4, 15, 0, 0x10),
  ul_ev1_21: modello("MIFARE Ultralight EV1 (MF0UL21)", 41, 4, 35, 36, 0x25),
  ntag210: modello("NTAG210", 20, 4, 15, 0, 0x10),
  ntag212: modello("NTAG212", 41, 4, 35, 36, 0x25),
  ntag213: modello("NTAG213", 45, 4, 39, 40, 0x29),
  ntag215: modello("NTAG215", 135, 4, 129, 130, 0x83),
  ntag216: modello("NTAG216", 231, 4, 225, 226, 0xe3),
});

/** Il modello dalla risposta a GET_VERSION (8 byte); null se sconosciuto. */
export function modelloDaVersione(v) {
  if (v.length < 8) return null;
  const prodotto = v[2];
  const memoria = v[6];
  if (prodotto === 0x04) {
    return { 0x0b: MODELLI.ntag210, 0x0e: MODELLI.ntag212, 0x0f: MODELLI.ntag213, 0x11: MODELLI.ntag215, 0x13: MODELLI.ntag216 }[memoria] ?? null;
  }
  if (prodotto === 0x03) return { 0x0b: MODELLI.ul_ev1_11, 0x0e: MODELLI.ul_ev1_21 }[memoria] ?? null;
  return null;
}

/** Il modello dal nome mostrato (es. "NTAG215"); null se sconosciuto. */
export function modelloDaNome(nome) {
  return Object.values(MODELLI).find((m) => m.nome === nome) ?? null;
}

const FAMIGLIE_SAK = new Map([
  [0x00, "NFC Type 2 (NTAG / MIFARE Ultralight)"],
  [0x08, "MIFARE Classic 1K (o compatibile)"],
  [0x09, "MIFARE Mini"],
  [0x18, "MIFARE Classic 4K (o compatibile)"],
  [0x10, "MIFARE Plus (SL2)"],
  [0x11, "MIFARE Plus (SL2)"],
  [0x28, "Smart card con emulazione MIFARE Classic"],
  [0x38, "Smart card con emulazione MIFARE Classic"],
]);

/** La famiglia della carta da SAK e ATQA. */
export function famigliaCarta(sak, atqa) {
  sak = Number(sak);
  if (FAMIGLIE_SAK.has(sak)) return FAMIGLIE_SAK.get(sak);
  if (sak === 0x20) {
    return Number(atqa) === 0x0344 ? "MIFARE DESFire" : "Smart card ISO 14443-4 (DESFire, Plus SL3, carta bancaria, documento...)";
  }
  return "Carta ISO 14443-A non riconosciuta";
}

/**
 * Analizza la risposta di `nfc.read` (o una lettura salvata con gli stessi campi: uid, model, family, sak, atqa,
 * pages, read_error). Restituisce {uid, modello, famiglia, uidOk, formattatoNdef, versioneCc, capacita, scrivibile,
 * bloccatoStatico, otp, record, erroreNdef, note}; uidOk, scrivibile e bloccatoStatico sono null se non noti.
 */
export function analizzaLettura(carta) {
  const a = {
    uid: strPy(prendiPy(carta, "uid", "")),
    modello: strPy(prendiPy(carta, "model", "")),
    famiglia: "",
    uidOk: null,
    formattatoNdef: false,
    versioneCc: "",
    capacita: 0,
    scrivibile: null,
    bloccatoStatico: null,
    otp: "",
    record: [],
    erroreNdef: "",
    note: [],
  };
  const famiglia = prendiPy(carta, "family");
  a.famiglia = strPy(veroPy(famiglia) ? famiglia : famigliaCarta(intPy(prendiPy(carta, "sak", 0)), intPy(prendiPy(carta, "atqa", 0))));
  if (diversoDaZeroPy(prendiPy(carta, "sak", 0))) {
    a.note.push("Non è un tag Type 2: Polpo Studio mostra solo UID e famiglia. Le chiavi e i settori non vengono letti, per scelta.");
    return a;
  }
  if (veroPy(prendiPy(carta, "read_error"))) {
    a.note.push("Memoria non leggibile: probabilmente protetta da password. Polpo Studio non prova a indovinarla.");
    return a;
  }
  let mem;
  try {
    mem = fromhexPy(strPy(prendiPy(carta, "pages", "")));
  } catch (e) {
    if (!eValueErrorPy(e)) throw e;
    a.note.push("Pagine non valide nella lettura.");
    return a;
  }
  if (mem.length < 16) {
    a.note.push("Lettura troppo corta.");
    return a;
  }
  const uid = [...mem.subarray(0, 3), ...mem.subarray(4, 8)];
  a.uidOk = (0x88 ^ mem[0] ^ mem[1] ^ mem[2]) === mem[3] && (mem[4] ^ mem[5] ^ mem[6] ^ mem[7]) === mem[8];
  if (!a.uid) a.uid = hexPy(uid).toUpperCase();
  if (!a.uidOk) a.note.push("Byte di controllo dell'UID non coerenti: possibile tag non originale o lettura disturbata.");
  const blocco = mem.subarray(10, 12);
  a.bloccatoStatico = blocco[0] !== 0 || blocco[1] !== 0;
  const cc = mem.subarray(12, 16);
  a.formattatoNdef = cc[0] === 0xe1;
  a.versioneCc = `${cc[1] >> 4}.${cc[1] & 0x0f}`;
  a.capacita = cc[2] * 8;
  a.scrivibile = cc[3] === 0x00;
  a.otp = hexPy(cc).toUpperCase();
  if (a.bloccatoStatico) a.note.push(`Pagine bloccate per sempre (lock statici ${hexPy(blocco).toUpperCase()}): non si possono riscrivere.`);
  if (!a.scrivibile) a.note.push("Il tag si dichiara in sola lettura (CC byte 3).");
  const m = modelloDaNome(a.modello);
  if (m && m.paginaCfg) {
    a.note.push("Il chip supporta la password (pagina AUTH0): il Polpo legge solo la memoria utente, quindi lo stato della password non è noto.");
  }
  if (a.formattatoNdef) {
    const msg = ndef.trovaNelTlv(mem.subarray(16));
    if (msg === null) a.note.push("Formattato NDEF ma senza messaggio (tag vuoto).");
    else {
      try {
        a.record = ndef.analizza(msg);
      } catch (e) {
        if (!eValueErrorPy(e)) throw e;
        a.erroreNdef = e.message;
      }
    }
  } else {
    a.note.push("Non formattato NDEF: i telefoni non lo leggeranno come link o testo.");
  }
  return a;
}
