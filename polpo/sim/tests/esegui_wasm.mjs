// Esegue un copione sul firmware compilato in WebAssembly, con le stesse righe e la stessa uscita di polpo_host.
// Serve a controllare che il modulo usato nel browser dia esattamente gli stessi risultati della versione per PC:
//   python3 confronta.py "node esegui_wasm.mjs polpo-sim.wasm" prova.copione
import fs from "node:fs";
import { creaPolpo, postoDelTasto } from "../../../site/assets/js/simulatore/firmware.js";

const [, , fileWasm, fileCopione] = process.argv;
if (!fileWasm || !fileCopione) {
  console.error("uso: node esegui_wasm.mjs polpo-sim.wasm copione.txt");
  process.exit(2);
}
const polpo = await creaPolpo(fs.readFileSync(fileWasm), { suTesto: (t) => process.stderr.write(t) });
let acceso = false, errori = 0;
const accendi = () => { if (!acceso) polpo.avvia(); acceso = true; };
const hex8 = (n) => n.toString(16).padStart(8, "0");

function premi(posto, ms) {
  polpo.avanza(polpo.occupato());
  if (posto.maiuscolo) polpo.tasto(2, 1, true);
  polpo.tasto(posto.fila, posto.colonna, true);
  polpo.avanza(ms);
  polpo.tasto(posto.fila, posto.colonna, false);
  if (posto.maiuscolo) polpo.tasto(2, 1, false);
  polpo.avanza(polpo.occupato() + 60);
}
const postoPerNome = (nome) => (["fn", "maiusc", "ctrl", "opt", "alt"].includes(nome) ? null : postoDelTasto(nome));

const righe = fs.readFileSync(fileCopione, "utf8").split("\n");
if (righe.at(-1) === "") righe.pop();
let numero = 0;
function esegui(riga) {
  if (riga === "" || riga.startsWith("#")) return;
  const sp = riga.indexOf(" ");
  const cmd = sp < 0 ? riga : riga.slice(0, sp), resto = sp < 0 ? "" : riga.slice(sp + 1);
  if (cmd === "ripeti") {
    const fine = resto.indexOf(" ");
    const volte = fine < 0 ? 0 : parseInt(resto.slice(0, fine), 10), ripetuta = fine < 0 ? "" : resto.slice(fine + 1);
    if (!(volte > 0) || !ripetuta || ripetuta.startsWith("ripeti ")) { console.log(`riga ${numero}: «ripeti» va scritto come: ripeti <n> <riga>`); errori++; return; }
    for (let i = 0; i < volte; i++) esegui(ripetuta);
    return;
  }
  if (cmd === "carica") {
    console.log(`carica ${!acceso && fs.existsSync(resto) && polpo.statoImporta(fs.readFileSync(resto)) ? "ok" : "ERRORE"}`);
    return;
  }
  if (cmd === "mondo") { console.log(`mondo ${polpo.mondoTesto(resto)}`); return; }
  accendi();
  if (cmd === "script") { console.log(`script ${polpo.scriptTesto(resto)}`); return; }
  if (cmd === "avvia") return;
  if (cmd === "attendi") polpo.avanza(parseInt(resto, 10) || 0);
  else if (cmd === "tasto") {
    const p = postoPerNome(resto);
    if (resto === "g0") { polpo.g0(); polpo.avanza(120); }
    else if (p) premi(p, 60);
    else { console.log(`riga ${numero}: tasto sconosciuto «${resto}»`); errori++; }
  } else if (cmd === "tieni") {
    const [nome, ms] = resto.split(/\s+/);
    const p = postoPerNome(nome);
    if (p) premi(p, parseInt(ms, 10) || 0);
    else { console.log(`riga ${numero}: tasto sconosciuto «${nome}»`); errori++; }
  } else if (cmd === "scrivi") {
    for (const c of resto) {
      const p = postoPerNome(c);
      if (p) premi(p, 60);
      else { console.log(`riga ${numero}: carattere non presente sulla tastiera «${c}»`); errori++; }
    }
  } else if (cmd === "seriale") {
    polpo.serialeScrivi(resto + "\n");
    polpo.avanza(100);
    for (const r of polpo.serialeLeggi().split("\n")) if (r) console.log(`< ${r}`);
  } else if (cmd === "schermo") {
    console.log(`schermo ${resto} ${hex8(polpo.impronta())}`);
  } else if (cmd === "eventi") {
    for (let e; (e = polpo.eventoTesto()) !== null; ) console.log(`evento ${e}`);
  } else if (cmd === "conta") {
    const quanti = new Map();
    for (let e; (e = polpo.evento()) !== null; ) quanti.set(e.tipo ?? "?", (quanti.get(e.tipo ?? "?") ?? 0) + 1);
    console.log(["conta", ...[...quanti].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`)].join(" "));
  } else if (cmd === "stato") {
    const dati = polpo.statoEsporta();
    fs.writeFileSync(resto, dati);
    console.log(`stato ${dati.length} byte`);
  } else { console.log(`riga ${numero}: comando sconosciuto «${cmd}»`); errori++; }
}
for (const riga of righe) { numero++; esegui(riga); }
process.exit(errori ? 1 : 0);
