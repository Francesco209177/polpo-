// Salva un file creato dalla pagina. Nel browser è un normale download; nell'app per Android passa da
// PolpoNativo, che apre il selettore «Salva con nome» del telefono (la WebView da sola non scarica nulla).
export function salvaFile(blob, nome) {
  const nativo = window.PolpoNativo;
  if (nativo && nativo.salvaFile) {
    const lettore = new FileReader();
    lettore.onload = () => {
      const dati = String(lettore.result);
      nativo.salvaFile(nome, dati.slice(dati.indexOf(",") + 1));
    };
    lettore.readAsDataURL(blob);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
