# Polpo

Un multi-tool tascabile fai-da-te ispirato al Flipper Zero, costruito su **M5Stack Cardputer** con moduli a innesto
(nessuna saldatura), più **Polpo Studio**, il programma per PC che lo comanda.

| Cartella | Cosa contiene |
|---|---|
| [`polpo/`](polpo/README.md) | Firmware per il Cardputer (PlatformIO), simulatore nel browser, pagina web per installare il firmware, file d'esempio per la microSD |
| [`studio/`](studio/README.md) | **Polpo Studio** per Windows e Linux: radio 433 MHz, NFC, RFID 125 kHz, infrarossi, GPIO, Bluetooth, USB, iButton, cassaforte cifrata, Polpo virtuale |
| [`studio/bridge/`](studio/bridge/LEGGIMI.md) | **Polpo Bridge**: sketch per Arduino Uno/Nano o ESP32 usato da Polpo Studio |

Polpo e Polpo Studio non contengono funzioni per entrare in sistemi altrui (cancelli, veicoli, allarmi, carte
di altre persone): niente disturbo radio, forza bruta, rolling code, copie di badge o emulazione di carte.
Usali solo con dispositivi tuoi o per cui hai l'autorizzazione.

## Provare Polpo Studio senza hardware

**Pacchetto pronto**: nella pagina [Actions](../../actions) apri l'ultima esecuzione riuscita e scarica
`PolpoStudio-Linux` o `PolpoStudio-Windows` dalla sezione *Artifacts*.

**Dal codice** (Ubuntu/Debian; su altri sistemi serve Python 3.11 o più recente):

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

## Documentazione

- [Manuale del firmware](polpo/docs/MANUALE.md)
- [Manuale di Polpo Studio](studio/docs/MANUALE_STUDIO.md) · [Sicurezza](studio/docs/SICUREZZA.md) ·
  [Hardware esterno](studio/docs/HARDWARE_ESTERNO.md) · [Protocollo Polpo Link](studio/docs/PROTOCOLLO_POLPO_LINK.md) ·
  [Architettura](studio/docs/ARCHITETTURA.md)

## Licenza

MIT — vedi [LICENSE](LICENSE).
