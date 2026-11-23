// Polpo Studio — Polpo Bridge: una scheda Arduino/ESP32 con lo sketch studio/bridge/polpo_bridge (Sperimentale).
// Copia JavaScript delle parti pure di studio/polpo_studio/devices/bridge.py (collegamento e richieste) e dei moduli
// che lo usano: app/tools/bridge_panel.py (pannello di collegamento), la scheda «Polpo Bridge» e la porta Grove di
// app/tools/gpio_tools.py, la ricerca delle chiavi di app/tools/ibutton_tools.py. Comandi, argomenti, modalità
// laboratorio, conferme, testi delle risposte e messaggi sono gli stessi.
//
// Il Bridge parla lo stesso formato a righe JSON di Polpo Link (link/client.js), a 115200 baud, senza sessione, ping
// né conferme sullo schermo (non ha schermo): `hello` serve solo a riconoscerlo.
//
// Sicurezza, come in Python: i pin sono solo quelli che lo sketch dichiara; usare un pin come uscita chiede la
// modalità laboratorio («pilotare uscite GPIO») e una conferma, scrivere su un'uscita chiede la modalità laboratorio.
// Lo sketch non ha SPI. iButton: solo il codice ROM, nessuna emulazione né scrittura di chiavi.

import { ClientLink, ErroreLink, ErroreTrasporto, STATO } from "../link/client.js";
import { PRESENZA } from "../catalogo.js";
import { PermessoNegato } from "../sicurezza/laboratorio.js";
import { chiavePy, errorePy, formatPy, formatValorePy, intPy, nomeTipoPy, prendiPy, stripPy, strPy, veroPy } from "../strumenti/convertitore.js";
import { elementiPy } from "./flipper.js";
import { NOTA_COLLEGAMENTO, NOTA_ESCLUSIONI, esitoRicerca, messaggioPresenza } from "./onewire.js";

/** Il valore di `bridge` nella risposta a `hello` che riconosce lo sketch. */
export const NOME_BRIDGE = "Polpo Bridge";

/** I comandi dello sketch (studio/docs/PROTOCOLLO_POLPO_LINK.md, § Polpo Bridge). Nessuno ha SPI. */
export const COMANDI = Object.freeze({
  ping: "ping",
  hello: "hello",
  modoPin: "pin.mode",
  leggiPin: "pin.read",
  scriviPin: "pin.write",
  leggiAdc: "adc.read",
  scansioneI2c: "i2c.scan",
  presenza1Wire: "ow.reset",
  ricerca1Wire: "ow.search",
});

/** L'azione della modalità laboratorio per le uscite (sicurezza/laboratorio.js). */
export const AZIONE_USCITE = "gpio.output";

/** Tempi in millisecondi: richieste, ogni tentativo di `hello`, attesa massima all'apertura (Arduino Uno si riavvia, ~2 s). */
export const TEMPO_RICHIESTA = 5000;
export const TEMPO_HELLO = 1000;
export const ATTESA_AVVIO = 6000;

/** I modi di un pin: [modo, nome]. */
export const MODI_PIN = Object.freeze([
  Object.freeze(["input", "ingresso"]),
  Object.freeze(["input_pullup", "ingresso con pull-up"]),
  Object.freeze(["output", "uscita"]),
]);

/** Indirizzi I2C noti → nome (common.py). */
export const NOMI_I2C = Object.freeze({
  0x28: "M5 RFID2 (WS1850S)", 0x23: "BH1750 luce", 0x29: "VL53L0X distanza", 0x38: "AHT20 / ENV",
  0x3c: "Display OLED", 0x3d: "Display OLED", 0x40: "INA219 / HDC1080", 0x44: "SHT3x / SHT4x",
  0x45: "SHT3x / SHT4x", 0x48: "ADS1115 / TMP102", 0x50: "EEPROM / NFC ST25", 0x51: "RTC BM8563",
  0x57: "MAX30102", 0x5a: "MLX90614 / CCS811", 0x5c: "AM2320", 0x68: "MPU6050 / DS3231",
  0x69: "BMI270 / MPU6050", 0x70: "PCA9548 hub I2C", 0x76: "BME280 / BMP280", 0x77: "BME280 / BMP280",
});

