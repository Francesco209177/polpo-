// Strumenti per le prove nel browser: un piccolo server per la cartella del sito costruito e l'avvio di Chromium.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Playwright: quello installato per le prove (npm ci) oppure quello già presente sulla macchina.
export const { chromium, devices } = createRequire(import.meta.url)("playwright");

const qui = path.dirname(fileURLToPath(import.meta.url));
export const SITO = path.resolve(process.env.SITO_DIR || path.join(qui, "../../_site"));
if (!fs.existsSync(path.join(SITO, "index.html"))) {
  throw new Error(`Sito non trovato in ${SITO}: costruiscilo con «python site/build.py --out site/_site» o indica SITO_DIR.`);
}
const SITO_PREDEFINITO = SITO;

const TIPI = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".wasm": "application/wasm", ".zip": "application/zip" };

/** Serve il sito (o un'altra cartella costruita) sotto /sito/, come GitHub Pages che lo pubblica in una sottocartella. */
export async function servi(SITO = SITO_PREDEFINITO) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!p.startsWith("/sito/")) { res.writeHead(404).end(); return; }
    let file = path.join(SITO, p.slice(6));
    if (!file.startsWith(SITO)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, dati) => {
      if (err) { res.writeHead(404).end("non trovato"); return; }
      res.writeHead(200, { "content-type": TIPI[path.extname(file)] || "application/octet-stream" }).end(dati);
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}/sito/`;
  return { base, chiudi: () => new Promise((ok) => server.close(ok)) };
}

/** Apre una pagina e raccoglie errori di console e richieste verso altri siti. */
export async function apri(browser, base, percorso, opzioni = {}) {
  const contesto = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opzioni });
  const pagina = await contesto.newPage();
  const problemi = [];
  pagina.on("console", (m) => { if (m.type() === "error") problemi.push("console: " + m.text()); });
  pagina.on("pageerror", (e) => problemi.push("errore: " + e));
  pagina.on("request", (r) => { if (!r.url().startsWith(new URL(base).origin) && !/^(data|blob):/.test(r.url())) problemi.push("richiesta esterna: " + r.url()); });
  pagina.on("requestfailed", (r) => problemi.push("richiesta fallita: " + r.url()));
  await pagina.goto(base + percorso, { waitUntil: "networkidle" });
  return { pagina, contesto, problemi };
}

/** Scrive un file WAV mono a 16 bit. */
export function scriviWav(file, campioni, fs_) {
  const b = Buffer.alloc(44 + 2 * campioni.length);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * campioni.length, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(fs_, 24); b.writeUInt32LE(2 * fs_, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(2 * campioni.length, 40);
  for (let i = 0; i < campioni.length; i++) b.writeInt16LE(Math.round(32767 * Math.max(-1, Math.min(1, campioni[i]))), 44 + 2 * i);
  fs.writeFileSync(file, b);
}
