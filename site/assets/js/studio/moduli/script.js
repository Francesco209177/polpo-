// Modulo «Script»: scrivere un programma PolpoScript, copiarlo sul Polpo, controllarlo ed eseguirlo, anche una riga
// alla volta guardando le variabili. Stesse regole di Polpo Studio per PC: l'avvio chiede conferma sullo schermo del
// Polpo, uno script non può trasmettere nulla.
import { h, sostituisci, tabella } from "../ui.js";

const CARTELLA = "/polpo/script";
const NOME = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_SORGENTE = 16 * 1024; // come il firmware
const ESEMPIO = 'scrivi("Ciao!")\nper i da 1 a 5\n  scrivi(i, "per", i, "fa", i * i)\nfine\n';
const BOZZA = "polpo-studio-script-bozza-v1";
const enc = new TextEncoder();

export function crea(ctx) {
  const sim = () => (ctx.simulato ? " (SIMULATO)" : "");
  const nome = h("input", { type: "text", value: "prova", autocapitalize: "off", spellcheck: "false", "aria-label": "Nome del programma" });
  const testo = h("textarea", { rows: "12", spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": "Il programma" });
  const elenco = h("select", { "aria-label": "Programmi sul Polpo" });
  const statoEl = h("p", { class: "small", role: "status", "aria-live": "polite" });
  const uscita = h("textarea", { rows: "5", readonly: true, "aria-label": "Ciò che il programma scrive", placeholder: "Qui compaiono le righe scritte con scrivi()." });
  const variabili = h("div");
  const b = {
    controlla: h("button", { type: "button", class: "btn btn-ghost" }, "Controlla"),
    esegui: h("button", { type: "button", class: "btn btn-studio" }, "Esegui sul Polpo"),
    passo: h("button", { type: "button", class: "btn btn-ghost" }, "Una riga alla volta"),
    riprendi: h("button", { type: "button", class: "btn btn-ghost", hidden: true }, "Riprendi"),
    ferma: h("button", { type: "button", class: "btn btn-ghost", disabled: true }, "Ferma"),
  };
  try { testo.value = localStorage.getItem(BOZZA) ?? ESEMPIO; } catch { testo.value = ESEMPIO; }
  testo.addEventListener("input", () => { try { localStorage.setItem(BOZZA, testo.value); } catch { /* pazienza */ } });

  let aperto = false, inPausa = false, visto = "";
  const pulsanti = () => {
    b.ferma.disabled = !aperto;
    b.riprendi.hidden = !inPausa;
    b.passo.textContent = inPausa ? "Riga successiva" : "Una riga alla volta";
  };
  const di = (t, livello = "info") => { statoEl.textContent = t; statoEl.dataset.livello = livello; };

  const percorso = () => {
    let n = nome.value.trim();
    if (n.toLowerCase().endsWith(".polpo")) n = n.slice(0, -6);
    if (!NOME.test(n)) { di("Il nome può avere solo lettere senza accenti, cifre, «_» e «-» (al massimo 40).", "errore"); return null; }
    return `${CARTELLA}/${n}.polpo`;
  };
  const sorgente = () => {
    let t = testo.value;
    if (!t.endsWith("\n")) t += "\n";
    const dati = enc.encode(t);
    if (dati.length > MAX_SORGENTE) { di("Il programma è troppo lungo (al massimo 16.000 caratteri).", "errore"); return null; }
    return dati;
  };
  const mostraControllo = (r) => {
    if (r.valid) return true;
    const riga = Number(r.line || 0);
    di((riga ? `Riga ${riga}: ` : "") + (r.message || "errore"), "errore");
    return false;
  };
  const copiaEControlla = async (p, dati) => {
    await ctx.client.scriviFile(p, dati);
    return ctx.richiesta("script.check", { file: p });
  };

  b.controlla.addEventListener("click", async () => {
    const p = percorso(), dati = sorgente();
    if (!p || !dati) return;
    try {
      di("Copio il programma sul Polpo…");
      if (mostraControllo(await copiaEControlla(p, dati))) di(`Nessun errore: il programma è scritto bene${sim()}.`, "ok");
    } catch (e) { di(ctx.testoErrore(e), "errore"); }
  });

  const esegui = async (pausa) => {
    const p = percorso(), dati = sorgente();
    if (!p || !dati) return;
    try {
      di("Copio il programma sul Polpo…");
      const r = await copiaEControlla(p, dati);
      if (!mostraControllo(r)) return;
      const st = await ctx.richiesta("script.state");
      if (["running", "waiting", "paused"].includes(st.state)) {
        // uno alla volta: quello di prima si ferma, e si aspetta che il Polpo lo abbia chiuso
        await ctx.richiesta("script.stop");
        const fine = Date.now() + 3000;
        while ((await ctx.richiesta("script.state")).state !== "none" && Date.now() < fine) await new Promise((r2) => setTimeout(r2, 50));
      }
      visto = "";
      aperto = inPausa = false;
      uscita.value = "";
      sostituisci(variabili);
      pulsanti();
      di("Chiedo di avviarlo: conferma sullo schermo del Polpo.");
      await ctx.richiesta("script.run", { file: p, paused: pausa }, 35000);
      ctx.registro.aggiungi("script", `Script avviato: ${p.slice(p.lastIndexOf("/") + 1)}`, "info", ctx.simulato);
      if (visto) return; // già fermo su una riga o già finito
      aperto = true;
      pulsanti();
      di((pausa ? "Pronto: una riga alla volta." : "In esecuzione sul Polpo.") + sim());
    } catch (e) { di(ctx.testoErrore(e), "errore"); }
  };
  b.esegui.addEventListener("click", () => esegui(false));
  b.passo.addEventListener("click", () => {
    if (inPausa) ctx.richiesta("script.step", { mode: "into" }).catch((e) => di(ctx.testoErrore(e), "errore"));
    else esegui(true);
  });
  b.riprendi.addEventListener("click", async () => {
    try {
      await ctx.richiesta("script.resume");
      if (visto === "end") return;
      inPausa = false;
      sostituisci(variabili);
      pulsanti();
      di("In esecuzione sul Polpo." + sim());
    } catch (e) { di(ctx.testoErrore(e), "errore"); }
  });
  b.ferma.addEventListener("click", () => ctx.richiesta("script.stop").catch((e) => di(ctx.testoErrore(e), "errore")));

  ctx.suEvento("script.print", (d) => {
    if (d.dropped) uscita.value += `(… ${d.dropped} righe non mostrate: il programma scriveva troppo in fretta)\n`;
    uscita.value += `${d.text ?? ""}\n`;
    uscita.scrollTop = uscita.scrollHeight;
  });
  ctx.suEvento("script.paused", async (d) => {
    visto = "paused";
    aperto = inPausa = true;
    pulsanti();
    try {
      const s = await ctx.richiesta("script.state", { vars: true });
      sostituisci(variabili, (s.vars || []).length ? tabella(["Variabile", "Valore"], s.vars.map((v) => [v.name + (v.local ? " (locale)" : ""), String(v.value)])) : null);
      const pila = s.stack || [];
      di(`Fermo alla riga ${s.line ?? d.line}${pila.length > 1 ? ` (dentro «${pila[0].function}»)` : ""}${sim()}`);
    } catch (e) { di(ctx.testoErrore(e), "errore"); }
  });
  ctx.suEvento("script.end", (d) => {
    visto = "end";
    aperto = inPausa = false;
    sostituisci(variabili);
    pulsanti();
    if (d.error) {
      di(d.error, "errore");
      ctx.registro.aggiungi("script", `Script fermato da un errore: ${d.error}`, "errore", ctx.simulato);
    } else di((d.stopped ? "Programma fermato." : "Programma finito.") + sim(), "ok");
  });

  const aggiornaElenco = async () => {
    try {
      const d = await ctx.richiesta("fs.list", { path: CARTELLA });
      const nomi = (d.entries || []).filter((e) => !e.dir && e.name.endsWith(".polpo")).map((e) => e.name).sort();
      sostituisci(elenco, nomi.map((n) => h("option", { value: n }, n)));
      di(`Programmi sul Polpo: ${nomi.length}${sim()}`);
    } catch (e) { di(ctx.testoErrore(e), "errore"); }
  };
  const apri = async () => {
    const n = elenco.value;
    if (!n) { di("Scegli prima un programma (Aggiorna l'elenco).", "errore"); return; }
    try {
      const dati = await ctx.client.leggiFile(`${CARTELLA}/${n}`);
      testo.value = new TextDecoder("utf-8", { fatal: true }).decode(dati).replace(/^﻿/, "");
      nome.value = n.replace(/\.polpo$/, "");
      di(`Aperto ${n} dal Polpo${sim()}.`);
    } catch (e) { di(e instanceof TypeError ? "Il file non è un testo (UTF-8)." : ctx.testoErrore(e), "errore"); }
  };
  pulsanti();

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("script.files",
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: aggiornaElenco }, "Aggiorna l'elenco"), elenco,
        h("button", { type: "button", class: "btn btn-ghost", onclick: apri }, "Apri"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => { testo.value = ESEMPIO; nome.value = "prova"; uscita.value = ""; } }, "Nuovo")),
      h("label", {}, "Nome ", nome), testo),
    ctx.scheda("script.run",
      h("div", { class: "btn-row" }, b.controlla, b.esegui, b.passo, b.riprendi, b.ferma),
      statoEl, uscita, variabili,
      h("p", { class: "small" }, "I tasti del programma si premono sul Polpo (con il Polpo virtuale: sui suoi tasti qui sopra). La guida completa è il ", h("a", { href: "../documentazione/polposcript.html" }, "manuale di PolpoScript"), ".")),
    ctx.scheda("script.transmit"),
  );
  return { id: "script", titolo: "Script", el };
}
