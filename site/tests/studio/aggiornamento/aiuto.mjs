// Strumenti comuni alle prove dell'aggiornamento del firmware.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStubJsonByChipName } from "../../../assets/js/terze-parti/esptool-js-0.7.1/bundle.js";
import { casuale } from "./esp32s3_finto.mjs";

const qui = path.dirname(fileURLToPath(import.meta.url));
export const RADICE = path.resolve(qui, "../../../..");

// Nelle prove nessuna richiesta di rete deve partire (gli stub di esptool-js sono nel suo file, non si scaricano).
for (const nome of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) {
  globalThis[nome] = () => {
    throw new Error(`${nome}: nelle prove dell'aggiornamento non si usa la rete`);
  };
}

export const sha256 = (byte) => createHash("sha256").update(byte).digest("hex");

/** Il programma di scrittura (stub) per l'ESP32-S3 contenuto in esptool-js: il finto controlla che arrivi questo. */
export const STUB_S3 = await getStubJsonByChipName("ESP32-S3");

/** Tempi brevi per le prove. */
export const TEMPI_PROVA = Object.freeze({ tocco: 2000, ricomparsa: 2000, controllo: 20, apertura: 2000, ripartenza: 1500 });

/**
 * Un'immagine di applicazione finta per ESP32-S3: intestazione 0xE9 con chip 9, poi byte un po' comprimibili
 * (come un firmware vero, che si comprime a circa due terzi).
 */
export function immagineProva(n = 150_000, seme = 7) {
  const r = casuale(seme);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = r();
    b[i] = v & 3 ? v >>> 8 : 0; // un quarto di zeri
  }
  b.set([0xe9, 0x06, 0x02, 0x3f], 0);
  b[12] = 9;
  b[13] = 0;
  return b;
}

export const firmwareDi = (dati, extra = {}) => ({ version: "9.9.9-prova", app_file: "prova-app.bin", app_offset: "0x10000", sha256: sha256(dati), ...extra });

/** L'applicazione vera della versione attuale (polpo/release), se c'è e ha l'impronta dell'esempio. */
export function applicazioneVera(firmware) {
  const p = path.join(RADICE, "polpo/release", firmware.app_file);
  if (!fs.existsSync(p)) return null;
  const dati = new Uint8Array(fs.readFileSync(p));
  return sha256(dati) === firmware.sha256 ? dati : null;
}

/** Raccoglie avanzamento e registro di un aggiornamento. */
export function osservatore() {
  const o = { passi: [], righe: [] };
  o.avanzamento = (a) => o.passi.push(a);
  o.log = (riga, livello) => o.righe.push({ riga, livello });
  o.testo = () => o.righe.map((r) => `[${r.livello}] ${r.riga}`).join("\n");
  return o;
}

/** Le chiamate della pagina al ponte, senza le scritture (sono tante). */
export const chiamate = (nativo, nome = null) => nativo.registro.filter((r) => r.chiamata && (nome ? r.chiamata === nome : r.chiamata !== "serialeScrivi"));

/** Aspetta che il ponte finto abbia consegnato gli ultimi eventi e che i timer brevi siano scaduti. */
export const calma = (ms = 300) => new Promise((r) => setTimeout(r, ms));
