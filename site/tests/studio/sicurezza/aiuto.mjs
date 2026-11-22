// Strumenti comuni alle prove della sicurezza di Polpo Studio in JavaScript.
//
// * ArchivioCartella: un archivio (vedi assets/js/studio/sicurezza/archivio.js) sopra una cartella vera, con gli
//   stessi file che scrive Python: serve ad aprire qui le cassaforti create da Polpo Studio e viceversa.
//   È solo per le prove su Node (usa node:fs).
// * python(): esegue py_aiuto.py con l'interprete indicato da POLPO_PYTHON.
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));

export class ArchivioCartella {
  constructor(cartella) {
    this.cartella = path.resolve(cartella);
  }

  _percorso(nome) {
    const parti = typeof nome === "string" ? nome.split("/") : [];
    if (!parti.length || parti.some((p) => p === "" || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) {
      throw new Error(`nome di file non valido: ${nome}`);
    }
    return path.join(this.cartella, ...parti);
  }

  async leggi(nome) {
    try {
      const b = await fs.readFile(this._percorso(nome));
      return new Uint8Array(b.buffer, b.byteOffset, b.length).slice();
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async scrivi(nome, dati) {
    // come _write_atomic di Python: file temporaneo, fsync, rinomina
    const p = this._percorso(nome);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    const f = await fs.open(tmp, "w");
    try {
      await f.writeFile(dati);
      await f.sync();
    } finally {
      await f.close();
    }
    await fs.rename(tmp, p);
  }

  async aggiungi(nome, dati) {
    const p = this._percorso(nome);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, dati);
  }

  async cancella(nome) {
    try {
      await fs.unlink(this._percorso(nome));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }

  async elenco(prefisso = "") {
    const nomi = [];
    const visita = async (cartella, base) => {
      let voci;
      try {
        voci = await fs.readdir(cartella, { withFileTypes: true });
      } catch (e) {
        if (e.code === "ENOENT") return;
        throw e;
      }
      for (const v of voci) {
        const nome = base + v.name;
        if (v.isDirectory()) await visita(path.join(cartella, v.name), nome + "/");
        else if (nome.startsWith(prefisso)) nomi.push(nome);
      }
    };
    await visita(this.cartella, "");
    return nomi.sort();
  }
}

/** Una cartella temporanea nuova; `pulisci()` la cancella. */
export function cartellaTemporanea(nome = "polpo-sicurezza-") {
  const cartella = mkdtempSync(path.join(os.tmpdir(), nome));
  return { cartella, pulisci: () => rmSync(cartella, { recursive: true, force: true }) };
}

// ---------------- Python ----------------

export const PYTHON = process.env.POLPO_PYTHON || "";
export const SENZA_PYTHON = PYTHON
  ? false
  : "POLPO_PYTHON non impostata: prove di compatibilità con Polpo Studio in Python saltate " +
    "(indicare l'interprete con polpo_studio installato, es. POLPO_PYTHON=.venv/bin/python)";

/** Esegue un comando di py_aiuto.py: argomenti e risultato in JSON. */
export function python(comando, argomenti = {}) {
  const r = spawnSync(PYTHON, ["-I", path.join(qui, "py_aiuto.py"), comando], {
    input: JSON.stringify(argomenti),
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`py_aiuto.py ${comando} è uscito con ${r.status}:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------------- piccole utilità ----------------

export const testo = (s) => new TextEncoder().encode(s);
export const base64 = (b) => Buffer.from(b).toString("base64");
export const daBase64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
export const esa = (b) => Buffer.from(b).toString("hex");