export const TESTI = Object.freeze({
  collegaPrima: "Collega prima il Polpo Bridge.",
  nessunaPorta: "Nessuna porta seriale.",
  collegato: "Polpo Bridge collegato.",
  scollegato: "Polpo Bridge scollegato.",
  nonCollegato: "Polpo Bridge non collegato",
  rifiutato: "Rifiutato sullo schermo del Polpo.",
  notaIButton: NOTA_COLLEGAMENTO,
  esclusioniIButton: NOTA_ESCLUSIONI,
  tensioni:
    "Attenzione alle tensioni: i pin dell'ESP32 (Polpo e molte schede) lavorano a 3,3 V e NON tollerano 5 V. " +
    "Arduino Uno/Nano lavorano a 5 V: per collegarli a una scheda a 3,3 V serve un adattatore di livello.",
  grove: "G1 = filo bianco (SCL), G2 = filo giallo (SDA). Alimentazione Grove 5 V, segnali 3,3 V.",
  titoloUscita: "Usare il pin come uscita?",
});

// Il nome di un intero noto (I2C) come `tabella.get(x, predefinito)` di Python: i booleani valgono 0 e 1.
function nomeI2c(x, predefinito) {
  const k = typeof x === "boolean" ? Number(x) : x;
  return (typeof k === "number" || typeof k === "bigint") && Object.hasOwn(NOMI_I2C, String(k)) ? NOMI_I2C[k] : predefinito;
}

// ---------------- collegamento (devices/bridge.py) ----------------

/**
 * Il collegamento a un Polpo Bridge, come BridgeManager: un ClientLink senza ping né conferme, `hello` ripetuto finché
 * la scheda risponde (o finisce l'attesa all'avvio), poi le richieste. `suStato({collegato, info})` è avvisato quando
 * il Bridge si collega o si scollega (anche se si stacca il cavo); `presenza` è lo stato dell'hardware «bridge»
 * ({presenza, dettaglio}, come nel catalogo); `registro` è il registro delle attività (registro.js).
 * `adesso` (ms) decide quando smettere di aspettare l'avvio; `opzioniClient` va al ClientLink (es. il suo orologio).
 */
export class GestoreBridge {
  constructor({ registro = null, suStato = null, adesso = () => performance.now(), opzioniClient = {} } = {}) {
    this.registro = registro;
    this.suStato = suStato;
    this.adesso = adesso;
    this.opzioniClient = opzioniClient;
    this.client = null;
    this.info = {};
    this.presenza = null;
  }

  /** Vero se il Bridge è collegato e ha risposto a `hello`. */
  get collegato() {
    return this.client !== null && this.client.stato !== STATO.CHIUSO && veroPy(this.info);
  }

  /**
   * Apre `trasporto` (come per Polpo Link: apri, scriviRiga, chiudi), cerca il Bridge e restituisce la sua risposta a
   * `hello`; `porta` è il nome della porta nei messaggi. Lancia ErroreLink("not_bridge" o "io_error").
   */
  async collega(trasporto, porta, { attesaAvvio = ATTESA_AVVIO, tempoHello = TEMPO_HELLO } = {}) {
    await this._scollega();
    const client = new ClientLink(trasporto, { nomeClient: "Polpo Studio", intervalloPing: 3_600_000, ...this.opzioniClient, suStato: (stato) => this._suStatoClient(stato) });
    try {
      await client.apri();
    } catch (e) {
      if (e instanceof ErroreTrasporto) throw new ErroreLink("io_error", e.message);
      throw e;
    }
    let info = null;
    const fine = this.adesso() + attesaAvvio;
    while (info === null) {
      try {
        info = await client.richiesta(COMANDI.hello, null, tempoHello);
      } catch (e) {
        if (!(e instanceof ErroreLink)) throw e;
        if (e.codice !== "timeout" || this.adesso() > fine) {
          await client.chiudi(false);
          throw new ErroreLink("not_bridge", `Nessun Polpo Bridge su ${porta}: carica lo sketch sulla scheda.`);
        }
      }
    }
    if (prendiPy(info, "bridge") !== NOME_BRIDGE) {
      await client.chiudi(false);
      throw new ErroreLink("not_bridge", `La scheda su ${porta} non risponde come Polpo Bridge.`);
    }
    this.client = client;
    this.info = info;
    const scheda = strPy(prendiPy(info, "board"));
    this.presenza = { presenza: PRESENZA.RILEVATO, dettaglio: `${scheda} · ${porta}` };
    this.registro?.aggiungi("bridge", `Polpo Bridge collegato: ${scheda} su ${porta}`, "ok");
    this.suStato?.({ collegato: true, info });
    return info;
  }

