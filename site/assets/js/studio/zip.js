// Un archivio .zip semplice (file non compressi), per scaricare in un colpo la microSD del Polpo.
import { crc32 } from "./link/proto.js";

const enc = new TextEncoder();

/** @param {{nome: string, dati: Uint8Array}[]} file  @returns {Blob} */
export function creaZip(file) {
  const parti = [], centrale = [];
  let posizione = 0;
  for (const f of file) {
    const nome = enc.encode(f.nome), crc = crc32(f.dati), n = f.dati.length;
    const locale = new DataView(new ArrayBuffer(30));
    locale.setUint32(0, 0x04034b50, true);
    locale.setUint16(4, 20, true);
    locale.setUint16(6, 0x0800, true); // nomi in UTF-8
    locale.setUint32(14, crc, true);
    locale.setUint32(18, n, true);
    locale.setUint32(22, n, true);
    locale.setUint16(26, nome.length, true);
    parti.push(new Uint8Array(locale.buffer), nome, f.dati);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, n, true);
    c.setUint32(24, n, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, posizione, true);
    centrale.push(new Uint8Array(c.buffer), nome);
    posizione += 30 + nome.length + n;
  }
  const dimCentrale = centrale.reduce((s, p) => s + p.length, 0);
  const fine = new DataView(new ArrayBuffer(22));
  fine.setUint32(0, 0x06054b50, true);
  fine.setUint16(8, file.length, true);
  fine.setUint16(10, file.length, true);
  fine.setUint32(12, dimCentrale, true);
  fine.setUint32(16, posizione, true);
  return new Blob([...parti, ...centrale, new Uint8Array(fine.buffer)], { type: "application/zip" });
}
