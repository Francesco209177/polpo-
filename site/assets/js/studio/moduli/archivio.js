// Modulo «Archivio»: ciò che è salvato nella cassaforte cifrata, per categoria, con ricerca, importazione,
// esportazione e controllo di integrità. Ciò che viene dal Polpo virtuale resta segnato SIMULATO.
import { h, sostituisci, quando, dimensione } from "../ui.js";
import { CATEGORIE, NOMI_CATEGORIE } from "../sicurezza/cassaforte.js";

export function crea(ctx) {
  const categoria = h("select", { "aria-label": "Categoria" }, h("option", { value: "" }, "Tutte le categorie"),
    CATEGORIE.map((c) => h("option", { value: c }, NOMI_CATEGORIE[c] || c)));
  const cerca = h("input", { type: "text", placeholder: "Cerca per nome", "aria-label": "Cerca" });
  const elenco = h("ul", { class: "st-righe" });
  const nota = h("p", { class: "small" });
  const scelta = h("input", { type: "file", hidden: true });

  const disegna = () => {
    const c = ctx.cassaforte;
    if (!c || !c.aperta || c.bloccoRapido) {
      nota.textContent = "La cassaforte è chiusa: aprila nel modulo Sicurezza.";
      sostituisci(elenco);
      return;
    }
    const voci = c.voci(categoria.value || null, cerca.value.trim());
    nota.textContent = `${voci.length} elementi.`;
    sostituisci(elenco, voci.map((v) => h("li", {},
      h("strong", {}, v.nome), " ", v.simulato ? h("span", { class: "badge sim" }, "Simulato") : null, h("br"),
      h("span", { class: "small" }, `${NOMI_CATEGORIE[v.categoria] || v.categoria} · ${dimensione(v.dimensione)} · modificato ${quando(v.modificato)} · versione ${v.versione}`), h("br"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
        try { ctx.salvaFile(new Blob([await c.leggi(v.id)]), v.nome); ctx.registro.aggiungi("archivio", `Esportato «${v.nome}» (non cifrato)`, "avviso", v.simulato); }
        catch (e) { ctx.avvisa(e.message, "errore"); }
      } }, "Salva una copia non cifrata"), " ",
      h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
        if (!confirm(`Eliminare «${v.nome}» dalla cassaforte?`)) return;
        await c.elimina(v.id);
        ctx.registro.aggiungi("archivio", `Eliminato «${v.nome}»`, "info", v.simulato);
        disegna();
      } }, "Elimina"))));
  };
  scelta.addEventListener("change", async () => {
    const f = scelta.files[0];
    scelta.value = "";
    if (!f || !ctx.cassaforte) return;
    const cat = categoria.value || "altro";
    try {
      await ctx.cassaforte.aggiungi(cat, f.name, new Uint8Array(await f.arrayBuffer()), { meta: { importato_da: f.name } });
      ctx.avvisa(`Importato «${f.name}» in ${NOMI_CATEGORIE[cat] || cat}.`, "ok", "archivio");
      disegna();
    } catch (e) { ctx.avvisa(e.message, "errore"); }
  });
  categoria.addEventListener("change", disegna);
  cerca.addEventListener("input", disegna);
  ctx.suAggiornamento(() => { if (!elenco.closest("[hidden]")) disegna(); });

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("files.browse", h("div", { class: "btn-row" }, categoria, cerca), nota, elenco),
    ctx.scheda("files.io", h("p", { class: "small" }, "Importa un file dal telefono nella categoria scelta (se nessuna: «Altro»). Il backup di tutto si fa dal modulo Sicurezza."),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => scelta.click() }, "Importa un file…"), scelta),
    ctx.scheda("files.integrity", h("p", { class: "small" }, "Il controllo completo è nel modulo Sicurezza."),
      h("a", { class: "btn btn-ghost", href: "#sicurezza" }, "Vai al controllo")),
    ctx.scheda("files.sync"),
  );
  return { id: "archivio", titolo: "Archivio", el, mostrato: disegna };
}
