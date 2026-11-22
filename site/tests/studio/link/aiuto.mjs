// Strumenti per le prove del collegamento: un Polpo finto scritto qui (per i casi difficili da ottenere) e il
// firmware vero in WebAssembly (per tutto il resto).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { creaPolpo, postoDelTasto } from "../../../assets/js/simulatore/firmware.js";

const qui = path.dirname(fileURLToPath(import.meta.url));
export const RADICE = path.resolve(qui, "../../../..");

/** Il file del firmware per il browser: POLPO_SIM_WASM, oppure quello del sito costruito in site/_site. */
export function percorsoWasm() {
  for (const p of [process.env.POLPO_SIM_WASM, path.join(RADICE, "site/_site/simulatore/polpo-sim.wasm")]) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

/** Avvia il firmware vero, già acceso e sulla scrivania. */
export async function polpoVero() {
  const polpo = await creaPolpo(fs.readFileSync(percorsoWasm()));
  polpo.avvia();
  polpo.avanza(600);
  return polpo;
}

/** Preme e rilascia un tasto del Polpo (per nome: «ok», «destra», …), lasciando al firmware il tempo di vederlo. */
export async function premi(polpo, nome) {
  const t = postoDelTasto(nome);
  polpo.tasto(t.fila, t.colonna, true);
  await attendi(90);
  polpo.tasto(t.fila, t.colonna, false);
  await attendi(90);
}

/**
 * Un Polpo finto, in memoria: risponde ai comandi più semplici. `regole` cambia il comportamento:
 *   occupato: quante risposte «busy» dare prima di eseguire; muto: comandi a cui non risponde;
 *   rovinaBlocchi: quanti blocchi di fs.read mandare con il CRC sbagliato.
 */
export class TrasportoFinto {
  constructor(regole = {}) {
    this.regole = { occupato: 0, muto: [], rovinaBlocchi: 0, ...regole };
    this.simulato = true;
    this.nome = "finto";
    this.file = new Map();
    this.ricevute = [];
    this.sessione = false;
    this._suRiga = null;
    this._suChiusura = null;
  }

  async apri(suRiga, suChiusura) {
    this._suRiga = suRiga;
    this._suChiusura = suChiusura;
  }

  async chiudi() {
    this._suRiga = null;
  }

  manda(oggetto) {
    setTimeout(() => this._suRiga && this._suRiga(JSON.stringify(oggetto)), 1);
  }

  scollega() {
    const f = this._suChiusura;
    this._suRiga = null;
    if (f) f("scollegato");
  }

  scriviRiga(riga) {
    const req = JSON.parse(new TextDecoder().decode(riga));
    this.ricevute.push(req);
    const { id, cmd, args = {} } = req;
    if (this.regole.muto.includes(cmd)) return;
    const ok = (data = {}) => this.manda({ id, ok: true, data });
    const no = (code, msg) => this.manda({ id, ok: false, error: { code, msg } });
    if (cmd === "ping") return ok({ pong: true, proto: this.regole.proto ?? 1 });
    if (this.regole.occupato > 0) { this.regole.occupato--; return no("busy", "un'altra richiesta è in corso"); }
    if (cmd === "hello") { this.sessione = true; return ok({ proto: 1, firmware: "finto", board: "finto" }); }
    if (!this.sessione) return no("not_connected", "collegamento non accettato sul Polpo: invia hello");
    if (cmd === "info") return ok({ proto: 1, board: "finto" });
    if (cmd === "bye") { this.sessione = false; return ok(); }
    if (cmd === "fs.write") {
      const prima = args.offset === 0 ? new Uint8Array(0) : this.file.get(args.path) ?? new Uint8Array(0);
      const nuovo = Uint8Array.from(Buffer.from(args.data, "base64"));
      const tutto = new Uint8Array(prima.length + nuovo.length);
      tutto.set(prima); tutto.set(nuovo, prima.length);
      this.file.set(args.path, tutto);
      return ok({ written: nuovo.length });
    }
    if (cmd === "fs.read") {
      const f = this.file.get(args.path);
      if (!f) return no("io_error", "file non trovato");
      const b = f.subarray(args.offset, args.offset + args.len);
      let crc = crc32Node(b);
      if (this.regole.rovinaBlocchi > 0) { this.regole.rovinaBlocchi--; crc ^= 1; }
      return ok({ size: f.length, offset: args.offset, data: Buffer.from(b).toString("base64"), crc32: crc, eof: args.offset + b.length >= f.length });
    }
    return no("unknown_cmd", "comando sconosciuto");
  }
}

import zlib from "node:zlib";
export const crc32Node = (b) => zlib.crc32(Buffer.from(b));
