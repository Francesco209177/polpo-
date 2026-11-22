// Piccoli strumenti per costruire le schede di Studio senza librerie.

import { ETICHETTA, CLASSE } from "./catalogo.js";

/** Crea un elemento: h("button", {class: "btn", onclick}, "testo", altroElemento). */
export function h(tag, attributi = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const f of figli.flat()) if (f !== null && f !== undefined && f !== false) el.append(f instanceof Node ? f : String(f));
  return el;
}

/** Distintivo con la parola dello stato (mai solo il colore). */
export function distintivo(stato) {
  return h("span", { class: `badge ${CLASSE[stato] || ""}` }, ETICHETTA[stato] || stato);
}

/** Data e ora brevi, in italiano. */
export function quando(ts = Date.now() / 1000) {
  return new Date(ts * 1000).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Dimensione leggibile. */
export function dimensione(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Una tabella semplice: intestazioni e righe di celle (testo o elementi). */
export function tabella(intestazioni, righe) {
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, intestazioni.map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, righe.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));
}

/** Svuota un elemento e ci mette dentro i figli. */
export function sostituisci(el, ...figli) {
  el.replaceChildren(...figli.flat().filter((f) => f !== null && f !== undefined && f !== false));
  return el;
}
