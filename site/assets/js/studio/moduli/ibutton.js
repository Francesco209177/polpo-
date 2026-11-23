// Modulo «iButton»: il codice ROM delle TUE chiavi 1-Wire letto con il Polpo Bridge (Sperimentale, cavo OTG),
// famiglia e controllo CRC8 anche su codici scritti a mano, archivio nella cassaforte. Niente emulazione e niente
// scrittura di chiavi: esclusi per scelta. Come in Polpo Studio per PC.
import { h, tabella, sostituisci } from "../ui.js";
import { cassaforteAperta, utf8 } from "../comune.js";
import { eseguiAzione, preparaRicercaIButton, preparaPresenzaIButton } from "../protocolli/bridge.js";
import { NOTA_COLLEGAMENTO, NOTA_ESCLUSIONI, rigaRom, testoAnalisiRom, salvataggioRom } from "../protocolli/onewire.js";

export function crea(ctx) {
  let roms = [];
  const tabellaRom = h("div", { class: "st-tabella" });
  const sceltaRom = h("select", { "aria-label": "Chiave da salvare" });
  const disegna = () => {
    sostituisci(tabellaRom, roms.length
      ? tabella(["ROM", "Famiglia", "Numero di serie", "CRC8"], roms.map(rigaRom))
      : h("p", { class: "small" }, "Nessuna chiave letta."));
    sostituisci(sceltaRom, ...roms.map((r, i) => h("option", { value: String(i) }, r.testo)));
  };
  const ambiente = () => ({
    gestore: ctx.bridge ? ctx.bridge.gestore : { collegato: false },
    laboratorio: ctx.laboratorio,
    avvisa: (t, errore) => ctx.avvisa(t, errore ? "errore" : "ok"),
    registro: ctx.registro,
    categoria: "ibutton",
  });
  const cerca = async () => {
    const r = await eseguiAzione(preparaRicercaIButton(), ambiente());
    if (r) { roms = r.roms; disegna(); }
  };
  const presenza = () => eseguiAzione(preparaPresenzaIButton(), ambiente());

  const codice = h("input", { type: "text", placeholder: "01 23 45 67 89 AB CD EF", "aria-label": "Codice ROM", autocomplete: "off", spellcheck: "false" });
  const analisi = h("pre", { class: "st-risultato small" });
  codice.addEventListener("input", () => { analisi.textContent = codice.value.trim() ? testoAnalisiRom(codice.value) : ""; });

  const salva = async () => {
    const rom = roms[Number(sceltaRom.value)];
    if (!rom) { ctx.avvisa("Prima leggi una chiave.", "errore"); return; }
    const c = cassaforteAperta(ctx);
    if (!c) return;
    const s = salvataggioRom(rom, new Date());
    try {
      await c.aggiungi("ibutton", s.nome, utf8(s.testo), { meta: s.meta });
      ctx.avvisa(s.messaggio, "ok");
      archivio();
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const elenco = h("div", { class: "st-tabella" });
  const archivio = () => {
    const c = cassaforteAperta(ctx, false);
    if (!c) { sostituisci(elenco, h("p", { class: "small" }, "Apri la cassaforte (modulo Sicurezza) per vedere le chiavi salvate.")); return; }
    const voci = c.voci("ibutton");
    sostituisci(elenco, voci.length
      ? tabella(["Nome", "ROM"], voci.map((v) => [v.nome, String((v.meta && v.meta.rom) || "")]))
      : h("p", { class: "small" }, "Nessuna chiave salvata."));
  };
  disegna();

  const b = (t, fn, classe = "btn btn-ghost") => h("button", { type: "button", class: classe, onclick: fn }, t);
  const el = h("div", { class: "st-griglia" },
    ctx.scheda("ib.read",
      h("p", { class: "small" }, "Sperimentale. Collega prima il Polpo Bridge nel modulo GPIO. ", NOTA_COLLEGAMENTO),
      h("div", { class: "btn-row" }, b("Cerca chiavi", cerca, "btn btn-studio"), b("Controlla presenza", presenza)),
      tabellaRom),
    ctx.scheda("ib.analysis", h("label", { class: "small" }, "Codice ROM (16 cifre esadecimali, famiglia per prima) ", codice), analisi),
    ctx.scheda("ib.archive",
      h("div", { class: "btn-row" }, sceltaRom, b("Salva nella cassaforte", salva)),
      elenco),
    ctx.scheda("ib.emulate"),
    h("p", { class: "small" }, NOTA_ESCLUSIONI),
  );
  ctx.suAggiornamento(archivio);
  return { id: "ibutton", titolo: "iButton", el, mostrato: archivio };
}
