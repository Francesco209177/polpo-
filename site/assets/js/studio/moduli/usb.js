// Modulo «USB»: dispositivi collegati al telefono con il cavo OTG, porte seriali e dispositivi HID (solo elenco),
// tester di tastiera e mouse, editor DuckyScript con controllo e copia sul Polpo. Lo script NON si esegue dal
// telefono: parte solo dal Polpo, dopo la sua conferma. Come in Polpo Studio per PC.
import { h, sostituisci, tabella } from "../ui.js";
import { cassaforteAperta } from "../comune.js";
import { AVVISO, ESEMPIO, esitoControllo, salvataggioScript, preparaCopia, esitoCopia } from "../protocolli/ducky.js";

const CLASSE_HID = 3;
export const elencoUsb = (nativo = globalThis.PolpoNativo) => {
  if (!nativo || !nativo.usbElenco) return [];
  try { return JSON.parse(nativo.usbElenco()); } catch { return []; }
};
const esa4 = (n) => "0x" + Number(n).toString(16).toUpperCase().padStart(4, "0");

export function crea(ctx) {
  // ---- elenchi ----
  const dispositivi = h("div"), seriali = h("div"), hid = h("div");
  const elenca = () => {
    const d = elencoUsb();
    const righe = (lista) => lista.map((x) => [x.nome || "?", x.produttore || "—", `${esa4(x.vid)}:${esa4(x.pid)}`, x.permesso ? "sì" : "alla prima apertura"]);
    const vuoto = (t) => h("p", { class: "small" }, t);
    sostituisci(dispositivi, d.length ? tabella(["Nome", "Produttore", "VID:PID", "Permesso"], righe(d)) : vuoto("Nessun dispositivo USB collegato al telefono."));
    const s = d.filter((x) => x.seriale);
    sostituisci(seriali, s.length ? tabella(["Nome", "Produttore", "VID:PID", "Permesso"], righe(s)) : vuoto("Nessuna porta seriale USB."));
    const k = d.filter((x) => (x.classi || []).includes(CLASSE_HID));
    sostituisci(hid, k.length ? tabella(["Nome", "Produttore", "VID:PID", "Permesso"], righe(k)) : vuoto("Nessun dispositivo HID (tastiere, mouse, lettori «a tastiera»)."));
  };

  // ---- tester di tastiera e mouse ----
  const area = h("div", { class: "st-tester", tabindex: "0", "aria-label": "Area del tester: premi i tasti o tocca qui" }, "Tocca qui, poi premi i tasti della tastiera USB o muovi il mouse.");
  const ultimi = h("ol", { class: "st-registro", reversed: true });
  const annota = (t) => { ultimi.prepend(h("li", {}, t)); while (ultimi.children.length > 20) ultimi.lastChild.remove(); };
  area.addEventListener("keydown", (e) => { e.preventDefault(); annota(`tasto «${e.key}» · codice ${e.code}${e.shiftKey ? " · Maiusc" : ""}${e.ctrlKey ? " · Ctrl" : ""}${e.altKey ? " · Alt" : ""}`); });
  area.addEventListener("pointerdown", (e) => annota(`${e.pointerType === "mouse" ? "mouse" : e.pointerType}: pulsante ${e.button} a ${Math.round(e.offsetX)},${Math.round(e.offsetY)}`));
  area.addEventListener("wheel", (e) => annota(`rotella ${e.deltaY > 0 ? "giù" : "su"}`), { passive: true });

  // ---- DuckyScript ----
  const nome = h("input", { type: "text", value: "saluto", "aria-label": "Nome dello script", autocapitalize: "off", spellcheck: "false" });
  const layout = h("select", { "aria-label": "Layout della tastiera" }, h("option", { value: "IT" }, "Italiano"), h("option", { value: "US" }, "Americano"));
  const testo = h("textarea", { rows: "10", spellcheck: "false", autocapitalize: "off", wrap: "off", "aria-label": "Script DuckyScript" });
  testo.value = ESEMPIO;
  const esito = h("pre", { class: "st-esito" });
  const controlla = () => { esito.textContent = esitoControllo(testo.value, layout.value).testo; };
  testo.addEventListener("input", controlla);
  layout.addEventListener("change", controlla);
  controlla();
  const btn = (t, f, cls = "btn btn-ghost") => h("button", { type: "button", class: cls, onclick: f }, t);

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("usb.devices", btn("Aggiorna", elenca), dispositivi),
    ctx.scheda("usb.serial", seriali),
    ctx.scheda("usb.hid", h("p", { class: "small" }, "Solo l'elenco: l'app non legge né invia tasti."), hid),
    ctx.scheda("usb.tester", area, ultimi),
    ctx.scheda("usb.ducky", h("p", { class: "notice warn small" }, AVVISO), h("div", { class: "btn-row" }, h("label", {}, "Nome ", nome), layout), testo, esito,
      btn("Salva nella cassaforte", async () => {
        const c = cassaforteAperta(ctx); if (!c) return;
        const s = salvataggioScript(nome.value, testo.value, layout.value);
        if (!s.ok) { ctx.avvisa(s.errore || s.testo, "errore"); return; }
        await c.aggiungi(s.categoria, s.nome, s.contenuto, { meta: s.meta });
        ctx.avvisa(s.messaggio, "ok");
      })),
    ctx.scheda("usb.ducky_copy", h("p", { class: "small" }, "Copia lo script nella cartella /polpo/badusb del Polpo: il Polpo chiede conferma sul suo schermo. Per eseguirlo usa l'app BadUSB sul Polpo, collegato al TUO computer."),
      btn("Copia sul Polpo", async () => {
        const p = preparaCopia(nome.value, testo.value, layout.value);
        if (!p.ok) { ctx.avvisa(p.errore, "errore"); return; }
        if (!ctx.collegato()) { ctx.avvisa("Collega prima un Polpo.", "errore"); return; }
        try {
          ctx.avvisa(p.attesa);
          await ctx.client.scriviFile(p.destinazione, p.contenuto);
          const r = esitoCopia(p.destinazione, ctx.simulato);
          ctx.avvisa(r.messaggio, "ok");
          ctx.registro.aggiungi("usb", r.attivita, "avviso", ctx.simulato);
        } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
      })),
    ctx.scheda("usb.run"),
  );
  ctx.suAggiornamento(() => { if (!dispositivi.closest("[hidden]")) elenca(); });
  return { id: "usb", titolo: "USB", el, mostrato: elenca };
}