  _suStatoClient(stato) {
    if (stato === STATO.CHIUSO && veroPy(this.info)) {
      this.info = {};
      this.presenza = { presenza: PRESENZA.ASSENTE, dettaglio: "scollegato" };
      this.suStato?.({ collegato: false, info: {} });
    }
  }

  /** Chiude il collegamento (senza `bye`: il Bridge non ha sessione). */
  scollega() {
    return this._scollega();
  }

  async _scollega() {
    const client = this.client;
    this.client = null;
    if (client !== null) await client.chiudi(false);
    if (veroPy(this.info)) {
      this.info = {};
      this.presenza = { presenza: PRESENZA.ASSENTE, dettaglio: "non collegato" };
      this.suStato?.({ collegato: false, info: {} });
    }
  }

  /** Una richiesta al Bridge: si risolve con `data` della risposta; ErroreLink("not_connected") se non è collegato. */
  richiesta(cmd, args = null, tempo = TEMPO_RICHIESTA) {
    if (!this.collegato || this.client === null) return Promise.reject(new ErroreLink("not_connected", TESTI.nonCollegato));
    return this.client.richiesta(cmd, args, tempo);
  }
}

// ---------------- pannello di collegamento (bridge_panel.py) ----------------

/** Il testo sotto il pannello: scheda, versione, pin 1-Wire e pin utilizzabili, oppure come collegare il Bridge. */
export function testoInfo(info) {
  if (!veroPy(info)) {
    return "Polpo Bridge non collegato. Carica lo sketch studio/bridge/polpo_bridge su un Arduino Uno/Nano o un ESP32 e collegalo via USB.";
  }
  const pin = elementiPy(prendiPy(info, "pins", [])).map(strPy).join(", ");
  return `Collegato: ${strPy(prendiPy(info, "board"))}, versione ${strPy(prendiPy(info, "version"))}. 1-Wire sul pin ${strPy(prendiPy(info, "onewire_pin"))}. Pin utilizzabili: ${pin}`;
}

/** Prima di collegare: `{errore}` se non c'è una porta, altrimenti il messaggio d'attesa. */
export function preparaCollegamento(porta) {
  if (!veroPy(porta)) return { errore: TESTI.nessunaPorta, messaggio: "" };
  return { errore: "", messaggio: `Cerco il Polpo Bridge su ${porta}…` };
}

/** Il messaggio di un collegamento non riuscito (come ToolBase.fail): il testo dell'errore. */
export function testoFallimento(e) {
  if (e instanceof ErroreLink && e.codice === "denied") return TESTI.rifiutato;
  return e instanceof Error ? e.message : strPy(e);
}

/** Il messaggio di una richiesta non riuscita: lo sketch non ha schermo, "denied" è un suo rifiuto con il suo testo. */
export function testoErroreBridge(e) {
  return `Polpo Bridge: ${e instanceof Error ? e.message : strPy(e)}`;
}

/** Una riga del registro della scheda con l'ora ("09:05:07  testo"). */
export function conOra(testo, ora) {
  return `${ora}  ${testo}`;
}

// Come `x in lista` di Python per i valori di JSON (numeri e booleani confrontati come numeri).
function contiene(lista, x) {
  const num = (v) => typeof v === "number" || typeof v === "boolean" || typeof v === "bigint";
  return elementiPy(lista).some((y) => (num(x) && num(y) ? Number(x) === Number(y) : x === y));
}

/** Le voci del menu dei pin: [etichetta, pin], con « · ADC» per i pin con convertitore analogico. */
export function vociPin(info) {
  const adc = prendiPy(info, "adc", []);
  return elementiPy(prendiPy(info, "pins", [])).map((p) => [strPy(p) + (contiene(adc, p) ? " · ADC" : ""), p]);
}

// ---------------- azioni (gpio_tools.py, ibutton_tools.py) ----------------

/**
 * Un'azione sul Bridge: il comando con i suoi argomenti, l'eventuale azione della modalità laboratorio e conferma da
 * chiedere, e `esito(dati)` che trasforma la risposta in {riga (registro della scheda), messaggio, attivita}.
 * `errore` non vuoto: l'azione non parte.
 */
