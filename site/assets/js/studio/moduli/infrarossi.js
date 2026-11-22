// Modulo «Infrarossi»: libreria di codici pubblici, telecomandi personali (nella cassaforte), invio dal Polpo e
// apprendimento dei tasti con la IR Unit. Come in Polpo Studio per PC.
import { h, sostituisci } from "../ui.js";
import { nonInviabile, cassaforteAperta, origine, utf8, testo } from "../comune.js";
import {
  CATEGORIE, marche, segnaliLibreria, titoloLibreria, NOTA_LIBRERIA, notaTelecomando, descriviSegnale, nomeFileIr,
  nomeCopiaTelecomando, messaggioImportazione, preparaInvioIr, messaggioInviatoIr, tastoImparato, leggiIr, scriviIr, FileIr, COMANDI_IR,
} from "../protocolli/ir.js";

export function crea(ctx) {
  let segnali = [], sorgente = null; // sorgente: {tipo: "lib"|"voce", id?, titolo}
  let imparando = false;
  const titolo = h("h4", {}, "Scegli un telecomando");
  const nota = h("p", { class: "small" });
  const griglia = h("div", { class: "st-telecomando" });
  const categoria = h("select", { "aria-label": "Categoria" }, Object.entries(CATEGORIE).map(([k, v]) => h("option", { value: k }, v)));
  const marca = h("select", { "aria-label": "Marca" });
  const miei = h("select", { "aria-label": "I miei telecomandi" });
  const elimina = h("select", { "aria-label": "Tasto da eliminare" });
  const scelta = h("input", { type: "file", accept: ".ir", hidden: true });

  const voceCorrente = () => (sorgente && sorgente.tipo === "voce" && ctx.cassaforte ? ctx.cassaforte.voce(sorgente.id) : null);

  const disegnaTelecomando = () => {
    titolo.textContent = sorgente ? sorgente.titolo : "Scegli un telecomando";
    sostituisci(griglia, segnali.length ? segnali.map((s) => h("button", { type: "button", class: "btn btn-ghost", title: descriviSegnale(s), onclick: () => invia(s) }, s.nome))
      : [h("p", { class: "small" }, sorgente ? "Nessun tasto: imparane uno dal telecomando." : "Scegli una marca della libreria o un tuo telecomando.")]);
    const mio = sorgente && sorgente.tipo === "voce";
    sostituisci(elimina, mio ? segnali.map((s, i) => h("option", { value: String(i) }, s.nome)) : []);
    elimina.disabled = !mio;
  };
  const aggiornaMarche = () => sostituisci(marca, marche(categoria.value).map((m) => h("option", { value: m }, m)));
  const aggiornaMiei = () => {
    const c = cassaforteAperta(ctx, false);
    const voci = c ? c.voci("ir") : [];
    sostituisci(miei, voci.length ? voci.map((v) => h("option", { value: v.id }, v.nome + (v.simulato ? " · SIMULATO" : ""))) : [h("option", { value: "" }, c ? "Nessun telecomando salvato" : "Cassaforte chiusa")]);
  };

  const apriLibreria = () => {
    segnali = segnaliLibreria(categoria.value, marca.value);
    sorgente = { tipo: "lib", titolo: titoloLibreria(categoria.value, marca.value) };
    nota.textContent = NOTA_LIBRERIA;
    disegnaTelecomando();
  };
  const apriMio = async (id = miei.value) => {
    const c = cassaforteAperta(ctx);
    if (!c || !id) return;
    try {
      const v = c.voce(id);
      const f = leggiIr(testo(await c.leggi(id)));
      segnali = f.segnali;
      sorgente = { tipo: "voce", id, titolo: v.nome };
      nota.textContent = notaTelecomando(f.avvisi, v.simulato);
      disegnaTelecomando();
    } catch (e) { ctx.avvisa(e.message, "errore"); }
  };
  const salvaMio = async () => {
    const c = cassaforteAperta(ctx);
    if (!c || !sorgente || sorgente.tipo !== "voce") return;
    await c.aggiorna(sorgente.id, { dati: utf8(scriviIr(new FileIr(undefined, segnali))) });
  };
  const nuovoMio = async (nome, iniziali = [], simulato = false) => {
    const c = cassaforteAperta(ctx);
    if (!c) return null;
    const v = await c.aggiungi("ir", nomeFileIr(nome), utf8(scriviIr(new FileIr(undefined, iniziali))), { origine: simulato ? "simulato" : "reale" });
    aggiornaMiei();
    miei.value = v.id;
    await apriMio(v.id);
    return v.id;
  };

  const invia = async (s) => {
    const motivo = nonInviabile(ctx, voceCorrente());
    if (motivo) { ctx.avvisa(motivo, "errore"); return; }
    const { errore, comando, argomenti } = preparaInvioIr(s);
    if (errore) { ctx.avvisa(errore, "errore"); return; }
    try {
      await ctx.richiesta(comando, argomenti);
      ctx.avvisa(messaggioInviatoIr(s, ctx.simulato), "ok");
      ctx.registro.aggiungi("infrarossi", `Inviato IR «${s.nome}»`, "ok", ctx.simulato);
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  ctx.suEvento(COMANDI_IR.eventoImparato, async (dati) => {
    if (!imparando) return;
    if (!sorgente || sorgente.tipo !== "voce") { // i tasti imparati vanno in un telecomando tuo
      if (!(await nuovoMio("telecomando imparato", [], ctx.simulato || !!dati.simulated))) return;
    }
    const r = tastoImparato(dati, segnali.length + 1, ctx.simulato);
    if (r.errore) { ctx.avvisa(r.errore, "errore"); return; }
    segnali.push(r.segnale);
    if (r.simulato) { const v = voceCorrente(); if (v && !v.simulato) await ctx.cassaforte.aggiorna(v.id, { segnaSimulato: true }); }
    await salvaMio();
    disegnaTelecomando();
    ctx.avvisa(r.messaggio, "ok");
  });

  categoria.addEventListener("change", () => { aggiornaMarche(); apriLibreria(); });
  marca.addEventListener("change", apriLibreria);
  scelta.addEventListener("change", async () => {
    const f = scelta.files[0];
    scelta.value = "";
    const c = f && cassaforteAperta(ctx);
    if (!c) return;
    const t = await f.text();
    try {
      const file = leggiIr(t);
      await c.aggiungi("ir", f.name, utf8(t), { meta: { importato_da: f.name } });
      ctx.avvisa(messaggioImportazione(file), "ok");
      aggiornaMiei();
    } catch (e) { ctx.avvisa(e.message, "errore"); }
  });
  aggiornaMarche();
  disegnaTelecomando();
  ctx.suAggiornamento(aggiornaMiei);

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("ir.library",
      h("div", { class: "btn-row" }, categoria, marca, h("button", { type: "button", class: "btn btn-ghost", onclick: apriLibreria }, "Apri")),
      h("div", { class: "btn-row" }, miei,
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => apriMio() }, "Apri il mio"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => scelta.click() }, "Importa un file .ir…"), scelta)),
    ctx.scheda("ir.send", titolo, nota, griglia,
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          if (!segnali.length) { ctx.avvisa("Apri prima un telecomando.", "errore"); return; }
          const copia = segnali.map((s) => Object.assign(Object.create(Object.getPrototypeOf(s)), s));
          await nuovoMio(nomeCopiaTelecomando(titolo.textContent), copia);
        } }, "Copia nei miei telecomandi"),
        elimina,
        h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          const i = Number(elimina.value);
          if (!sorgente || sorgente.tipo !== "voce" || Number.isNaN(i)) return;
          segnali.splice(i, 1);
          await salvaMio();
          disegnaTelecomando();
        } }, "Elimina tasto"))),
    ctx.scheda("ir.learn",
      h("p", { class: "small" }, "Punta un telecomando verso la IR Unit collegata al Polpo e premi un tasto: diventa un tasto del telecomando aperto (o di uno nuovo)."),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          try { await ctx.richiesta(COMANDI_IR.avviaApprendimento); imparando = true; ctx.avvisa("In ascolto: premi un tasto del telecomando verso la IR Unit." + (ctx.simulato ? " · SIMULATO" : "")); }
          catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
        } }, "Impara un tasto…"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          imparando = false;
          try { await ctx.richiesta(COMANDI_IR.fermaApprendimento); ctx.avvisa("Apprendimento fermato."); } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
        } }, "Ferma"))),
    ctx.scheda("ir.import"), ctx.scheda("ir.profiles"),
  );
  return { id: "infrarossi", titolo: "Infrarossi", el, mostrato: aggiornaMiei };
}
