// Polpo Onde — trasformata di Fourier veloce (radice 2, sul posto) e convoluzione.

const tabelle = new Map();

function tabella(n) {
  let t = tabelle.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const inv = new Uint32Array(n);
    const bit = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bit; b++) r |= ((i >> b) & 1) << (bit - 1 - b);
      inv[i] = r;
    }
    t = { cos, sin, inv };
    tabelle.set(n, t);
  }
  return t;
}

export function potenzaDiDue(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Trasformata sul posto di (re, im); la lunghezza deve essere una potenza di due. `inversa` divide anche per n. */
export function fft(re, im, inversa = false) {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) throw new RangeError("la FFT richiede una lunghezza potenza di due");
  const { cos, sin, inv } = tabella(n);
  for (let i = 0; i < n; i++) {
    const j = inv[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const segno = inversa ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const meta = size >> 1;
    const passo = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < meta; k++) {
        const wr = cos[k * passo];
        const wi = segno * sin[k * passo];
        const a = i + k, b = a + meta;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inversa) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Convoluzione di due segnali reali (lunghezza a + b − 1). */
export function convoluzione(a, b) {
  const lung = a.length + b.length - 1;
  const n = potenzaDiDue(lung);
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft(ar, ai, true);
  return Float32Array.from(ar.subarray(0, lung));
}

/** Finestra di Hann di lunghezza n (periodica: adatta all'analisi dello spettro). */
export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