function azione(comando, argomenti, esito, { laboratorio = null, conferma = null, errore = "" } = {}) {
  return { comando, argomenti, laboratorio, conferma, errore, esito };
}

/** «Imposta modo» del pin: come uscita servono la modalità laboratorio e una conferma. */
export function preparaModo(pin, modo) {
  const esito = (d) => ({ riga: `pin ${strPy(prendiPy(d, "pin"))}: ${strPy(prendiPy(d, "mode"))}` });
  if (pin === null || pin === undefined) return azione(COMANDI.modoPin, null, esito, { errore: TESTI.collegaPrima });
  const uscita = modo === "output";
  return azione(COMANDI.modoPin, { pin, mode: modo }, esito, {
    laboratorio: uscita ? AZIONE_USCITE : null,
    conferma: uscita
      ? { titolo: TESTI.titoloUscita, testo: `Pin ${strPy(pin)}: controlla che non sia collegato a un'altra uscita o a 5 V su una scheda a 3,3 V.` }
      : null,
  });
}

/** «Leggi» il pin. */
export function preparaLettura(pin) {
  return azione(COMANDI.leggiPin, { pin: pin ?? null }, (d) => ({ riga: `pin ${strPy(pin ?? null)} = ${strPy(prendiPy(d, "value"))}` }));
}

/** «Uscita ALTA» (1) o «Uscita BASSA» (0): serve la modalità laboratorio; resta nel registro delle attività. */
export function preparaScrittura(pin, valore) {
  return azione(
    COMANDI.scriviPin,
    { pin: pin ?? null, value: valore },
    (d) => ({ riga: `pin ${strPy(pin ?? null)} ← ${strPy(prendiPy(d, "value"))}`, attivita: ["gpio", `Bridge: pin ${strPy(pin ?? null)} impostato a ${strPy(valore)}`, "avviso"] }),
    { laboratorio: AZIONE_USCITE },
  );
}

// Come `a * b` di Python con b decimale.
function perDecimale(a, b) {
  if (typeof a === "boolean") a = Number(a);
  if (typeof a === "number") return a * b;
  if (typeof a === "bigint") {
    const f = Number(a);
    if (!Number.isFinite(f)) throw errorePy("OverflowError", "int too large to convert to float");
    return f * b;
  }
  const tipo = nomeTipoPy(a);
  if (tipo === "str" || tipo === "list") throw errorePy("TypeError", "can't multiply sequence by non-int of type 'float'");
  throw errorePy("TypeError", `unsupported operand type(s) for *: '${tipo}' and 'float'`);
}

/** Il testo di una lettura ADC: valore grezzo e tensione stimata (riferimento 3,3 V con 12 bit, altrimenti 5 V). */
export function testoAdc(pin, d) {
  const bit = intPy(prendiPy(d, "bits", 10));
  const vref = bit === 12n ? 3.3 : 5.0;
  const prodotto = perDecimale(prendiPy(d, "raw", 0), vref);
  if (bit < 0n) throw errorePy("ValueError", "negative shift count");
  if (bit >= 1024n) throw errorePy("OverflowError", "int too large to convert to float");
  const fondoScala = Number((1n << bit) - 1n);
  if (fondoScala === 0) throw errorePy("ZeroDivisionError", "float division by zero");
  const v = prodotto / fondoScala;
  return `ADC pin ${strPy(pin ?? null)}: ${strPy(prendiPy(d, "raw"))} (≈ ${formatPy(v, ".2f")} V se il riferimento è ${vref === 3.3 ? "3.3" : "5.0"} V)`;
}

/** «Leggi ADC» del pin. */
export function preparaAdc(pin) {
  return azione(COMANDI.leggiAdc, { pin: pin ?? null }, (d) => ({ riga: testoAdc(pin, d) }));
}

/** Il testo della scansione I2C del Bridge: "I2C: 0x28 M5 RFID2 (WS1850S), 0x3C Display OLED" o "nessun dispositivo". */
export function testoI2c(d) {
  const voci = elementiPy(prendiPy(d, "devices", [])).map((a) => stripPy(`0x${formatValorePy(a, "02X")} ${nomeI2c(a, "")}`));
  return "I2C: " + (voci.join(", ") || "nessun dispositivo");
}

/** «Scansione I2C» del Bridge. */
export function preparaI2c() {
  return azione(COMANDI.scansioneI2c, null, (d) => ({ riga: testoI2c(d) }));
}

