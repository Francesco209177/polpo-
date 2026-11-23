// Modulo «RFID 125 kHz»: lettura del codice delle TUE tessere con un lettore USB «a tastiera» o un modulo RDM6300
// collegati al telefono con il cavo OTG, conversione dei formati (EM4100, decimale, Wiegand 26), archivio e report.
// Niente scrittura su T5577 e niente copie di tessere: esclusi per scelta. Come in Polpo Studio per PC.
import { h, sostituisci } from "../ui.js";
import { cassaforteAperta, utf8 } from "../comune.js";
import { PortaSeriale, opzioniPorte } from "../seriale.js";
import {
  TESTI_PAGINA, NOTA_ESCLUSIONI, rafficaDaTempi, esitoRaffica, esitoConversione, ParserRdm6300, esitoRdm6300,
  salvataggioTessera, rigaArchivioTessera, reportTessere,
} from "../protocolli/rfid125.js";

const mostraHtml = (el, html) => { el.innerHTML = html; }; // HTML delle funzioni di analisi, con i testi già protetti

export function crea(ctx) {
  let ultima = null; // {carta, fonte}
  const risultato = h("div", { class: "st-nfc" });
  const nome = h("input", { type: "text", placeholder: TESTI_PAGINA.campoNome, "aria-label": "Nome della tessera" });
  const prova = h("input", { type: "checkbox" });
  const mostra = (esito) => {
    if (!esito || !esito.carta) return;
    ultima = { carta: esito.carta, fonte: esito.fonte };
    mostraHtml(risultato, esito.html);
  };

  // lettore «a tastiera»: i caratteri arrivano nel campo, si misura quanto in fretta
  const campo = h("input", { type: "text", placeholder: TESTI_PAGINA.campoLettore, "aria-label": "Campo del lettore USB", autocomplete: "off", autocapitalize: "off", spellcheck: "false", inputmode: "none" });
  let caratteri = [];
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const r = esitoRaffica(rafficaDaTempi(caratteri), !!ctx.impostazioni.dichiarati["rfid125.usb"]);
      caratteri = [];
      campo.value = "";
      for (const [m, errore] of r.messaggi) ctx.avvisa(m, errore ? "errore" : "ok");
      mostra(r);
      return;
    }
    if (e.key.length === 1) caratteri.push([e.key, performance.now() / 1000]);
  });

  // RDM6300 via porta seriale (9600 baud)
  const porte = h("select", { "aria-label": "Porta seriale del lettore RDM6300" });
  const porta = new PortaSeriale();
  let parser = null;
  const infoRdm = h("p", { class: "small" });
  const avviaRdm = async () => {
    if (ctx.client && !ctx.simulato) { ctx.avvisa("La porta USB è usata dal Polpo: scollegalo prima.", "errore"); return; }
    const scelta = opzioniPorte(porte).find((p) => String(p.id) === porte.value) || opzioniPorte(porte)[0];
    if (!scelta) { ctx.avvisa("Collega l'adattatore USB-seriale con il cavo OTG.", "errore"); return; }
    parser = new ParserRdm6300();
    try {
      await porta.apri(scelta, { baud: 9600, dtr: true, rts: false }, (dati) => {
        const r = esitoRdm6300(parser, dati);
        for (const t of r.tessere) mostra(t);
        for (const [m] of r.messaggi) ctx.avvisa(m, "ok");
        infoRdm.textContent = r.info;
      }, () => ctx.avvisa("Lettore RDM6300 scollegato.", "avviso"));
      ctx.avvisa("In ascolto: avvicina la tessera al modulo RDM6300.");
    } catch (e) { ctx.avvisa(e.message, "errore"); }
  };

  // conversione dei formati
  const codice = h("input", { type: "text", placeholder: "0005543210 · 0B0054C49A · 85,21530", "aria-label": "Codice da convertire", autocapitalize: "off", spellcheck: "false" });

  // archivio
  const arch = h("ul", { class: "st-righe" });
  const disegnaArchivio = () => {
    const c = cassaforteAperta(ctx, false);
    if (!c) { sostituisci(arch, h("li", { class: "small" }, "La cassaforte è chiusa: aprila nel modulo Sicurezza.")); return; }
    const voci = c.voci("rfid");
    sostituisci(arch, voci.length ? voci.map((v) => {
      const [n, esa, w26, provaSi] = rigaArchivioTessera(v.nome, v.meta || {});
      return h("li", {}, h("strong", {}, n), h("br"), h("span", { class: "small" }, `${esa} · W26 ${w26}${provaSi ? " · supporto di prova" : ""}`));
    }) : [h("li", { class: "small" }, "Nessuna tessera salvata.")]);
  };
  ctx.suAggiornamento(() => { if (!arch.closest("[hidden]")) disegnaArchivio(); });
  const btn = (t, f, cls = "btn btn-ghost") => h("button", { type: "button", class: cls, onclick: f }, t);

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("rfid125.read",
      h("p", { class: "small" }, TESTI_PAGINA.lettoreUsb), campo,
      h("p", { class: "small" }, TESTI_PAGINA.rdm6300),
      h("div", { class: "btn-row" }, porte, btn("Cerca le porte", () => opzioniPorte(porte)), btn("Ascolta l'RDM6300", avviaRdm), btn("Ferma", () => { porta.chiudi(); ctx.avvisa("Lettore fermato."); })),
      infoRdm, risultato,
      h("div", { class: "btn-row" }, nome, h("label", { class: "sim-spunta" }, prova, " ", TESTI_PAGINA.supportoProva),
        btn("Salva nella cassaforte", async () => {
          const c = cassaforteAperta(ctx); if (!c) return;
          const s = salvataggioTessera(ultima && ultima.carta, ultima && ultima.fonte, prova.checked, nome.value, new Date());
          if (!s.ok) { ctx.avvisa(s.errore, "errore"); return; }
          await c.aggiungi("rfid", s.nome, utf8(s.testo), { meta: s.meta });
          ctx.registro.aggiungi("rfid", s.attivita, "ok");
          ctx.avvisa(s.messaggio, "ok");
          disegnaArchivio();
        }))),
    ctx.scheda("rfid125.formats", h("p", { class: "small" }, TESTI_PAGINA.formati), codice,
      btn("Converti", () => { const r = esitoConversione(codice.value); if (r.errore) ctx.avvisa(r.errore, "errore"); else mostra(r); })),
    ctx.scheda("rfid125.archive", arch, btn("Report…", () => {
      const c = cassaforteAperta(ctx); if (!c) return;
      ctx.salvaFile(new Blob([reportTessere(c.voci("rfid").map((v) => ({ nome: v.nome, meta: v.meta || {} })), new Date())], { type: "text/html" }), "report-rfid125.html");
      ctx.avvisa("Report salvato (non cifrato).", "ok");
    })),
    ctx.scheda("rfid125.write", h("p", { class: "small" }, NOTA_ESCLUSIONI)),
  );
  return { id: "rfid125", titolo: "RFID 125 kHz", el, mostrato: () => { opzioniPorte(porte); disegnaArchivio(); } };
}
