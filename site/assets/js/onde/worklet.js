// Polpo Onde — cattura dell'audio del microfono (gira nel thread audio del browser).
// Fa una cosa sola: raccoglie i campioni e li passa alla pagina a blocchi. Tutta l'elaborazione avviene nella pagina.
class Cattura extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }
  process(ingressi) {
    const canale = ingressi[0] && ingressi[0][0];
    if (canale) {
      for (let i = 0; i < canale.length; i++) {
        this.buf[this.n++] = canale[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("polpo-cattura", Cattura);
