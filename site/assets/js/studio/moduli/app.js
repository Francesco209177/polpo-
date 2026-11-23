// Modulo «App»: le app integrate di Polpo Studio (convertitore, codici di controllo, costruttore NDEF, tempo radio),
// che funzionano nel telefono senza hardware. Le app di terze parti sono programmi Python: solo nel programma per PC.
import { h, sostituisci, tabella } from "../ui.js";
import * as conv from "../strumenti/convertitore.js";
import * as crc from "../strumenti/crc.js";
import * as ndefApp from "../strumenti/ndef_app.js";
import * as budget from "../protocolli/budget_radio.js";

/** Una piccola app: titolo, descrizione dal suo manifest, contenuto. */
const riquadro = (manifest, ...contenuto) => h("details", { class: "card st-app", dataset: { app: manifest.id } },
  h("summary", {}, h("strong", {}, manifest.name), h("br"), h("span", { class: "small" }, manifest.description)), ...contenuto);

function convertitore() {
  const tipo = h("select", { "aria-label": "Tipo di ingresso" }, conv.TIPI_INGRESSO.map(([k, n]) => h("option", { value: k }, n)));
  const ingresso = h("input", { type: "text", value: conv.ESEMPIO, "aria-label": "Valore da convertire", autocapitalize: "off", spellcheck: "false" });
  const uscita = h("div");
  const aggiorna = () => {
    const r = conv.convertiPerVista(ingresso.value, tipo.value);
    sostituisci(uscita, tabella(["", "Valore"], conv.USCITE.map(([k, n]) => [n, h("code", {}, String(r[k]))])));
  };
  tipo.addEventListener("change", aggiorna);
  ingresso.addEventListener("input", aggiorna);
  aggiorna();
  return riquadro(conv.MANIFEST, h("div", { class: "btn-row" }, tipo), ingresso, uscita);
}

function codiciControllo() {
  const esa = h("input", { type: "checkbox" });
  const ingresso = h("input", { type: "text", value: crc.ESEMPIO, "aria-label": "Dati per i codici di controllo", autocapitalize: "off", spellcheck: "false" });
  const uscita = h("div");
  const aggiorna = () => {
    const r = crc.controlliDaTesto(ingresso.value, esa.checked);
    sostituisci(uscita, tabella(["Codice", "Valore"], Object.entries(r).map(([k, v]) => [k, h("code", {}, String(v))])));
  };
  esa.addEventListener("change", aggiorna);
  ingresso.addEventListener("input", aggiorna);
  aggiorna();
  return riquadro(crc.MANIFEST, h("label", { class: "sim-spunta" }, esa, " I dati sono byte in esadecimale"), ingresso, uscita);
}

function costruttoreNdef() {
  const tipo = h("select", { "aria-label": "Tipo NDEF" }, h("option", { value: "uri" }, "Link"), h("option", { value: "text" }, "Testo"));
  const valore = h("input", { type: "text", value: ndefApp.TESTI_PAGINA.valoreIniziale, "aria-label": "Contenuto NDEF", autocapitalize: "off", spellcheck: "false" });
  const byte = h("code", { class: "st-byte" }), spazio = h("p", { class: "small" });
  const aggiorna = () => {
    try {
      const r = ndefApp.descrivi(tipo.value, valore.value);
      byte.textContent = r.byte;
      spazio.textContent = r.spazio;
    } catch (e) { byte.textContent = ""; spazio.textContent = e.message; }
  };
  tipo.addEventListener("change", aggiorna);
  valore.addEventListener("input", aggiorna);
  aggiorna();
  return riquadro(ndefApp.MANIFEST, h("div", { class: "btn-row" }, tipo), valore, h("p", {}, byte), spazio);
}

function tempoRadio() {
  const campi = budget.CAMPI_STIMA.map((c) => ({ c, el: h("input", { type: "number", min: String(c.min), max: String(c.max), value: String(c.valore), "aria-label": c.etichetta }) }));
  const uscita = h("p");
  const aggiorna = () => {
    const v = campi.map(({ c, el }) => Math.min(c.max, Math.max(c.min, Math.round(Number(el.value) || c.valore))));
    uscita.textContent = budget.testoStima(...v);
  };
  for (const { el } of campi) el.addEventListener("input", aggiorna);
  aggiorna();
  return riquadro(budget.MANIFEST, h("div", { class: "st-campi" }, campi.map(({ c, el }) => h("label", {}, `${c.etichetta}${c.unita ? ` (${c.unita.trim()})` : ""} `, el))), uscita);
}

export function crea(ctx) {
  const integrate = [conv.MANIFEST, crc.MANIFEST, ndefApp.MANIFEST, budget.MANIFEST];
  const el = h("div", { class: "st-griglia" },
    ctx.scheda("apps.catalog",
      tabella(["App", "Cosa fa", "Permessi"], integrate.map((m) => [m.name, m.description, "nessuno: lavora solo sui dati che scrivi"]))),
    ctx.scheda("apps.builtin", convertitore(), codiciControllo(), costruttoreNdef(), tempoRadio()),
    ctx.scheda("apps.third_party"),
  );
  return { id: "app", titolo: "App", el };
}
