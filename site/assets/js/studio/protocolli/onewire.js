// Polpo Studio — 1-Wire e iButton: codice ROM a 64 bit (famiglia, numero di serie, CRC8 Dallas/Maxim).
// Copia JavaScript di studio/polpo_studio/protocols/onewire.py, più gli aiuti della pagina iButton
// (studio/polpo_studio/app/tools/ibutton_tools.py). Solo lettura: niente emulazione né scrittura di chiavi.

import { errorePy, eValueErrorPy, formatIntPy, formattaData, fromhexPy, hexPy, interoInByte, nomeTipoPy, prendiPy, stripPy, veroPy } from "../strumenti/convertitore.js";

/** Codici famiglia pubblicati nei datasheet Maxim/Analog Devices. */
export const FAMIGLIE = Object.freeze({
  0x01: "DS1990A / DS2401 (solo numero di serie)",
  0x02: "DS1991 (memoria con password)",
  0x04: "DS1994 / DS2404 (orologio + memoria)",
  0x06: "DS1993 (memoria 4 kbit)",
  0x08: "DS1992 (memoria 1 kbit)",
  0x09: "DS1982 / DS2502 (memoria OTP)",
  0x0a: "DS1995 (memoria 16 kbit)",
  0x0b: "DS1985 / DS2505 (memoria OTP)",
  0x0c: "DS1996 (memoria 64 kbit)",
  0x10: "DS18S20 (sensore di temperatura)",
  0x14: "DS1971 / DS2430A (EEPROM)",
  0x1d: "DS2423 (contatore)",
  0x22: "DS1822 (sensore di temperatura)",
  0x23: "DS1973 / DS2433 (EEPROM 4 kbit)",
  0x26: "DS2438 (monitor batteria)",
  0x28: "DS18B20 (sensore di temperatura)",
  0x29: "DS2408 (8 ingressi/uscite)",
  0x2d: "DS2431 (EEPROM 1 kbit)",
  0x33: "DS1961S / DS2432 (EEPROM con SHA-1)",
  0x3a: "DS2413 (2 ingressi/uscite)",
  0x3b: "MAX31826 (sensore di temperatura)",
  0x41: "DS1923 (registratore di temperatura e umidità)",
});

/** CRC8 Dallas/Maxim (polinomio x^8 + x^5 + x^4 + 1, bit riflessi). */
export function crc8(dati) {
  let crc = 0;
  for (let b of dati) {
    for (let i = 0; i < 8; i++) {
      const mescola = (crc ^ b) & 1;
      crc >>= 1;
      if (mescola) crc ^= 0x8c;
      b >>= 1;
    }
  }
  return crc;
}

const fuoriGamma = () => errorePy("IndexError", "index out of range");

/** Un codice ROM: `grezzi` sono gli 8 byte nell'ordine in cui escono dal bus (famiglia per prima). */
export class Rom {
  constructor(grezzi) {
    this.grezzi = Uint8Array.from(grezzi);
    Object.freeze(this);
  }

  get famiglia() {
    if (!this.grezzi.length) throw fuoriGamma();
    return this.grezzi[0];
  }

  get nomeFamiglia() {
    return FAMIGLIE[this.famiglia] ?? "famiglia sconosciuta";
  }

  /** I 48 bit del numero di serie, dal byte più significativo (byte 6 … 1). */
  get seriale() {
    const out = [];
    for (let i = Math.min(6, this.grezzi.length - 1); i >= 1; i--) out.push(this.grezzi[i]);
    return hexPy(out).toUpperCase();
  }

  get crcOk() {
    if (this.grezzi.length < 8) throw fuoriGamma();
    return crc8(this.grezzi.subarray(0, 7)) === this.grezzi[7];
  }

  /** "01 A2 B3 …": i byte in esadecimale separati da spazi. */
  get testo() {
    return hexPy(this.grezzi, " ").toUpperCase();
  }
}

/** Accetta 16 cifre esadecimali (con o senza spazi, trattini, due punti), famiglia per prima; null se non valide. */
export function analizzaRom(testo) {
  const t = stripPy(Array.from(testo).filter((c) => !" -:\t".includes(c)).join(""));
  if (Array.from(t).length !== 16) return null;
  try {
    return new Rom(fromhexPy(t));
  } catch (e) {
    if (eValueErrorPy(e)) return null;
    throw e;
  }
}

