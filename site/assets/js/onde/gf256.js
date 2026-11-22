// Polpo Onde — aritmetica nel campo di Galois GF(2^8).
// Polinomio primitivo x^8 + x^4 + x^3 + x^2 + 1 (0x11D), generatore α = 2: gli stessi dei codici QR.

export const EXP = new Uint8Array(512); // EXP[i] = α^i (ripetuta due volte per evitare il modulo)
export const LOG = new Uint8Array(256); // LOG[α^i] = i; LOG[0] non ha significato

let x = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

export function mul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

export function div(a, b) {
  if (b === 0) throw new RangeError("divisione per zero in GF(256)");
  return a ? EXP[LOG[a] + 255 - LOG[b]] : 0;
}

export function inv(a) {
  if (a === 0) throw new RangeError("zero non ha inverso in GF(256)");
  return EXP[255 - LOG[a]];
}

/** α elevato a n (n può essere negativo). */
export function alfa(n) {
  return EXP[((n % 255) + 255) % 255];
}
