// Modulo «NFC»: lettura di tag NTAG/Ultralight con il modulo RFID2 del Polpo e loro analisi, analizzatore NDEF,
// archivio delle letture (nella cassaforte) e scrittura NDEF su tag TUOI: modalità laboratorio, una conferma qui e una
// sullo schermo del Polpo. Niente emulazione di carte né copie di badge. Come in Polpo Studio per PC.
import { h, sostituisci } from "../ui.js";
import { cassaforteAperta, utf8, testo } from "../comune.js";
import { ascoltaNativo } from "../link/trasporti.js";
import {
  TESTI_PAGINA, LINGUA_MAX, esitoLettura, rendiLettura, analizzaNdefEsadecimale, testoSpazio, preparaScrittura, esitoScrittura,
  salvataggioLettura, rigaArchivio, reportLetture, vociArchivio,
} from "../strumenti/ndef_app.js";

/** L'HTML viene dalle funzioni di analisi, che fanno l'escape di ogni testo letto dal tag. */
const mostraHtml = (el, html) => { el.innerHTML = html; };

export function crea(ctx) {
  let carta = null, cartaSim = false;
  const vista = h("div", { class: "st-nfc" });
  mostraHtml(vista, TESTI_PAGINA.iniziale);
  const tipo = h("select", { "aria-label": "Tipo" }, h("option", { value: "uri" }, "Link"), h("option", { value: "text" }, "Testo"));
  const valore = h("input", { type: "text", value: TESTI_PAGINA.valoreIniziale, "aria-label": "Contenuto", autocapitalize: "off", spellcheck: "false" });
  const lingua = h("input", { type: "text", value: "it", maxlength: String(LINGUA_MAX), size: "5", "aria-label": "Lingua (solo testo)" });
  const spazio = h("p", { class: "small" });
  const aggiornaSpazio = () => { try { spazio.textContent = testoSpazio(tipo.value, valore.value, lingua.value); } catch (e) { spazio.textContent = e.message; } };
  for (const x of [tipo, valore, lingua]) x.addEventListener("input", aggiornaSpazio);
  const esa = h("textarea", { rows: "3", placeholder: TESTI_PAGINA.esempioAnalizzatore, "aria-label": "Byte in esadecimale" });
  const esaOut = h("div");
  const arch = h("ul", { class: "st-righe" });
  let scelta = null;

  const leggi = async () => {
    try {
      const d = await ctx.richiesta("nfc.read");
      const r = esitoLettura(d, ctx.simulato);
      carta = d;
      cartaSim = r.simulato;
      mostraHtml(vista, r.html);
      ctx.avvisa(r.messaggio, d.present ? "ok" : "info");
      if (r.attivita) ctx.registro.aggiungi("nfc", r.attivita, "ok", r.simulato);
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  // ---- l'NFC del telefono: stessa analisi, dati veri del tag appoggiato al telefono ----
  const nativo = globalThis.PolpoNativo;
  let attesaTelefono = null; // "lettura" | "scrittura"
  let fineAttesa = null;
  const fermaTelefono = () => {
    clearTimeout(fineAttesa);
    if (attesaTelefono === "lettura" && nativo && nativo.nfcFerma) nativo.nfcFerma();
    attesaTelefono = null;
  };
  ascoltaNativo((ev) => {
    if (ev.tipo === "nfc.tag" && attesaTelefono === "lettura") {
      fermaTelefono();
      const r = esitoLettura(ev.carta || {}, false);
      carta = ev.carta;
      cartaSim = false;
      mostraHtml(vista, r.html);
      ctx.avvisa(r.messaggio + " (NFC del telefono)", "ok");
      if (r.attivita) ctx.registro.aggiungi("nfc", r.attivita + " con il telefono", "ok", false);
    } else if (ev.tipo === "nfc.scritto" && attesaTelefono === "scrittura") {
      fermaTelefono();
      const r = esitoScrittura(ev, false);
      ctx.avvisa(r.messaggio + " (NFC del telefono)", "ok");
      ctx.registro.aggiungi("nfc", r.attivita + " con il telefono", "avviso", false);
    } else if (ev.tipo === "nfc.errore" && attesaTelefono) {
      fermaTelefono();
      ctx.avvisa(ev.messaggio || "Errore NFC.", "errore");
    }
  });
  const leggiTelefono = () => {
    if (!nativo || !nativo.nfcAvvia) { ctx.avvisa("L'NFC del telefono si usa dall'app per Android.", "errore"); return; }
    ctx.avvisa("Appoggia il tag sul retro del telefono (dove c'è l'antenna NFC)…");
    attesaTelefono = "lettura";
    clearTimeout(fineAttesa);
    if (!nativo.nfcAvvia()) {
      // il motivo arriva con «nfc.errore»
      fineAttesa = setTimeout(() => { if (attesaTelefono === "lettura") { attesaTelefono = null; ctx.avvisa("L'NFC del telefono non è disponibile: è acceso?", "errore"); } }, 3000);
      return;
    }
    fineAttesa = setTimeout(() => { if (attesaTelefono === "lettura") { fermaTelefono(); ctx.avvisa("Nessun tag appoggiato al telefono."); } }, 30000);
  };
  const scriviTelefono = () => {
    const p = preparaScrittura(tipo.value, valore.value, lingua.value);
    if (!p.ok) { ctx.avvisa(p.errore, "errore"); return; }
    if (!ctx.richiediLaboratorio(p.azioneLaboratorio)) return;
    if (!confirm(`${p.titoloConferma}\n\nContenuto: ${p.args.value}\nDopo la conferma appoggia il TUO tag sul retro del telefono entro 20 secondi.`)) return;
    if (!nativo || !nativo.nfcScrivi) { ctx.avvisa("L'NFC del telefono si usa dall'app per Android.", "errore"); return; }
    ctx.avvisa("Appoggia il tag sul retro del telefono…");
    attesaTelefono = "scrittura";
    clearTimeout(fineAttesa);
    if (!nativo.nfcScrivi(JSON.stringify(p.args))) {
      // rifiutata subito: il motivo arriva con «nfc.errore» (android/PONTE.md)
      fineAttesa = setTimeout(() => { if (attesaTelefono === "scrittura") { attesaTelefono = null; ctx.avvisa("La scrittura con il telefono non è partita: l'NFC è acceso?", "errore"); } }, 3000);
      return;
    }
    fineAttesa = setTimeout(() => { if (attesaTelefono === "scrittura") { attesaTelefono = null; ctx.avvisa("Nessun tag appoggiato: niente è stato scritto.", "avviso"); } }, 21000);
  };
  const conTelefono = () => !!(ctx.hw["telefono.nfc"] && ctx.hw["telefono.nfc"].presenza === "rilevato");
  const bottoniTelefono = [];
  ctx.suAggiornamento(() => { for (const b of bottoniTelefono) b.hidden = !conTelefono(); });

  const salva = async () => {
    const c = cassaforteAperta(ctx);
    if (!c) return;
    const s = salvataggioLettura(carta, cartaSim, new Date());
    if (!s.ok) { ctx.avvisa(s.errore, "errore"); return; }
    await c.aggiungi("nfc", s.nome, utf8(s.testo), { origine: s.origine, meta: s.meta });
    ctx.avvisa(s.messaggio, "ok");
    disegnaArchivio();
  };
  const scrivi = async () => {
    const p = preparaScrittura(tipo.value, valore.value, lingua.value);
    if (!p.ok) { ctx.avvisa(p.errore, "errore"); return; }
    if (!ctx.collegato()) { ctx.avvisa("Collega prima un Polpo.", "errore"); return; }
    if (!ctx.richiediLaboratorio(p.azioneLaboratorio)) return;
    if (!confirm(`${p.titoloConferma}\n\n${p.testoConferma}`)) return;
    ctx.avvisa(p.messaggioAttesa);
    try {
      const d = await ctx.richiesta(p.comando, p.args, p.timeout * 1000);
      const r = esitoScrittura(d, ctx.simulato);
      ctx.avvisa(r.messaggio, "ok");
      ctx.registro.aggiungi("nfc", r.attivita, "avviso", ctx.simulato);
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  async function voci(c) {
    const out = [];
    for (const v of vociArchivio(c.voci("nfc"))) {
      let dati = null;
      try { dati = JSON.parse(testo(await c.leggi(v.id))); } catch { /* lettura non valida */ }
      out.push({ ...v, nome: v.nome, simulato: v.simulato, meta: v.meta || {}, carta: dati || {} });
    }
    return out;
  }
  async function disegnaArchivio() {
    const c = cassaforteAperta(ctx, false);
    if (!c) { sostituisci(arch, h("li", { class: "small" }, "La cassaforte è chiusa: aprila nel modulo Sicurezza.")); return; }
    const vs = await voci(c);
    sostituisci(arch, vs.length ? vs.map((v) => {
      const [nome, uid, modello, origine] = rigaArchivio(v);
      return h("li", {}, h("label", { class: "sim-spunta" }, h("input", { type: "radio", name: "st-nfc-voce", checked: scelta === v.id, onchange: () => { scelta = v.id; } }),
        h("strong", {}, nome)), h("span", { class: "small" }, ` ${uid} · ${modello || "—"} · ${origine}`));
    }) : [h("li", { class: "small" }, "Nessuna lettura salvata.")]);
  }
  ctx.suAggiornamento(() => { if (!arch.closest("[hidden]")) disegnaArchivio(); });
  aggiornaSpazio();
  const btn = (t, f, cls = "btn btn-ghost") => h("button", { type: "button", class: cls, onclick: f }, t);

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("nfc.read", h("div", { class: "btn-row" }, btn("Leggi dal Polpo", leggi, "btn btn-studio"),
      (() => { const b = btn("Leggi con il telefono", leggiTelefono, "btn btn-studio"); b.hidden = true; bottoniTelefono.push(b); return b; })(),
      btn("Salva la lettura", salva)), vista),
    ctx.scheda("nfc.detect"), ctx.scheda("nfc.analysis", h("p", { class: "small" }, "L'analisi compare sotto la lettura: modello, spazio, blocchi, contenuto NDEF.")),
    ctx.scheda("nfc.ndef", h("p", { class: "small" }, TESTI_PAGINA.analizzatore), esa,
      btn("Analizza", () => { const r = analizzaNdefEsadecimale(esa.value); mostraHtml(esaOut, r.html); }), esaOut),
    ctx.scheda("nfc.write", h("p", { class: "small" }, TESTI_PAGINA.scrittura),
      h("div", { class: "btn-row" }, tipo, lingua), valore, spazio,
      h("div", { class: "btn-row" }, btn("Scrivi sul tag…", scrivi, "btn btn-studio"),
        (() => { const b = btn("Scrivi con il telefono…", scriviTelefono); b.hidden = true; bottoniTelefono.push(b); return b; })())),
    ctx.scheda("nfc.archive", arch, h("div", { class: "btn-row" },
      btn("Apri l'analisi", async () => {
        const c = cassaforteAperta(ctx); if (!c) return;
        const v = (await voci(c)).find((x) => x.id === scelta);
        if (!v) { ctx.avvisa(TESTI_PAGINA.selezionaLettura, "errore"); return; }
        mostraHtml(vista, rendiLettura(v.carta, v.simulato));
        vista.scrollIntoView({ block: "nearest" });
      }),
      btn("Report…", async () => {
        const c = cassaforteAperta(ctx); if (!c) return;
        ctx.salvaFile(new Blob([reportLetture(await voci(c))], { type: "text/html" }), "report-nfc.html");
        ctx.avvisa("Report salvato (non cifrato).", "ok");
      }))),
    ctx.scheda("nfc.emulate"), ctx.scheda("nfc.crack"),
  );
  addEventListener("pagehide", fermaTelefono);
  return { id: "nfc", titolo: "NFC", el, mostrato: disegnaArchivio };
}