/** Costruisce una ROM da famiglia (0-255) e numero di serie a 48 bit, con il suo CRC8. */
export function creaRom(famiglia, seriale48) {
  const intero = (v) => typeof v === "bigint" || Number.isInteger(v);
  if (!intero(famiglia)) throw errorePy("TypeError", `'${nomeTipoPy(famiglia)}' object cannot be interpreted as an integer`);
  if (famiglia < 0 || famiglia > 255) throw errorePy("ValueError", "bytes must be in range(0, 256)");
  if (!intero(seriale48)) throw errorePy("AttributeError", `'${nomeTipoPy(seriale48)}' object has no attribute 'to_bytes'`);
  const corpo = Uint8Array.from([Number(famiglia), ...interoInByte(seriale48, 6, "little")]);
  return new Rom([...corpo, crc8(corpo)]);
}

// ======================================================================================================
// Aiuti della pagina iButton (da app/tools/ibutton_tools.py): testi, righe della tabella, dati da salvare.
// ======================================================================================================

export const NOTA_COLLEGAMENTO =
  "Collega il lettore iButton al pin 1-Wire del Bridge con una resistenza da 4,7 kΩ verso 5 V (Arduino) o 3,3 V (ESP32), e la massa in comune.";
export const NOTA_ESCLUSIONI = "Emulazione e scrittura di chiavi: non disponibili, per scelta.";

/** Le ROM nella risposta di `ow.search` del Polpo Bridge ({roms: [{rom: "01 …"}, …]}), scartando quelle non valide. */
export function romDaRicerca(risposta) {
  const out = [];
  for (const x of prendiPy(risposta, "roms", [])) {
    if (x === null || typeof x !== "object" || Array.isArray(x)) throw errorePy("AttributeError", `'${nomeTipoPy(x)}' object has no attribute 'get'`);
    const testo = prendiPy(x, "rom", "");
    if (typeof testo !== "string") throw errorePy("TypeError", `'${nomeTipoPy(testo)}' object is not iterable`);
    const rom = analizzaRom(testo);
    if (rom) out.push(rom);
  }
  return out;
}

/** Il messaggio dopo la ricerca. */
export function messaggioRicerca(roms) {
  return roms.length ? `${roms.length} dispositivi 1-Wire trovati.` : "Nessuna chiave: appoggiala al lettore e riprova.";
}

/** Dopo «Cerca chiavi» (risposta di `ow.search`): {roms, righe della tabella, messaggio, attivita (null se nessuna chiave)}. */
export function esitoRicerca(risposta) {
  const roms = romDaRicerca(risposta);
  const righe = roms.map(rigaRom);
  return { roms, righe, messaggio: messaggioRicerca(roms), attivita: roms.length ? "Letta una chiave iButton" : null };
}

/** Il messaggio dopo `ow.reset`. */
export function messaggioPresenza(risposta) {
  return veroPy(prendiPy(risposta, "presence")) ? "Presenza rilevata sul bus." : "Nessun dispositivo sul bus.";
}

/** Una riga della tabella: [ROM, famiglia, numero di serie, CRC8]. */
export function rigaRom(rom) {
  return [rom.testo, `0x${formatIntPy(rom.famiglia, "02X")} · ${rom.nomeFamiglia}`, rom.seriale, rom.crcOk ? "valido" : "ERRATO"];
}

/** Il testo del riquadro «Analizza un codice». */
export function testoAnalisiRom(testo) {
  const rom = analizzaRom(testo);
  if (rom === null) return "Servono 16 cifre esadecimali (8 byte), famiglia per prima.";
  const crc = rom.crcOk ? "valido" : `errato (atteso ${formatIntPy(crc8(rom.grezzi.subarray(0, 7)), "02X")})`;
  return `Famiglia 0x${formatIntPy(rom.famiglia, "02X")}: ${rom.nomeFamiglia}\nNumero di serie: ${rom.seriale}\nCRC8: ${crc}`;
}

/**
 * Il salvataggio nella cassaforte: {nome, dati, testo, meta, messaggio}; `testo` è il JSON da cifrare
 * (come json.dumps(indent=2) di Python). `adesso` è un Date (ora locale).
 */
export function salvataggioRom(rom, adesso) {
  const dati = { rom: rom.testo, famiglia: rom.famiglia, crc_ok: rom.crcOk, letto_il: formattaData("%Y-%m-%d %H:%M", adesso) };
  return { nome: `ibutton-${rom.seriale}.json`, dati, testo: JSON.stringify(dati, null, 2), meta: { rom: rom.testo }, messaggio: "Chiave salvata nella cassaforte." };
}
