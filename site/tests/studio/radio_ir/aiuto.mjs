// Aiuti per le prove di parità radio/infrarossi: lettura dei casi generati da Python e conversioni
// tra gli oggetti JavaScript (nomi italiani) e la forma dei dataclass Python registrata nei file JSON.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Segnale, FileIr } from "../../../assets/js/studio/protocolli/ir.js";
import { CodiceRc, FileSub, PRESET_PREDEFINITO } from "../../../assets/js/studio/protocolli/subghz.js";

const CASI = new URL("../casi/radio_ir/", import.meta.url);

/** Valori speciali scritti da genera_radio_ir.py: interi grandi, float non finiti, testi con surrogati, byte. */
export function dec(x) {
  if (Array.isArray(x)) return x.map(dec);
  if (x === null || typeof x !== "object") return x;
  if ("$int" in x) {
    const s = x.$int;
    return s.startsWith("-") ? -BigInt(s.slice(1)) : BigInt(s);
  }
  if ("$float" in x) return { nan: NaN, inf: Infinity, "-inf": -Infinity }[x.$float];
  if ("$u16" in x) return String.fromCharCode(...x.$u16);
  if ("$bytes" in x) return [...x.$bytes];
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, dec(v)]));
}

/** I casi di un file (già decodificati). */
export function casi(nome) {
  return dec(JSON.parse(readFileSync(new URL(nome, CASI), "utf8")));
}

const breve = (x) => {
  const s = JSON.stringify(x, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
  return s === undefined ? String(x) : s.length > 300 ? s.slice(0, 300) + "…" : s;
};

/** Controlla ogni caso `{in, out}` o `{in, err}`: stesso risultato, oppure stessa eccezione e stesso messaggio. */
export function verificaCasi(elenco, fn, etichetta) {
  assert.ok(elenco.length > 0, `${etichetta}: nessun caso`);
  for (const c of elenco) {
    const dove = `${etichetta} ${breve(c.in)}`;
    if ("err" in c) {
      assert.throws(
        () => fn(c.in),
        (e) => {
          assert.equal(e.tipo, c.err.tipo, `${dove}: tipo (${e.name}: ${e.message})`);
          assert.equal(e.message, c.err.msg, `${dove}: messaggio`);
          return true;
        },
        `${dove}: doveva lanciare ${c.err.tipo}`,
      );
    } else {
      let r;
      try {
        r = fn(c.in);
      } catch (e) {
        assert.fail(`${dove}: ha lanciato ${e.tipo ?? e.name}: ${e.message}`);
      }
      assert.deepStrictEqual(r, c.out, dove);
    }
  }
  return elenco.length;
}

// ---------------- da JavaScript alla forma Python ----------------

export const daDoc = (d) => ({ filetype: d.tipoFile, version: d.versione, lines: d.righe });

export const daSegnale = (s) => ({
  name: s.nome,
  raw: s.raw,
  protocol: s.protocollo,
  address: s.indirizzo,
  command: s.comando,
  frequency: s.frequenza,
  duty: s.duty,
  timings: [...s.tempi],
});

export const daFileIr = (f) => ({ filetype: f.tipoFile, signals: f.segnali.map(daSegnale), warnings: [...f.avvisi] });

export const daProtocollo = (p) => ({ name: p.nome, address_bits: p.bitIndirizzo, command_bits: p.bitComando, frequency: p.frequenza });

export const daCodiceLibreria = (c) => ({
  category: c.categoria,
  brand: c.marca,
  button: c.tasto,
  protocol: c.protocollo,
  address: c.indirizzo,
  command: c.comando,
});

export const daCodice = (c) => ({ protocol: c.protocollo, bits: c.bit, value: c.valore, pulse_us: c.impulsoUs });

export const daFileSub = (f) => ({
  frequency: f.frequenza,
  preset: f.preset,
  raw: f.raw,
  code: daCodice(f.codice),
  raw_timings: [...f.tempiRaw],
  in_band: f.inBanda,
});

export const daStatistiche = (st) => ({
  count: st.conteggio,
  min_us: st.minUs,
  max_us: st.maxUs,
  short_us: st.breveUs,
  long_us: st.lungoUs,
  ratio: st.rapporto,
  clusters: st.gruppi,
});

// ---------------- dalla forma Python a JavaScript ----------------

export const aSegnale = (d) =>
  new Segnale(d.name, {
    raw: d.raw ?? false,
    protocollo: d.protocol ?? "",
    indirizzo: d.address ?? 0,
    comando: d.command ?? 0,
    frequenza: d.frequency ?? 38000,
    duty: d.duty ?? 0.33,
    tempi: [...(d.timings ?? [])],
  });

export const aFileIr = (d) => new FileIr(d.filetype, d.signals.map(aSegnale));

export const aCodice = (d) => new CodiceRc(d.protocol ?? 1, d.bits ?? 24, d.value ?? 0, d.pulse_us ?? 350);

export const aFileSub = (d) =>
  new FileSub({
    frequenza: d.frequency ?? 433_920_000,
    preset: d.preset ?? PRESET_PREDEFINITO,
    raw: d.raw ?? false,
    codice: aCodice(d.code ?? {}),
    tempiRaw: [...(d.raw_timings ?? [])],
  });
