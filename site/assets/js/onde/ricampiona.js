// Polpo Onde — porta l'audio del dispositivo (44,1 o 48 kHz, o altro) a una frequenza interna fissa di 8 kHz,
// tenendo solo la banda che interessa al modem. Così tutto il ricevitore lavora sempre con gli stessi numeri.

export const FS_INTERNA = 8000;
const FASI = 64; // posizioni frazionarie precalcolate tra un campione e l'altro

function sinc(x) {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

export class Ricampionatore {
  /**
   * @param {number} fsIngresso  frequenza di campionamento dell'audio in arrivo
   * @param {object} [o]
   * @param {number} [o.fsUscita=8000]
   * @param {number} [o.da=1150]   inizio della banda passante (Hz, punto a −6 dB)
   * @param {number} [o.a=3600]    fine della banda passante
   * @param {number} [o.meta=0.004] mezza durata del filtro in secondi
   */
  constructor(fsIngresso, { fsUscita = FS_INTERNA, da = 1150, a = 3600, meta = 0.004 } = {}) {
    if (!(fsIngresso >= 2 * a)) throw new RangeError(`frequenza di campionamento troppo bassa: ${fsIngresso} Hz`);
    this.fsIngresso = fsIngresso;
    this.fsUscita = fsUscita;
    this.rapporto = fsIngresso / fsUscita;
    this.H = Math.ceil(meta * fsIngresso);
    const K = 2 * this.H + 1;
    this.K = K;
    this.tabella = new Float32Array(FASI * K);
    for (let q = 0; q < FASI; q++) {
      for (let m = -this.H; m <= this.H; m++) {
        const tau = (m - q / FASI) / fsIngresso; // secondi dal centro
        const u = tau / meta;
        const w = Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u); // Blackman
        const h = (2 * a * sinc(2 * a * tau) - 2 * da * sinc(2 * da * tau)) / fsIngresso;
        this.tabella[q * K + (m + this.H)] = h * w;
      }
    }
    this.buf = new Float32Array(0);
    this.base = 0; // indice assoluto di buf[0]
    this.nUscita = 0; // prossimo campione d'uscita
  }

  /** Riceve un blocco di audio e restituisce i campioni a 8 kHz pronti finora. */
  elabora(blocco) {
    const unito = new Float32Array(this.buf.length + blocco.length);
    unito.set(this.buf);
    unito.set(blocco, this.buf.length);
    const fine = this.base + unito.length; // primo indice assoluto non ancora disponibile
    const H = this.H, K = this.K;
    const stima = Math.max(0, Math.ceil((fine - H) / this.rapporto) - this.nUscita + 1);
    const out = new Float32Array(stima);
    let n = 0;
    for (;;) {
      const p = this.nUscita * this.rapporto;
      let c = Math.floor(p);
      let q = Math.round((p - c) * FASI);
      if (q === FASI) { q = 0; c += 1; }
      if (c + H >= fine) break;
      const t = q * K;
      let acc = 0;
      const i0 = c - H - this.base;
      if (i0 >= 0) {
        for (let m = 0; m < K; m++) acc += unito[i0 + m] * this.tabella[t + m];
      } else {
        for (let m = -i0; m < K; m++) acc += unito[i0 + m] * this.tabella[t + m]; // prima dell'inizio: silenzio
      }
      out[n++] = acc;
      this.nUscita++;
    }
    const tieni = Math.max(0, Math.floor(this.nUscita * this.rapporto) - H - 1 - this.base);
    this.buf = tieni >= unito.length ? new Float32Array(0) : unito.slice(tieni);
    this.base += Math.min(tieni, unito.length);
    return n === out.length ? out : out.subarray(0, n);
  }
}

/** Comodità per le prove: converte un intero segnale in un colpo solo. */
export function ricampiona(segnale, fsIngresso, opzioni) {
  const r = new Ricampionatore(fsIngresso, opzioni);
  const coda = new Float32Array(r.H + Math.ceil(r.rapporto) + 2);
  const a = r.elabora(segnale), b = r.elabora(coda);
  const out = new Float32Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}
