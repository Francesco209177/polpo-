// Modulo «Radio 433 MHz»: ricezione dei codici fissi dei tuoi telecomandi, cattura RAW con grafico e analisi,
// archivio legato ai tuoi dispositivi (nella cassaforte), editor dei file .sub, report e trasmissione di un codice
// salvato: con la modalità laboratorio, una conferma qui e una sullo schermo del Polpo. Come in Polpo Studio per PC.
import { h, sostituisci, tabella, quando } from "../ui.js";
import { nonInviabile, cassaforteAperta, origine, utf8, testo } from "../comune.js";
import {
  COMANDI_RF, COLONNE_RICEZIONE, rigaCodiceRicevuto, nomeCodiceRicevuto, salvataggioCodice, tempiDaInstantanea, rawDaSalvare,
  testoAnalisi, didascaliaImpulsi, descriviArchivio, verificaTrasmissione, percorsoTrasmissione, argomentiTrasmissione,
  confermaTrasmissione, testoTrasmesso, reportRadio, dataReport, BANDE, NOTA_BANDE, TESTO_EDITOR_INIZIALE, NOME_EDITOR_INIZIALE,
  statoEditor, nomeFileSub, salvataggioEditor,
} from "../protocolli/subghz.js";

const REGISTRO = "dispositivi-radio.json"; // lo stesso nome di Polpo Studio per PC

/** Il registro dei tuoi dispositivi, cifrato nella cassaforte (categoria «configurazioni»). */
async function dispositivi(c) {
  const v = c.voci("configurazioni").find((x) => x.nome === REGISTRO);
  if (!v) return [];
  try { return JSON.parse(testo(await c.leggi(v.id))); } catch { return []; }
}
async function aggiungiDispositivo(c, nome) {
  const lista = await dispositivi(c);
  const d = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 12), name: nome, place: "", notes: "", added: new Date().toISOString().slice(0, 10) };
  lista.push(d);
  const dati = utf8(JSON.stringify(lista, null, 2));
  const v = c.voci("configurazioni").find((x) => x.nome === REGISTRO);
  if (v) await c.aggiorna(v.id, { dati }); else await c.aggiungi("configurazioni", REGISTRO, dati);
  return d;
}

/** Il grafico degli impulsi: livello alto e basso nel tempo. */
function disegnaImpulsi(tela, tempi) {
  const g = tela.getContext("2d"), w = (tela.width = tela.clientWidth * devicePixelRatio || 600), hh = (tela.height = 120 * devicePixelRatio);
  g.clearRect(0, 0, w, hh);
  const tot = tempi.reduce((s, t) => s + Math.abs(t), 0);
  if (!tot) return;
  g.strokeStyle = getComputedStyle(tela).color;
  g.lineWidth = Math.max(1, devicePixelRatio);
  g.beginPath();
  let x = 0;
  for (const t of tempi) {
    const y = t > 0 ? hh * 0.2 : hh * 0.8;
    g.lineTo(x, y);
    x += (Math.abs(t) / tot) * w;
    g.lineTo(x, y);
  }
  g.stroke();
}