/** «Cerca chiavi» iButton (ow.search): {roms, righe, messaggio, attivita} come onewire.js esitoRicerca. */
export function preparaRicercaIButton() {
  return azione(COMANDI.ricerca1Wire, null, (d) => {
    const r = esitoRicerca(d);
    return { ...r, attivita: r.attivita ? ["ibutton", r.attivita, "ok"] : null };
  });
}

/** «Controlla presenza» sul bus 1-Wire (ow.reset). */
export function preparaPresenzaIButton() {
  return azione(COMANDI.presenza1Wire, null, (d) => ({ messaggio: messaggioPresenza(d) }));
}

/**
 * Esegue un'azione come i pulsanti di Polpo Studio, nello stesso ordine: errore dell'azione, modalità laboratorio,
 * conferma, Bridge collegato, richiesta. `ambiente`:
 *   gestore      GestoreBridge (o un oggetto con `collegato` e `richiesta(cmd, args, tempo)`)
 *   laboratorio  ModalitaLaboratorio (sicurezza/laboratorio.js), per le uscite
 *   conferma     async (titolo, testo) => vero per procedere
 *   avvisa       (testo, errore) => la riga di stato del modulo
 *   scrivi       (riga) => il registro della scheda (senza ora: vedi conOra)
 *   registro     il registro delle attività; `categoria` del modulo ("gpio" o "ibutton")
 * Restituisce l'esito della risposta, oppure `null` se l'azione non è partita o il Bridge ha risposto con un errore.
 */
export async function eseguiAzione(a, { gestore, laboratorio = null, conferma = async () => false, avvisa = () => {}, scrivi = () => {}, registro = null, categoria = "gpio" }) {
  if (a.errore) {
    avvisa(a.errore, true);
    return null;
  }
  if (a.laboratorio) {
    try {
      laboratorio.richiedi(a.laboratorio);
    } catch (e) {
      if (!(e instanceof PermessoNegato)) throw e;
      avvisa(e.message, true);
      return null;
    }
  }
  if (a.conferma && !(await conferma(a.conferma.titolo, a.conferma.testo))) return null;
  if (!gestore.collegato) {
    avvisa(TESTI.collegaPrima, true);
    return null;
  }
  let dati;
  try {
    dati = await gestore.richiesta(a.comando, a.argomenti, TEMPO_RICHIESTA);
  } catch (e) {
    const t = testoErroreBridge(e);
    avvisa(t, true);
    registro?.aggiungi(categoria, t, "errore");
    return null;
  }
  const r = a.esito(dati);
  if (r.riga !== undefined) scrivi(r.riga);
  if (r.messaggio !== undefined) avvisa(r.messaggio, false);
  if (r.attivita) registro?.aggiungi(...r.attivita);
  return r;
}

// ---------------- porta Grove del Polpo (gpio_tools.py) ----------------

const simulato = (s) => (veroPy(s) ? " · SIMULATO" : "");

// Come len(x) di Python per un valore di JSON.
function lunghezza(x) {
  const tipo = nomeTipoPy(x);
  if (tipo === "str") return Array.from(x).length;
  if (tipo === "list") return x.length;
  if (tipo === "dict") return Object.keys(x).length;
  throw errorePy("TypeError", `object of type '${tipo}' has no len()`);
}

/** La riga di «Leggi i pin» (gpio.pins del Polpo): "09:05:07  G1=1  G2=0". */
export function testoPinGrove(d, sim, ora) {
  return `${ora}  G1=${strPy(prendiPy(d, "g1"))}  G2=${strPy(prendiPy(d, "g2"))}` + simulato(sim);
}

/** Il testo di «Cerca dispositivi I2C» (gpio.i2c_scan del Polpo): una riga con il numero, poi indirizzo e nome. */
export function testoI2cGrove(d, sim, ora) {
  const devs = prendiPy(d, "devices", []);
  const righe = [`${ora}  ${lunghezza(devs)} dispositivi I2C` + simulato(sim)];
  for (const x of elementiPy(devs)) {
    const a = chiavePy(x, "addr");
    const esa = formatValorePy(a, "02X");
    const nome = prendiPy(x, "name");
    righe.push(`   0x${esa}  ${veroPy(nome) ? strPy(nome) : nomeI2c(a, "?")}`);
  }
  return righe.join("\n");
}
