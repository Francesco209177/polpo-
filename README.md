# Polpo

Un multi-tool tascabile fai-da-te ispirato al Flipper Zero, costruito su **M5Stack Cardputer** con moduli a innesto
(nessuna saldatura), più **Polpo Studio**, il programma per PC che lo comanda.

| Cartella | Cosa contiene |
|---|---|
| [`polpo/`](polpo/README.md) | Firmware per il Cardputer (PlatformIO), simulatore nel browser, file d'esempio per la microSD |
| [`studio/`](studio/README.md) | **Polpo Studio** per Windows e Linux: radio 433 MHz, NFC, RFID 125 kHz, infrarossi, GPIO, Bluetooth, USB, iButton, cassaforte cifrata, Polpo virtuale |
| [`studio/bridge/`](studio/bridge/LEGGIMI.md) | **Polpo Bridge**: sketch per Arduino Uno/Nano o ESP32 usato da Polpo Studio |
| [`site/`](site/build.py) | Il sito del progetto (GitHub Pages) e **Polpo Onde**, il modem acustico che gira nel browser |

Polpo e Polpo Studio non contengono funzioni per entrare in sistemi altrui (cancelli, veicoli, allarmi, carte
di altre persone): niente disturbo radio, forza bruta, rolling code, copie di badge o emulazione di carte.
Usali solo con dispositivi tuoi o per cui hai l'autorizzazione.

## Sito

**<https://francesco209177.github.io/polpo-/>** — simulatore nel browser, installazione del firmware con un clic,
download di Polpo Studio, lista dei componenti e manuali.

**[Polpo Onde](https://francesco209177.github.io/polpo-/onde/)** (sperimentale) fa arrivare un messaggio da un dispositivo
all'altro con il suono, usando altoparlante e microfono: 16-FSK, sincronizzazione con due chirp, Reed–Solomon.
La specifica è in [`site/docs/PROTOCOLLO_ONDE.md`](site/docs/PROTOCOLLO_ONDE.md).

```bash
python site/build.py --out site/_site --check      # costruisce e controlla il sito (serve: pip install markdown)
cd site && npm test                                # prove del modem: non servono pacchetti, basta Node 22
npm ci && npx playwright install chromium && npm run test:browser   # prove nel browser
```

## Scaricare

| Cosa | Dove |
|---|---|
| Firmware per il Cardputer | Pagina [Installa](https://francesco209177.github.io/polpo-/installa/) del sito (dal browser, con un cavo USB) |
| Polpo Studio per Windows e Linux | [Ultima versione](https://github.com/Francesco209177/polpo-/releases/latest) |

**Polpo Studio dal codice** (Ubuntu/Debian; su altri sistemi serve Python 3.11 o più recente):

```bash
sudo apt install git python3-venv
git clone https://github.com/Francesco209177/polpo-.git
cd polpo-/studio
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
python -m polpo_studio --virtuale
```

Alla prima apertura scegli la frase di accesso della cassaforte e conserva la chiave di recupero su carta.

## Stato del progetto

Firmware e Polpo Studio sono verificati con test automatici, simulatore e autodiagnosi dei pacchetti.
**Non sono ancora stati provati su un Cardputer vero**: se lo fai, apri una segnalazione e racconta com'è andata.
Polpo Onde è verificato in un canale acustico **simulato** e nel browser con un file audio al posto del microfono;
nell'aria vera non è ancora stato provato in modo sistematico.

## Documentazione

- [Manuale del firmware](polpo/docs/MANUALE.md)
- [Manuale di Polpo Studio](studio/docs/MANUALE_STUDIO.md) · [Sicurezza](studio/docs/SICUREZZA.md) ·
  [Hardware esterno](studio/docs/HARDWARE_ESTERNO.md) · [Protocollo Polpo Link](studio/docs/PROTOCOLLO_POLPO_LINK.md) ·
  [Architettura](studio/docs/ARCHITETTURA.md)

## Licenza

MIT — vedi [LICENSE](LICENSE).