export function crea(ctx) {
  const ricevuti = []; // {dati, simulato, ts}
  // sul telefono una riga per codice, non una tabella larga
  const corpoRx = h("ul", { class: "st-righe", "aria-label": "Codici ricevuti" });
  const tabRx = h("div", {}, h("p", { class: "small", dataset: { vuoto: "" } }, "Nessun codice ricevuto per ora."), corpoRx);
  let raw = [], rawSim = false, timerRaw = null;
  const tela = h("canvas", { class: "st-grafico", role: "img", "aria-label": "Grafico degli impulsi registrati" });
  const analisi = h("p", { class: "small" });
  const arch = h("ul", { class: "st-righe" });
  const devNota = h("p", { class: "small" });
  const editor = h("textarea", { rows: "9", spellcheck: "false", "aria-label": "File .sub" });
  const nomeEd = h("input", { type: "text", value: NOME_EDITOR_INIZIALE, "aria-label": "Nome del file" });
  const statoEd = h("p", { class: "small" });
  editor.value = TESTO_EDITOR_INIZIALE;
  const aggiornaEditor = () => { const s = statoEditor(editor.value); statoEd.textContent = typeof s === "string" ? s : s.testo || s.messaggio || JSON.stringify(s); };
  editor.addEventListener("input", aggiornaEditor);

  // ---------------- ricezione ----------------
  // ogni codice è una riga nuova in cima: le righe già mostrate (e i loro pulsanti) non cambiano
  ctx.suEvento(COMANDI_RF.eventoCodice, (dati) => {
    const r = { dati, simulato: ctx.simulato, ts: Date.now() / 1000 };
    ricevuti.unshift(r);
    const x = rigaCodiceRicevuto(dati, r.simulato);
    const [cOra, cProt, cBit, , cImp] = COLONNE_RICEZIONE;
    corpoRx.prepend(h("li", {},
      h("strong", {}, x.codice), " ", x.origine === "SIMULATO" ? h("span", { class: "badge sim" }, "Simulato") : null, h("br"),
      h("span", { class: "small" }, `${cOra} ${quando(r.ts)} · ${cProt} ${x.protocollo} · ${cBit} ${x.bit} · ${cImp} ${x.impulso}`), " ",
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => salvaRicevuto(r) }, "Salva…")));
    while (corpoRx.children.length > 50) { corpoRx.lastChild.remove(); ricevuti.pop(); }
    tabRx.querySelector("[data-vuoto]").hidden = true;
  });
  const salvaRicevuto = async (r) => {
    const c = cassaforteAperta(ctx);
    if (!c) return;
    const nome = prompt("Nome del codice (es. «presa salotto ON»):", nomeCodiceRicevuto(r.dati));
    if (!nome) return;
    const devs = await dispositivi(c);
    let idDisp = "";
    if (devs.length) {
      const scelta = prompt("Di quale tuo dispositivo? Scrivi il numero (vuoto = nessuno):\n" + devs.map((d, k) => `${k + 1}. ${d.name}`).join("\n"), "");
      const k = Number(scelta) - 1;
      if (devs[k]) idDisp = devs[k].id;
    }
    const s = salvataggioCodice(r.dati, r.simulato, nome.trim() || "codice", idDisp);
    await c.aggiungi("radio", s.nomeFile, utf8(s.testo), { origine: s.origine, meta: s.meta });
    ctx.registro.aggiungi("radio", `Codice salvato: ${nome}`, "ok", s.origine === "simulato");
    ctx.avvisa(s.messaggio, "ok");
    disegnaArchivio();
  };

  // ---------------- RAW ----------------
  const istantanea = async () => {
    if (!ctx.collegato()) { clearInterval(timerRaw); timerRaw = null; return; }
    try {
      const d = await ctx.richiesta(COMANDI_RF.istantaneaRaw);
      raw = tempiDaInstantanea(d);
      rawSim = ctx.simulato || !!d.simulated;
      disegnaImpulsi(tela, raw);
      tela.setAttribute("aria-label", didascaliaImpulsi(raw));
      analisi.textContent = raw.length ? testoAnalisi(raw) : "Nessun impulso registrato";
    } catch (e) { clearInterval(timerRaw); timerRaw = null; ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  // ---------------- archivio ----------------
  let selezionato = null;
  async function disegnaArchivio() {
    const c = cassaforteAperta(ctx, false);
    if (!c) { sostituisci(arch, h("li", { class: "small" }, "La cassaforte è chiusa: aprila nel modulo Sicurezza.")); devNota.textContent = ""; return; }
    const devs = await dispositivi(c);
    const nomi = Object.fromEntries(devs.map((d) => [d.id, d.name]));
    devNota.textContent = "Dispositivi tuoi: " + (devs.map((d) => d.name).join(", ") || "nessuno");
    const voci = c.voci("radio");
    const righe = [];
    for (const v of voci) {
      const info = descriviArchivio(testo(await c.leggi(v.id)));
      righe.push(h("li", {},
        h("label", { class: "sim-spunta" }, h("input", { type: "radio", name: "st-radio-voce", checked: selezionato === v.id, onchange: () => { selezionato = v.id; } }),
          h("strong", {}, v.nome), " ", v.simulato ? h("span", { class: "badge sim" }, "Simulato") : null),
        h("span", { class: "small" }, `${nomi[v.meta?.device] || "—"} · ${info.tipo} · trasmissibile: ${info.trasmissibile}`)));
    }
    sostituisci(arch, righe.length ? righe : [h("li", { class: "small" }, "Nessun codice salvato.")]);
  }
  const voceScelta = () => {
    const c = cassaforteAperta(ctx);
    if (!c) return null;
    if (!selezionato || !c.voce(selezionato)) { ctx.avvisa("Seleziona un codice dell'archivio.", "errore"); return null; }
    return { c, v: c.voce(selezionato) };
  };
  const trasmetti = async () => {
    const s = voceScelta();
    if (!s) return;
    const motivo = nonInviabile(ctx, s.v);
    if (motivo) { ctx.avvisa(motivo, "errore"); return; }
    const dati = await s.c.leggi(s.v.id);
    const { errore } = verificaTrasmissione(testo(dati));
    if (errore) { ctx.avvisa(errore, "errore"); return; }
    if (!ctx.collegato()) { ctx.avvisa("Collega prima un Polpo.", "errore"); return; }
    if (!ctx.richiediLaboratorio("rf.tx")) return;
    const conf = confermaTrasmissione(s.v.nome, s.v.meta || {}, await dispositivi(s.c));
    if (!confirm(`${conf.titolo}\n\n${conf.testo}`)) return;
    const percorso = percorsoTrasmissione(s.v.id);
    try {
      ctx.avvisa("Copio il file sul Polpo e attendo la conferma sul suo schermo…");
      await ctx.client.scriviFile(percorso, dati);
      const d = await ctx.richiesta(COMANDI_RF.trasmetti, argomentiTrasmissione(percorso), 35000);
      ctx.avvisa(testoTrasmesso(d, ctx.simulato), "ok");
      ctx.registro.aggiungi("radio", `Trasmesso «${s.v.nome}»`, "avviso", ctx.simulato);
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  ctx.suAggiornamento(() => {
    if (!ctx.collegato() && timerRaw) { clearInterval(timerRaw); timerRaw = null; }
    if (!arch.closest("[hidden]")) disegnaArchivio();
  });
  aggiornaEditor();
  const btn = (t, f, cls = "btn btn-ghost") => h("button", { type: "button", class: cls, onclick: f }, t);

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("radio.rx",
      h("div", { class: "btn-row" },
        btn("Avvia ascolto", async () => { try { await ctx.richiesta(COMANDI_RF.avviaRicezione); ctx.avvisa("In ascolto a 433,92 MHz…" + (ctx.simulato ? " · SIMULATO" : "")); } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); } }),
        btn("Ferma", async () => { try { await ctx.richiesta(COMANDI_RF.fermaRicezione); ctx.avvisa("Ascolto fermato."); } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); } })),
      tabRx),
    ctx.scheda("radio.raw",
      h("div", { class: "btn-row" },
        btn("Avvia registrazione", async () => {
          try { await ctx.richiesta(COMANDI_RF.avviaRaw); ctx.avvisa("Registrazione RAW in corso…"); clearInterval(timerRaw); timerRaw = setInterval(istantanea, 1500); istantanea(); }
          catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
        }),
        btn("Ferma", async () => { clearInterval(timerRaw); timerRaw = null; try { await ctx.richiesta(COMANDI_RF.fermaRaw); ctx.avvisa("Registrazione fermata."); } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); } }),
        btn("Salva come .sub RAW", async () => {
          const c = cassaforteAperta(ctx);
          if (!c) return;
          const r = rawDaSalvare(raw);
          if (r.errore) { ctx.avvisa(r.errore, "errore"); return; }
          const ora = new Date(), due = (n) => String(n).padStart(2, "0");
          await c.aggiungi("radio", `raw-${due(ora.getHours())}${due(ora.getMinutes())}${due(ora.getSeconds())}.sub`, utf8(r.testo), { origine: rawSim ? "simulato" : "reale", meta: { raw: true } });
          ctx.avvisa("RAW salvato nella cassaforte.", "ok");
          disegnaArchivio();
        })),
      tela, analisi),
    ctx.scheda("radio.analysis", h("p", { class: "small" }, "L'analisi degli impulsi compare sotto il grafico della cattura RAW, e per i codici dell'archivio con «Analizza».")),
    ctx.scheda("radio.archive", devNota, arch,
      h("div", { class: "btn-row" },
        btn("Analizza", async () => {
          const s = voceScelta(); if (!s) return;
          const t = testo(await s.c.leggi(s.v.id));
          const r = verificaTrasmissione(t);
          if (r.sub && r.sub.raw) { raw = r.sub.tempiRaw; disegnaImpulsi(tela, raw); analisi.textContent = testoAnalisi(raw); ctx.avvisa("Analisi nella cattura RAW qui sopra."); }
          else ctx.avvisa(descriviArchivio(t).tipo);
        }),
        btn("Apri nell'editor", async () => { const s = voceScelta(); if (!s) return; editor.value = testo(await s.c.leggi(s.v.id)); nomeEd.value = s.v.nome; aggiornaEditor(); }),
        btn("Elimina", async () => { const s = voceScelta(); if (!s || !confirm(`Eliminare «${s.v.nome}»?`)) return; await s.c.elimina(s.v.id); selezionato = null; disegnaArchivio(); }),
        btn("Nuovo dispositivo…", async () => {
          const c = cassaforteAperta(ctx); if (!c) return;
          const n = prompt("Nome del dispositivo TUO (es. «presa del salotto»):");
          if (n && n.trim()) { await aggiungiDispositivo(c, n.trim()); disegnaArchivio(); }
        }))),
    ctx.scheda("radio.tx", h("p", { class: "small" }, "Trasmette il codice selezionato nell'archivio: solo codici fissi a 433,92 MHz, verso dispositivi tuoi, con la modalità laboratorio attiva. Il Polpo chiede conferma sul suo schermo e tiene il conto del tempo di trasmissione."),
      btn("Trasmetti il codice selezionato…", trasmetti, "btn btn-studio")),
    ctx.scheda("radio.editor", h("label", {}, "Nome ", nomeEd), editor, statoEd,
      btn("Salva nella cassaforte", async () => {
        const c = cassaforteAperta(ctx); if (!c) return;
        const r = salvataggioEditor(editor.value, nomeFileSub(nomeEd.value));
        if (r.errore) { ctx.avvisa(r.errore, "errore"); return; }
        await c.aggiungi("radio", nomeFileSub(nomeEd.value), utf8(editor.value));
        ctx.avvisa(r.messaggio || "Salvato nella cassaforte.", "ok");
        disegnaArchivio();
      })),
    ctx.scheda("radio.report", btn("Crea il report…", async () => {
      const c = cassaforteAperta(ctx); if (!c) return;
      const voci = [];
      for (const v of c.voci("radio")) voci.push({ nome: v.nome, testo: testo(await c.leggi(v.id)), meta: v.meta || {}, simulato: v.simulato, sha256: v.sha256 });
      ctx.salvaFile(new Blob([reportRadio(voci, await dispositivi(c), dataReport())], { type: "text/html" }), "report-radio.html");
      ctx.avvisa("Report salvato (non cifrato).", "ok");
    })),
    ctx.scheda("radio.bands", tabella(["Cosa", "Nel Polpo"], BANDE.map(([a, b]) => [a, b])), h("p", { class: "small" }, NOTA_BANDE)),
    ctx.scheda("radio.other_bands"), ctx.scheda("radio.jam"),
  );
  return { id: "radio", titolo: "Radio 433", el, mostrato: disegnaArchivio };
}
