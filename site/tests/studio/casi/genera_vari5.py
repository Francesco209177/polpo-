#!/usr/bin/env python3
"""Genera i casi di prova «vari5» per la copia JavaScript di Polpo Studio (versione 0.5.0: il telefono da solo).

Esegue il codice Python dello Studio — Polpo Bridge (devices/bridge.py, app/tools/bridge_panel.py e le schede Bridge e
Grove di gpio_tools.py, iButton), elenchi USB e porte seriali (devices/usb_list.py, serial_ports.py, usb_tools.py),
console seriale (devices/serial_console.py e la sua scheda), Bluetooth (devices/ble.py, bluetooth_tools.py, la
scansione di polpo_tools.py) e app integrate (core/apps.py, apps_tools.py) — su molti ingressi (normali, al limite,
sbagliati; quelli casuali con semi fissi) e scrive i risultati in site/tests/studio/casi/vari5/*.json. Gli strumenti
dell'interfaccia sono quelli veri (Qt senza schermo) con un contesto finto al posto di Polpo, cassaforte e Bluetooth.
Le prove in site/tests/studio/vari5/ controllano che i moduli JavaScript diano esattamente gli stessi risultati.

Uso, dalla radice del repository, con l'ambiente Python dello Studio:
    QT_QPA_PLATFORM=offscreen python site/tests/studio/casi/genera_vari5.py
Rigenerare deve dare file identici byte per byte (il collegamento al Bridge aspetta davvero: qualche secondo).

Convenzioni nei file (come nfc_vari): i byte sono testi esadecimali minuscoli; un errore è {"errore": {"tipo", "msg"}}
con il nome della classe Python (più "code" per LinkError); i testi con surrogati isolati sono {"cp": [codici]}.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import math
import os
import random
import re
import sys
import tempfile
import time
import types
from concurrent.futures import Future
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from polpo_studio.core import i18n  # noqa: E402

i18n.set_language("it")

from PySide6.QtWidgets import QApplication, QCheckBox, QLabel, QLineEdit  # noqa: E402

from polpo_studio import apps as integrate  # noqa: E402
from polpo_studio.app.tools import apps_tools, bluetooth_tools, bridge_panel, common, gpio_tools, ibutton_tools, polpo_tools, usb_tools  # noqa: E402
from polpo_studio.core import apps as core_apps  # noqa: E402
from polpo_studio.core import capability, hardware  # noqa: E402
from polpo_studio.core.capability import HardwareStatus, Presence  # noqa: E402
from polpo_studio.devices import ble, serial_console, serial_ports, usb_list  # noqa: E402
from polpo_studio.devices import bridge as bridge_mod  # noqa: E402
from polpo_studio.devices.link_client import LinkError  # noqa: E402
from polpo_studio.devices.transport import Transport, TransportError  # noqa: E402
from polpo_studio.security import vault as vault_mod  # noqa: E402
from polpo_studio.security.lab import ACTIONS, LabMode  # noqa: E402

QUI = Path(__file__).resolve().parent
RADICE = QUI.parents[3]
USCITA = QUI / "vari5"
APP = QApplication.instance() or QApplication([])
logging.getLogger("polpo_studio").setLevel(logging.ERROR)  # le righe rotte dei casi di prova sono volute

# Ora fissa per tutto ciò che scrive data e ora: 22/11/2026 09:05:07, ora locale.
ORA_FISSA = time.struct_time((2026, 11, 22, 9, 5, 7, 6, 326, 0))


class TempoFisso:
    @staticmethod
    def strftime(fmt: str) -> str:
        return time.strftime(fmt, ORA_FISSA)

    monotonic = staticmethod(time.monotonic)
    time = staticmethod(time.time)


for _m in (gpio_tools, bluetooth_tools, common, ibutton_tools):
    _m.time = TempoFisso


# ---------------- conversione in JSON ----------------


def ha_surrogati(s: str) -> bool:
    return any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def J(x):
    """Valore Python → valore JSON (byte in esadecimale, interi enormi e decimali non finiti come oggetti)."""
    if x is None or isinstance(x, bool):
        return x
    if isinstance(x, str):
        return {"cp": [ord(c) for c in x]} if ha_surrogati(x) else x
    if isinstance(x, int):
        return x if abs(x) < 2**53 else {"int": str(x)}
    if isinstance(x, float):
        return x if math.isfinite(x) else {"float": repr(x)}
    if isinstance(x, (bytes, bytearray)):
        return bytes(x).hex()
    if isinstance(x, (list, tuple)):
        return [J(v) for v in x]
    if isinstance(x, dict):
        return {str(k): J(v) for k, v in x.items()}
    if dataclasses.is_dataclass(x):
        return {f.name: J(getattr(x, f.name)) for f in dataclasses.fields(x)}
    raise TypeError(f"non convertibile: {x!r}")


def nome_eccezione(e: BaseException) -> str:
    return type(e).__name__


def errore(e: BaseException) -> dict:
    d = {"tipo": nome_eccezione(e), "msg": str(e)}
    if isinstance(e, LinkError):
        d["code"] = e.code
    return d


def esito(f, *a, conv=J, **k):
    try:
        r = f(*a, **k)
    except Exception as e:  # noqa: BLE001 - si registra qualunque eccezione, con tipo e messaggio
        return {"errore": errore(e)}
    return {"ok": conv(r)}


def scrivi(nome: str, dati: dict) -> None:
    USCITA.mkdir(parents=True, exist_ok=True)
    testo = json.dumps(dati, sort_keys=True, indent=1, ensure_ascii=False) + "\n"
    (USCITA / f"{nome}.json").write_text(testo, encoding="utf-8", newline="\n")
    print(f"{nome}.json: {sum(len(v) for v in dati.values() if isinstance(v, list))} casi")


def byte_casuali(rnd: random.Random, n: int) -> bytes:
    return bytes(rnd.randrange(256) for _ in range(n))


def fatto(valore=None, errore_=None) -> Future:
    f: Future = Future()
    if errore_ is not None:
        f.set_exception(errore_)
    else:
        f.set_result(valore)
    return f


# ---------------- contesto finto ----------------


class Scena:
    """Gli eventi in ordine (messaggi, richieste, conferme, righe, attività) e la risposta alle conferme."""

    def __init__(self, conferma: bool = True) -> None:
        self.eventi: list = []
        self.conferma = conferma


SCENA = Scena()


def evento(*e) -> None:
    SCENA.eventi.append(J(list(e)))


def conferma_finta(_parent, titolo, testo, **_k) -> bool:
    evento("conferma", titolo, testo)
    return SCENA.conferma


common.confirm_sensitive = conferma_finta


class Registro:
    def add(self, categoria, messaggio, livello="info", simulato=False) -> None:
        evento("attivita", categoria, messaggio, livello)


class Elemento:
    def __init__(self, ident, categoria, nome, dati, meta) -> None:
        self.id, self.category, self.name, self.dati, self.meta = ident, categoria, nome, dati, meta


class Cassaforte:
    def __init__(self) -> None:
        self.voci: list[Elemento] = []
        self.rotta = False

    def items(self, categoria):
        return [v for v in self.voci if v.category == categoria]

    def get(self, ident):
        if self.rotta:
            raise vault_mod.VaultError("locked", "cassaforte chiusa")
        return next(v for v in self.voci if v.id == ident).dati

    def put(self, categoria, nome, dati, meta=None):
        evento("messo", categoria, nome, dati.decode("utf-8", "surrogatepass"), meta or {})
        self.voci.append(Elemento(str(len(self.voci)), categoria, nome, dati, meta or {}))

    def update(self, ident, data=None, **_k):
        v = next(v for v in self.voci if v.id == ident)
        evento("aggiornato", v.category, v.name, data.decode("utf-8", "surrogatepass"))
        v.dati = data


class BridgeFinto:
    def __init__(self) -> None:
        self.connected = False
        self.info: dict = {}
        self.risposta = ("ok", {})
        self.collega = ("ok", {})

    def request(self, cmd, args=None, timeout=5.0):
        evento("richiesta", cmd, args, timeout)
        k, v = self.risposta
        return fatto(v) if k == "ok" else fatto(errore_=v)

    def connect(self, port, transport=None):
        evento("collega", port)
        k, v = self.collega
        return fatto(v) if k == "ok" else fatto(errore_=v)

    def disconnect(self):
        return fatto(None)


class Ponte:
    """Al posto di GuiBridge: le promesse sono già risolte, i richiami partono subito."""

    def __init__(self) -> None:
        self.event = types.SimpleNamespace(connect=lambda *_a: None)

    def watch(self, fut, ok=None, err=None) -> None:
        e = fut.exception()
        if e is not None:
            if err:
                err(e)
        elif ok:
            ok(fut.result())

    def call_in_gui(self, fn) -> None:
        fn()


class Hardware:
    def __init__(self) -> None:
        self.stato: dict = {}

    def snapshot(self):
        return dict(self.stato)

    def set_pc(self, ident, st) -> None:
        evento("hardware", ident, st.presence.value, st.detail)


def contesto(cartella: str) -> types.SimpleNamespace:
    ctx = types.SimpleNamespace()
    ctx.activity = Registro()
    ctx.vault = Cassaforte()
    ctx.bus = types.SimpleNamespace(publish=lambda *_a, **_k: None)
    ctx.settings = types.SimpleNamespace(get=lambda _k: {}, set=lambda *_a: None)
    ctx.devices = types.SimpleNamespace(connected=False, simulated=False, client=None, request=None, run=lambda fn: fatto(None))
    ctx.bridge = BridgeFinto()
    ctx.lab = LabMode()
    ctx.hardware = Hardware()
    ctx.data_dir = Path(cartella)
    return ctx


def strumento(classe, ctx, **k):
    t = classe(ctx, Ponte(), **k)
    t.say = lambda testo, error=False: evento("avviso", testo, error)
    return t


def testi_etichette(w) -> list[str]:
    return sorted({lb.text() for lb in w.findChildren(QLabel) if lb.text()})


def celle(tabella) -> list[list[str]]:
    return [[tabella.item(r, c).text() if tabella.item(r, c) else None for c in range(tabella.columnCount())] for r in range(tabella.rowCount())]


def intestazioni(tabella) -> list[str]:
    return [tabella.horizontalHeaderItem(c).text() for c in range(tabella.columnCount())]


def voci(combo) -> list:
    return [[combo.itemText(i), J(combo.itemData(i))] for i in range(combo.count())]


# ---------------- porte e dispositivi finti ----------------


class PortaFinta:
    def __init__(self, device, description=None, vid=None, pid=None, serial_number=None, manufacturer=None) -> None:
        self.device, self.description, self.vid, self.pid, self.serial_number, self.manufacturer = device, description, vid, pid, serial_number, manufacturer


PORTE_GREZZE: list = []


def comports_finte():
    return list(PORTE_GREZZE)


import serial.tools.list_ports as _lp  # noqa: E402

_lp.comports = comports_finte

CHIP_VID_PID = [(0x303A, 0x1001), (0x303A, 0x4001), (0x1A86, 0x7523), (0x1A86, 0x55D4), (0x1A86, 0x5523), (0x1A86, 0x1234), (0x10C4, 0xEA60), (0x0403, 0x6001), (0x0403, 0x6010),
                (0x0403, 0x6014), (0x0403, 0x6015), (0x0403, 0x6011), (0x067B, 0x2303), (0x2341, 0x0043), (0x2A03, 0x0043), (0x2E8A, 0x000A), (0x239A, 0x8014), (0x1B4F, 0x9206),
                (0x046D, 0xC52B), (0x05AC, 0x12A8), (0xFFFF, 0xFFFF), (0x0000, 0x0000)]  # fmt: skip


def porta_casuale(rnd: random.Random, i: int) -> PortaFinta:
    nome = rnd.choice(["/dev/ttyUSB", "/dev/ttyACM", "COM", "/dev/cu.usbserial-", "/dev/ttyS", "/dev/cu.usbmodem"]) + str(rnd.randint(0, 30) * 10 + i % 10)
    if rnd.random() < 0.15:
        return PortaFinta(nome, rnd.choice([None, "", "Porta di comunicazione", "n/a"]))
    vid, pid = rnd.choice(CHIP_VID_PID) if rnd.random() < 0.8 else (rnd.randrange(0x10000), rnd.randrange(0x10000))
    desc = rnd.choice([None, "", "USB Serial", "CP2102 USB to UART Bridge Controller", "USB JTAG/serial debug unit", "Arduino Uno", "Scheda ñ 🐙"])
    return PortaFinta(nome, desc, vid, pid, rnd.choice([None, "", "A50285BI", "0001"]), rnd.choice([None, "", "Silicon Labs", "Espressif", "wch.cn", "FTDI"]))


def dispositivo_casuale(rnd: random.Random) -> usb_list.UsbDevice:
    vid, pid = rnd.choice(CHIP_VID_PID) if rnd.random() < 0.6 else (rnd.randrange(0x10000), rnd.randrange(0x10000))
    classe = rnd.choice([None, *usb_list.CLASS_NAMES.keys(), rnd.randrange(256)])
    return usb_list.UsbDevice(
        vid, pid, rnd.choice(["USB", "CP2102 USB to UART", "Tastiera", "Hub USB 2.0", "Espressif", "Mouse ottico ñ", "🐙 Polpo"]),
        rnd.choice(["", "", "Logitech", "Silicon Labs", "Espressif Systems"]), rnd.choice(["", "1234"]), rnd.choice(["", "bus 1 · 1-1.2", "0x14100000"]),
        rnd.choice(["", "12 Mbit/s", "480 Mbit/s"]), classe, rnd.choice(["", "cdc_acm", "usbhid, usbfs", "cp210x"]),
    )  # fmt: skip


def porta_json(p: serial_ports.PortInfo) -> dict:
    return {"dispositivo": p.device, "descrizione": p.description, "vid": p.vid, "pid": p.pid, "numeroSerie": p.serial_number, "produttore": p.manufacturer, "chip": p.chip}


def dispositivo_json(d: usb_list.UsbDevice) -> dict:
    return {"vid": d.vid, "pid": d.pid, "nome": d.name, "produttore": d.manufacturer, "numeroSerie": d.serial, "posizione": d.location, "velocita": d.speed, "classe": d.device_class, "driver": d.driver}


# ======================================================================================================
# Polpo Bridge
# ======================================================================================================

INFO_AVR = {"bridge": "Polpo Bridge", "version": "0.1.0", "proto": 1, "board": "Arduino AVR (5 V)", "pins": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
            "adc": [14, 15, 16, 17, 20, 21], "onewire_pin": 4, "adc_bits": 10}  # fmt: skip
INFO_ESP = {"bridge": "Polpo Bridge", "version": "0.1.0", "proto": 1, "board": "ESP32 (3,3 V)", "pins": [4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
            "adc": [32, 33, 34, 35, 36, 39], "onewire_pin": 4, "adc_bits": 12}  # fmt: skip
INFO_S3 = {"bridge": "Polpo Bridge", "version": "0.1.0", "proto": 1, "board": "ESP32-S3 (3,3 V)", "pins": [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21],
           "adc": [1, 2, 4, 5, 6, 7, 8, 9, 10], "onewire_pin": 4, "adc_bits": 12}  # fmt: skip


class TrasportoFinto(Transport):
    """Risponde a ogni riga con l'azione successiva: ok, errore, errore con id 0, riga qualsiasi o silenzio."""

    def __init__(self, azioni, apertura=None) -> None:
        self.azioni = [list(a) for a in azioni]
        self.apertura = apertura
        self.scritte: list = []
        self.on_line = self.on_closed = None

    def open(self, on_line, on_closed) -> None:
        if self.apertura:
            raise TransportError(self.apertura)
        self.on_line, self.on_closed = on_line, on_closed

    def write_line(self, line: bytes) -> None:
        msg = json.loads(line)
        self.scritte.append(msg)
        a = self.azioni.pop(0) if self.azioni else ["zitto"]
        if a[0] == "ok":
            self.on_line(json.dumps({"id": msg["id"], "ok": True, "data": a[1]}).encode())
        elif a[0] in ("err", "err0"):
            self.on_line(json.dumps({"id": msg["id"] if a[0] == "err" else 0, "ok": False, "error": {"code": a[1], "msg": a[2]}}).encode())
        elif a[0] == "riga":
            self.on_line(a[1].encode())

    def close(self) -> None:
        pass


class Orologio:
    """Il tempo di bridge.py: avanza di un secondo a ogni lettura (i tentativi di hello durano 1 s)."""

    def __init__(self) -> None:
        self.t = -1.0

    def monotonic(self) -> float:
        self.t += 1.0
        return self.t


class ClientSvelto(bridge_mod.PolpoLinkClient):
    """Il client vero, che dopo «busy» riprova subito: l'esito non cambia, ma non dipende dalla velocità della macchina."""

    def __init__(self, *a, **k) -> None:
        super().__init__(*a, **k)
        self.busy_retry = 0.02


def casi_collega() -> list:
    scenari = [
        ("subito", [["ok", INFO_AVR]], 6, None, "scollega"),
        ("esp32_staccato", [["ok", INFO_ESP]], 6, None, "stacca"),
        ("zitto_poi_ok", [["zitto"], ["ok", INFO_S3], ["ok", {"value": 1}]], 2, None, "richiesta"),
        ("due_zitti_poi_ok", [["zitto"], ["zitto"], ["ok", INFO_AVR], ["err", "denied", "pin non utilizzabile su questa scheda"]], 2, None, "richiesta"),
        ("sempre_zitto", [], 2, None, None),
        ("zitto_senza_attesa", [], 0, None, None),
        ("comando_sconosciuto", [["err", "unknown_cmd", "comando sconosciuto"]], 6, None, None),
        ("json_rotto_id_zero", [["err0", "bad_json", "JSON non valido"]], 6, None, None),
        ("altra_scheda", [["ok", {"bridge": "Altro", "board": "X"}]], 6, None, None),
        ("risposta_vuota", [["ok", {}]], 6, None, None),
        ("risposta_lista", [["ok", [1, 2]]], 6, None, None),
        ("bridge_numero", [["ok", {"bridge": 5}]], 6, None, None),
        ("senza_scheda", [["ok", {"bridge": "Polpo Bridge"}]], 6, None, "scollega"),
        ("apertura_fallita", [], 6, "porta occupata da un altro programma", None),
        ("riga_rotta", [["riga", "{rotto"]], 0, None, None),
        ("occupato_poi_ok", [["err", "busy", "occupato"], ["ok", INFO_AVR]], 6, None, "scollega"),
        ("ok_non_bridge_poi_niente", [["ok", {"bridge": "Polpo Bridge ", "board": "X"}]], 6, None, None),
    ]
    out = []
    for nome, azioni, attesa, apertura, dopo in scenari:
        SCENA.eventi = []
        bus = types.SimpleNamespace(publish=lambda topic, **k: evento("stato", topic, k.get("connected"), k.get("info")))
        hw = Hardware()
        mgr = bridge_mod.BridgeManager(bus, hw, Registro())
        tr = TrasportoFinto(azioni, apertura)
        vecchi = bridge_mod.time, bridge_mod.PolpoLinkClient
        bridge_mod.time, bridge_mod.PolpoLinkClient = Orologio(), ClientSvelto
        try:
            r = esito(mgr._connect, "COM5", tr, attesa)
        finally:
            bridge_mod.time, bridge_mod.PolpoLinkClient = vecchi
        caso = {"nome": nome, "azioni": azioni, "attesa": attesa, "apertura": apertura, "porta": "COM5", "r": r, "eventi": SCENA.eventi, "collegato": mgr.connected, "dopo": dopo}
        SCENA.eventi = []
        if dopo == "scollega":
            mgr._disconnect()
        elif dopo == "stacca":
            tr.on_closed("unplugged")
        elif dopo == "richiesta":
            caso["richiesta"] = esito(lambda: mgr.request("pin.read", {"pin": 4}).result(timeout=3))
            mgr._disconnect()
        caso["eventi_dopo"] = SCENA.eventi
        caso["collegato_dopo"] = mgr.connected
        caso["richiesta_dopo"] = esito(lambda: mgr.request("pin.read", {"pin": 4}).result(timeout=3))
        caso["scritte"] = tr.scritte
        SCENA.eventi = []
        mgr.shutdown()
        out.append(caso)
    SCENA.eventi = []
    return out


def casi_bridge(cartella: str) -> dict:
    rnd = random.Random(51)
    out: dict = {}
    ctx = contesto(cartella)
    PORTE_GREZZE[:] = []
    gpio = strumento(gpio_tools.GpioTools, ctx)
    gpio._b_log = lambda testo: evento("riga", testo)
    ib = strumento(ibutton_tools.IButtonTools, ctx)
    out["costanti"] = {
        "i2c": [[k, v] for k, v in common.I2C_NAMES.items()],
        "modi": voci(gpio.b_mode),
        "tensioni": str(gpio_tools.VOLTAGE_NOTE),
        "etichette": sorted(set(testi_etichette(gpio) + testi_etichette(ib))),
        "laboratorio": {k: str(v) for k, v in ACTIONS.items()},
    }
    # pannello: testo d'informazione
    infos = [{}, INFO_AVR, INFO_ESP, INFO_S3, {"bridge": "Polpo Bridge"}, {"board": None, "version": 2, "onewire_pin": "4", "pins": []}, {"pins": "abc", "board": "B"}, {"x": 1},
             {"pins": [1.5, True, None, "7"], "version": "0.2.0", "board": "Prova ñ"}]  # fmt: skip
    out["info"] = []
    for info in infos:
        ctx.bridge.info = info
        out["info"].append({"info": info, "r": esito(lambda: (gpio.bpanel.update_info(), gpio.bpanel.info.text())[1])})
    # menu dei pin
    out["pin"] = []
    for info in [{}, INFO_AVR, INFO_ESP, {"pins": [4, 5], "adc": [5]}, {"pins": [1, True, 2.5], "adc": [1.0, 1]}, {"pins": [3], "adc": []}, {"pins": ["a", 4], "adc": ["a"]}]:
        ctx.bridge.info = info
        gpio._b_pins()
        out["pin"].append({"info": info, "r": voci(gpio.b_pin)})
    # porte del pannello
    out["porte"] = []
    for k in range(14):
        PORTE_GREZZE[:] = [porta_casuale(rnd, i) for i in range(rnd.randint(0, 6))]
        ports = serial_ports.list_ports()
        occupata = rnd.choice([None, ports[0].device if ports else None, "/dev/nessuna"])
        ctx.devices.client = types.SimpleNamespace(transport=types.SimpleNamespace(port=occupata)) if occupata or k % 3 else None
        gpio.bpanel.refresh_ports()
        out["porte"].append({"porte": [porta_json(p) for p in ports], "occupata": occupata if ctx.devices.client else None, "r": voci(gpio.bpanel.port)})
    ctx.devices.client = None
    PORTE_GREZZE[:] = []
    # pannello: collega e scollega
    out["pannello"] = []
    for porta, risposta in [(None, None), ("COM5", ("ok", INFO_AVR)), ("/dev/ttyUSB0", ("err", LinkError("not_bridge", "Nessun Polpo Bridge su /dev/ttyUSB0: carica lo sketch sulla scheda."))),
                            ("COM7", ("err", LinkError("denied", "no"))), ("COM8", ("err", LinkError("io_error", "porta occupata"))), ("COM9", ("err", RuntimeError("guasto")))]:  # fmt: skip
        SCENA.eventi = []
        gpio.bpanel.port.clear()
        if risposta:
            ctx.bridge.collega = risposta
        gpio.bpanel.connect(porta)
        out["pannello"].append({"porta": porta, "risposta": None if risposta is None else [risposta[0], errore(risposta[1]) if risposta[0] == "err" else risposta[1]], "eventi": SCENA.eventi})
    SCENA.eventi = []
    gpio.bpanel.disconnect()
    out["scollega"] = SCENA.eventi
    # azioni della scheda Polpo Bridge e del modulo iButton
    out["azioni"] = []
    roms = {"roms": [{"rom": "01 A2 B3 C4 D5 E6 00 7F", "crc_ok": False}, {"rom": "28 FF 4A 1B 2C 3D 4E 5F"}, {"rom": "zz"}]}
    dati_ok = {"modo": None, "leggi": {"value": 1}, "alta": {"value": 1}, "bassa": {"value": 0}, "adc": {"raw": 512, "bits": 10}, "i2c": {"devices": [0x28, 0x3C, 0x50, 0x11]},
               "cerca": roms, "presenza": {"presence": True}}  # fmt: skip
    errori = [LinkError("denied", "imposta prima il pin come uscita (pin.mode)"), LinkError("timeout", "il Polpo non ha risposto in tempo"), LinkError("not_connected", "Polpo Bridge non collegato")]
    for tipo in ["modo", "leggi", "alta", "bassa", "adc", "i2c", "cerca", "presenza"]:
        for collegato in (False, True):
            for lab in (False, True):
                for pin in (None, 4, 34):
                    for modo in (["input", "input_pullup", "output"] if tipo == "modo" else [None]):
                        for risp in ["ok", 0, 1, 2]:
                            for conf in ([True, False] if tipo == "modo" and modo == "output" else [True]):
                                if tipo in ("i2c", "cerca", "presenza") and pin == 34:
                                    continue
                                SCENA.eventi, SCENA.conferma = [], conf
                                ctx.lab = LabMode()
                                if lab:
                                    ctx.lab.enable(30)
                                ctx.bridge.connected = collegato
                                ctx.bridge.info = {"pins": [] if pin is None else [pin], "adc": [] if pin is None else [pin]}
                                gpio._b_pins()
                                if modo:
                                    gpio.b_mode.setCurrentIndex(gpio.b_mode.findData(modo))
                                dati = dati_ok[tipo] if dati_ok[tipo] is not None else {"pin": pin, "mode": modo}
                                ctx.bridge.risposta = ("ok", dati) if risp == "ok" else ("err", errori[risp])
                                fn = {"modo": gpio.b_set_mode, "leggi": gpio.b_read, "alta": lambda: gpio.b_write(1), "bassa": lambda: gpio.b_write(0), "adc": gpio.b_adc, "i2c": gpio.b_i2c,
                                      "cerca": ib.search, "presenza": ib.presence}[tipo]  # fmt: skip
                                try:
                                    fn()
                                except Exception as e:  # noqa: BLE001
                                    evento("errore", errore(e))
                                out["azioni"].append({"tipo": tipo, "collegato": collegato, "lab": lab, "pin": pin, "modo": modo, "conferma": conf,
                                                      "risposta": ["ok", dati] if risp == "ok" else ["err", errore(errori[risp])], "eventi": SCENA.eventi})  # fmt: skip
    SCENA.eventi, SCENA.conferma = [], True
    ctx.bridge.connected = True
    ctx.lab = LabMode()
    # testi delle risposte: ADC, I2C, lettura e modo, con dati strani
    def risposta_ok(fn, d):
        SCENA.eventi = []
        ctx.bridge.risposta = ("ok", d)
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            return {"errore": errore(e)}
        righe = [e[1] for e in SCENA.eventi if e[0] == "riga"]
        return {"ok": righe[0] if righe else None}

    ctx.bridge.info = {"pins": [32], "adc": [32]}
    gpio._b_pins()
    adc = [{}, {"raw": 0}, {"raw": 1023}, {"raw": 4095, "bits": 12}, {"raw": 2048, "bits": 12}, {"raw": 512, "bits": "12"}, {"raw": 512, "bits": 12.9}, {"raw": 512, "bits": True},
           {"raw": 7, "bits": 0}, {"raw": 7, "bits": -1}, {"raw": 7, "bits": 1}, {"raw": 7, "bits": 64}, {"raw": 7, "bits": 1023}, {"raw": 7, "bits": 1024}, {"raw": 7, "bits": 2000},
           {"raw": None}, {"raw": "512"}, {"raw": [1]}, {"raw": {"a": 1}}, {"raw": True, "bits": 10}, {"raw": 1.5}, {"raw": -3, "bits": 8}, {"bits": None}, {"bits": "abc"}, {"bits": []},
           {"raw": 512, "bits": " 12 "}, {"raw": 10**20}]  # fmt: skip
    adc += [{"raw": rnd.randint(0, 4095), "bits": rnd.choice([8, 10, 12, 16])} for _ in range(30)]
    out["adc"] = [{"pin": 32, "d": d, "r": risposta_ok(gpio.b_adc, d)} for d in adc]
    ctx.bridge.info = {"pins": [], "adc": []}
    gpio._b_pins()
    out["adc"] += [{"pin": None, "d": d, "r": risposta_ok(gpio.b_adc, d)} for d in adc[:4]]
    i2c = [{}, {"devices": []}, {"devices": [0x28]}, {"devices": [8, 0x3C, 0x77, 0x7F, 0x00]}, {"devices": [True, False]}, {"devices": "ab"}, {"devices": None}, {"devices": [None]},
           {"devices": [1.5]}, {"devices": [[1]]}, {"devices": [{"a": 1}]}, {"devices": {"40": 1}}, {"devices": {}}, {"devices": [-1, 300, 0x1234]}]  # fmt: skip
    i2c += [{"devices": sorted(rnd.sample(range(8, 0x78), rnd.randint(0, 8)))} for _ in range(20)]
    out["i2c"] = [{"d": d, "r": risposta_ok(gpio.b_i2c, d)} for d in i2c]
    ctx.bridge.info = {"pins": [5], "adc": []}
    gpio._b_pins()
    vari = [{}, {"value": 0}, {"value": None}, {"value": "x"}, {"value": [1, 2]}, {"value": {"a": "b"}}, {"value": 1.25}, {"value": True}, {"pin": 9, "mode": "output"}, {"mode": "ñ"}]
    out["leggi"] = [{"d": d, "r": risposta_ok(gpio.b_read, d)} for d in vari]
    gpio.b_mode.setCurrentIndex(gpio.b_mode.findData("input"))
    out["modo"] = [{"d": d, "r": risposta_ok(gpio.b_set_mode, d)} for d in vari]
    lab_on = LabMode()
    lab_on.enable(30)
    ctx.lab = lab_on
    out["scrivi"] = [{"d": d, "r": risposta_ok(lambda: gpio.b_write(1), d)} for d in vari]
    ctx.lab = LabMode()
    # porta Grove (comandi del Polpo)
    out["grove"] = []
    pins = [{}, {"g1": 1, "g2": 0}, {"g1": None}, {"g1": "alto", "g2": [1]}, {"g1": True, "g2": 1.5}]
    scans = [{}, {"devices": []}, {"devices": [{"addr": 0x28}, {"addr": 0x3C, "name": "Schermo"}, {"addr": 0x10}, {"addr": 0x68, "name": ""}, {"addr": True}]},
             {"devices": [{"name": "x"}]}, {"devices": ["a"]}, {"devices": [{"addr": "x"}]}, {"devices": [{"addr": 5, "name": 7}]}, {"devices": None}, {"devices": "ab"},
             {"devices": [{"addr": 1.5}]}, {"devices": {"k": 1}}]  # fmt: skip
    for sim in (False, True):
        ctx.devices.connected, ctx.devices.simulated = True, sim
        for d in pins:
            gpio.grove_out.clear()
            ctx.devices.request = lambda _c, _a, _t, d=d: fatto(d)
            r = esito(lambda: (gpio.read_pins(), gpio.grove_out.toPlainText())[1])
            out["grove"].append({"cmd": "gpio.pins", "sim": sim, "d": d, "r": r})
        for d in scans:
            gpio.grove_out.clear()
            ctx.devices.request = lambda _c, _a, _t, d=d: fatto(d)
            r = esito(lambda: (gpio.i2c_scan(), gpio.grove_out.toPlainText())[1])
            out["grove"].append({"cmd": "gpio.i2c_scan", "sim": sim, "d": d, "r": r})
    ctx.devices.connected, ctx.devices.simulated = False, False
    # la riga del registro della scheda, con l'ora
    gpio2 = gpio_tools.GpioTools(ctx, Ponte())
    gpio2._b_log("pin 4 = 1")
    out["riga_con_ora"] = gpio2.b_out.toPlainText()
    out["collega"] = casi_collega()
    gpio.deleteLater()
    gpio2.deleteLater()
    ib.deleteLater()
    return out


# ======================================================================================================
# USB e porte seriali
# ======================================================================================================


def casi_usb(cartella: str) -> dict:
    rnd = random.Random(52)
    out: dict = {}
    ctx = contesto(cartella)
    PORTE_GREZZE[:] = []
    vecchi = usb_list.list_usb, usb_list.list_hid
    elenco: list = []
    hid: list = []
    usb_list.list_usb = lambda: list(elenco)
    usb_list.list_hid = lambda: list(hid)
    try:
        usb = strumento(usb_tools.UsbTools, ctx)
        gpio = strumento(gpio_tools.GpioTools, ctx)
        out["tabelle"] = {
            "classi": [[k, v] for k, v in usb_list.CLASS_NAMES.items()],
            "produttori": [[k, v] for k, v in usb_list.VENDORS.items()],
            "chip_seriali": sorted([list(x) for x in usb_list.SERIAL_CHIPS]),
            "chip_noti": [[v, p, d] for (v, p), d in serial_ports.KNOWN_CHIPS.items()],
            "usi_hid": [[p, u, n] for (p, u), n in usb_list.HID_USAGES.items()],
            "colonne": {"periferiche": intestazioni(usb.dev_table), "porte": intestazioni(usb.ser_table), "hid": intestazioni(usb.hid_table), "schede": intestazioni(gpio.boards)},
            "etichette": sorted(set(testi_etichette(usb))),
        }
        coppie = [(v, p) for v, p in CHIP_VID_PID] + [(v, None) for v, _p in CHIP_VID_PID[:8]] + [(None, None), (None, 0x7523), (0x303A, 0), (0x2341, 0xFFFF)]
        coppie += [(rnd.randrange(0x10000), rnd.randrange(0x10000)) for _ in range(20)]
        out["chip"] = [{"vid": v, "pid": p, "r": serial_ports.chip_name(v, p)} for v, p in coppie]
        out["dispositivo"] = []
        for _ in range(60):
            d = dispositivo_casuale(rnd)
            out["dispositivo"].append({"d": dispositivo_json(d), "usb_id": d.usb_id, "produttore": d.vendor_name, "classe": d.class_name})
        out["periferiche"] = []
        for n in [0, 1, 3, 8] + [rnd.randint(0, 10) for _ in range(8)]:
            elenco[:] = [dispositivo_casuale(rnd) for _ in range(n)]
            SCENA.eventi = []
            usb.refresh_devices()
            out["periferiche"].append({"d": [dispositivo_json(d) for d in elenco], "righe": celle(usb.dev_table), "eventi": SCENA.eventi})
        out["porte"] = []
        for _ in range(30):
            PORTE_GREZZE[:] = [porta_casuale(rnd, i) for i in range(rnd.randint(0, 7))]
            ports = serial_ports.list_ports()
            elenco[:] = [dispositivo_casuale(rnd) for _ in range(rnd.randint(0, 4))]
            for p in ports:
                if p.vid is not None and rnd.random() < 0.5:
                    elenco.append(usb_list.UsbDevice(p.vid, p.pid, "Adattatore"))
            for v, p in rnd.sample(sorted(usb_list.SERIAL_CHIPS), rnd.randint(0, 3)):
                elenco.append(usb_list.UsbDevice(v, p, rnd.choice(["USB Serial", "CH340", "CP2102"])))
            usb_tools.list_ports = gpio_tools.list_ports = bridge_panel.list_ports = lambda ports=ports: list(ports)
            usb.refresh_serial()
            gpio.refresh_boards()
            occupata = rnd.choice([None, ports[0].device if ports else None, "COM1"])
            ctx.devices.client = types.SimpleNamespace(transport=types.SimpleNamespace(port=occupata)) if occupata else None
            gpio.refresh_ports()
            out["porte"].append({
                "grezze": [vars(p) for p in PORTE_GREZZE],
                "porte": [porta_json(p) for p in ports],
                "usb_id": [p.usb_id for p in ports],
                "polpo": [p.maybe_polpo for p in ports],
                "dispositivi": [dispositivo_json(d) for d in elenco],
                "righe": celle(usb.ser_table),
                "nota": usb.ser_note.text(),
                "schede": celle(gpio.boards),
                "occupata": occupata,
                "console": voci(gpio.port),
                "mancanti": [dispositivo_json(d) for d in usb_list.missing_serial_drivers(elenco, {(p.vid, p.pid) for p in ports if p.vid is not None})],
            })  # fmt: skip
        ctx.devices.client = None
        out["hid"] = []
        voci_hid = [{"vendor_id": 0x046D, "product_id": 0xC52B, "usage_page": 1, "usage": 2, "interface_number": 0, "product_string": "Mouse", "manufacturer_string": "Logitech"},
                    {"vendor_id": 0x046D, "product_id": 0xC52B, "usage_page": 1, "usage": 6, "interface_number": 1, "product_string": "", "manufacturer_string": None},
                    {"vendor_id": 0x303A, "product_id": 0x1001, "usage_page": 0xFF00, "usage": 1, "interface_number": -1, "product_string": None},
                    {}, {"usage_page": 0x0C, "usage": 1}, {"usage_page": 0x0D, "usage": 5, "interface_number": 2}]  # fmt: skip
        for k in range(len(voci_hid) + 1):
            hid[:] = voci_hid[:k]
            SCENA.eventi = []
            usb.refresh_hid()
            out["hid"].append({"d": list(hid), "righe": celle(usb.hid_table), "eventi": SCENA.eventi})
        usb.deleteLater()
        gpio.deleteLater()
    finally:
        usb_list.list_usb, usb_list.list_hid = vecchi
        usb_tools.list_ports = gpio_tools.list_ports = bridge_panel.list_ports = serial_ports.list_ports
        PORTE_GREZZE[:] = []
        SCENA.eventi = []
    return out


# ======================================================================================================
# Console seriale
# ======================================================================================================


class ConsoleFinta:
    errore_apertura: str | None = None

    def __init__(self, port, baud, on_data, on_closed, *, reset_on_open=True) -> None:
        serial_console.SerialConsole(port, baud, on_data, on_closed)  # stessi controlli (1200 baud)
        evento("console", port, baud, reset_on_open)

    def open(self) -> None:
        if ConsoleFinta.errore_apertura:
            raise serial_console.ConsoleError(ConsoleFinta.errore_apertura)

    def write(self, data: bytes) -> None:
        evento("scritti", data)

    def close(self) -> None:
        evento("chiusa")


def pezzi_casuali(rnd: random.Random) -> list[bytes]:
    pezzi = []
    for _ in range(rnd.randint(1, 12)):
        tipo = rnd.randrange(5)
        if tipo == 0:
            p = byte_casuali(rnd, rnd.randint(0, 12))
        elif tipo == 1:
            p = "".join(rnd.choice(["a", "b", "\n", "\r", "\r\n", " ", "é", "🐙", "\u2028", "\u2029", "\x00", "\t", "\x0b", "€"]) for _ in range(rnd.randint(0, 15))).encode()
        elif tipo == 2:
            p = rnd.choice([b"\xe2\x82", b"\xac", b"x\xef\xbb\xbfciao", b"\xf0\x9f", b"\x90\x99", b"\xed\xa0\x80", b"\xc0\xaf", b"\xff\xfe", b"a\xc2\xa0b", b"a\xef\xb7\x90b\xef\xb7\x91c"])
        elif tipo == 3:
            p = ("riga %d\r\n" % rnd.randint(0, 99)).encode() * rnd.randint(1, 4)
        else:
            p = b"".join(rnd.choice([b"\r", b"\n", b"x"]) for _ in range(rnd.randint(1, 8)))
        # un pezzo che inizia con U+FEFF o U+FFFE cambia passando da Python a Qt (PySide): non è un comportamento di Polpo Studio
        if not p.decode("utf-8", "replace").startswith(("\ufeff", "\ufffe")):
            pezzi.append(p)
    return pezzi


def casi_console(cartella: str) -> dict:
    rnd = random.Random(53)
    out: dict = {}
    ctx = contesto(cartella)
    PORTE_GREZZE[:] = []
    vecchia = gpio_tools.SerialConsole
    gpio_tools.SerialConsole = ConsoleFinta
    try:
        g = strumento(gpio_tools.GpioTools, ctx)
        out["menu"] = {
            "baud": voci(g.baud),
            "baud_attuale": g.baud.currentText(),
            "fine_riga": voci(g.ending),
            "fine_riga_attuale": g.ending.currentIndex(),
            "riavvia": [g.reset.text(), g.reset.isChecked()],
            "esadecimale": [g.hex.text(), g.hex.isChecked()],
            "segnaposto": g.send_line.placeholderText(),
            "righe_max": g.term.maximumBlockCount(),
            "costanti": {"BAUD_RATES": list(serial_console.BAUD_RATES), "LINE_ENDINGS": serial_console.LINE_ENDINGS},
        }
        out["velocita"] = [{"baud": b, "r": esito(lambda b=b: (serial_console.SerialConsole("COM3", b, None, None), None)[1])} for b in [1200, 300, 115200, 0, 1199, 1201, -1200, 2400, 921600, 1200.0]]
        out["hexdump"] = [{"d": d.hex(), "r": serial_console.hexdump(d)} for d in [b"", b"\x00", b"Ciao\r\n", bytes(range(256))] + [byte_casuali(rnd, rnd.randint(0, 20)) for _ in range(30)]]
        out["ricevi"] = []
        for k in range(120):
            pezzi = pezzi_casuali(rnd)
            esa = rnd.random() < 0.3
            massimo = rnd.choice([5000, 5000, 1, 2, 3, 5, 10])
            g.term.clear()
            g.term.setMaximumBlockCount(massimo)
            g.hex.setChecked(esa)
            for p in pezzi:
                g._append(p)
            out["ricevi"].append({"pezzi": [p.hex() for p in pezzi], "esa": esa, "max": massimo, "testo": g.term.toPlainText(), "righe": g.term.blockCount()})
        g.term.setMaximumBlockCount(5000)
        g.hex.setChecked(False)
        g.term.clear()
        # invio
        out["invio"] = []
        SCENA.eventi = []
        g.send()
        out["invio"].append({"testo": None, "fine": None, "eventi": SCENA.eventi})
        PORTE_GREZZE[:] = [PortaFinta("/dev/ttyUSB0", "USB Serial", 0x1A86, 0x7523)]
        g.refresh_ports()
        SCENA.eventi = []
        g.console = ConsoleFinta("/dev/ttyUSB0", 115200, None, None)
        for t in ["", "ciao", "AT+GMR", "è🐙€", "riga\ncon a capo", " spazi ", "\t", "x" * 300]:
            for i in range(g.ending.count()):
                SCENA.eventi = []
                g.ending.setCurrentIndex(i)
                g.send_line.setText(t)
                g.send()
                out["invio"].append({"testo": t, "fine": g.ending.itemData(i), "eventi": SCENA.eventi, "dopo": g.send_line.text()})
        g.console = None
        # apertura, chiusura, registro
        SCENA.eventi = []
        sequenza = []

        def passo(nome, fn):
            SCENA.eventi = []
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                evento("errore", errore(e))
            sequenza.append({"passo": nome, "eventi": SCENA.eventi})

        PORTE_GREZZE[:] = []
        g.refresh_ports()
        passo("apri_senza_porte", g.open_console)
        PORTE_GREZZE[:] = [PortaFinta("COM4", "USB Serial", 0x10C4, 0xEA60)]
        g.refresh_ports()
        passo("apri", g.open_console)
        passo("apri_di_nuovo", g.open_console)
        passo("chiudi", g.close_console)
        passo("chiudi_di_nuovo", g.close_console)
        passo("invia_senza_console", g.send)
        g.reset.setChecked(False)
        g.baud.setCurrentIndex(0)
        passo("apri_300_senza_riavvio", g.open_console)
        SCENA.eventi = []
        g.close_console()
        ConsoleFinta.errore_apertura = "Porta COM4 occupata da un altro programma"
        passo("apri_errore", g.open_console)
        ConsoleFinta.errore_apertura = None
        out["sequenza"] = sequenza
        out["registro"] = []
        for t in ["", "ciao\nmondo", "riga è 🐙\n", "a\u2028b"]:
            SCENA.eventi = []
            g.term.clear()
            g.term.insertPlainText(t)
            g.save_log()
            out["registro"].append({"testo": t, "eventi": SCENA.eventi})
        g.deleteLater()
    finally:
        gpio_tools.SerialConsole = vecchia
        PORTE_GREZZE[:] = []
        SCENA.eventi = []
    return out


# ======================================================================================================
# Bluetooth
# ======================================================================================================


class LavoratoreFinto:
    def __init__(self) -> None:
        self.scansione = fatto([])
        self.collegamento = fatto(None)
        self.servizi = fatto([])
        self.letto = fatto(b"")
        self.richiamo = None

    def scan(self, _s):
        return self.scansione

    def connect(self, _a):
        return self.collegamento

    def services(self):
        return self.servizi

    def read(self, uuid):
        evento("leggi", uuid)
        return self.letto

    def start_notify(self, uuid, cb):
        self.richiamo = cb
        return fatto(None)

    def stop_notify(self, _u):
        return fatto(None)

    def disconnect(self):
        return fatto(None)


class Annuncio:
    def __init__(self, nome, rssi, produttori) -> None:
        self.local_name, self.rssi = nome, rssi
        self.manufacturer_data = {m: b"x" for m in produttori}
        self.service_uuids = ["0000180f-0000-1000-8000-00805f9b34fb"]
        self.tx_power = None


def scansione_bleak(trovati: list) -> list:
    """BleWorker.scan con una libreria bleak finta che trova `trovati` = [(indirizzo, nome dev, nome annuncio, rssi, produttori)]."""
    mod = types.ModuleType("bleak")

    class Scanner:
        @staticmethod
        async def discover(timeout, return_adv):
            return {a: (types.SimpleNamespace(address=a, name=nd), Annuncio(na, r, m)) for a, nd, na, r, m in trovati}

    mod.BleakScanner = Scanner
    vecchio = sys.modules.get("bleak")
    sys.modules["bleak"] = mod
    w = ble.BleWorker()
    try:
        return w.scan(1).result(timeout=5)
    finally:
        w._loop.call_soon_threadsafe(w._loop.stop)
        w._thread.join(timeout=2)
        if vecchio is None:
            sys.modules.pop("bleak", None)
        else:
            sys.modules["bleak"] = vecchio


def valori_ble(rnd: random.Random) -> list[bytes]:
    v = [b"", b"\x55", b"ok", b"Ciao mondo", b" ", b"  ", b"\x00", b"a\x00b", b"\n", b"tab\there", "è🐙€".encode(), b"\xef\xbb\xbfBOM", b"\xff", b"\xc3", b"\xed\xa0\x80",
         "\u00a0".encode(), "a\u200bb".encode(), "\u2028".encode(), "\ue000".encode(), "\U0010ffff".encode(), "\u0378".encode(), b"\x7f", "x\u00adx".encode(), "Ω≈ç√".encode(), b"64%"]  # fmt: skip
    v += [byte_casuali(rnd, rnd.randint(0, 10)) for _ in range(40)]
    v += ["".join(rnd.choice("abcXYZ 019-_.,:%°àèé€🐙\u00a0\t") for _ in range(rnd.randint(1, 12))).encode() for _ in range(40)]
    return v


def casi_ble(cartella: str) -> dict:
    rnd = random.Random(54)
    out: dict = {}
    sorgente = (RADICE / "polpo/src/apps/wireless_apps.cpp").read_text(encoding="utf-8")
    blocco = sorgente[sorgente.index("const char* vendor_name") : sorgente.index("default: return nullptr")]
    out["produttori_firmware"] = [[int(a, 16), b] for a, b in re.findall(r'case 0x([0-9A-Fa-f]+): return "([^"]*)";', blocco)]
    out["servizi_noti"] = [[k, v] for k, v in ble.KNOWN_SERVICES.items()]
    uuids = [k + "-0000-1000-8000-00805f9b34fb" for k in ble.KNOWN_SERVICES] + ["0000180F-0000-1000-8000-00805F9B34FB", "0000180", "", "00002a19-0000-1000-8000-00805f9b34fb",
             "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "0000FE59", "0000fe59x", "İ0001800", "ǅ"]  # fmt: skip
    out["nome_servizio"] = [{"uuid": u, "desc": d, "r": ble.service_name(u, d)} for u in uuids for d in ("", "Battery Service")]
    out["valore"] = [{"d": d.hex(), "r": ble.format_value(d)} for d in valori_ble(rnd)]
    messaggi = ["No Bluetooth adapters found.", "Bluetooth adapter not found", "adapter is NOT powered", "org.bluez.Error.NotReady", "DBus error", "BlueZ non risponde",
                "Permission denied", "Not authorized", "timeout", "", "Adapter ok", "un altro errore", "nessun adattatore", "ADAPTER NOT", "bluez"]  # fmt: skip
    out["spiega"] = [{"msg": m, "tipo": t, "r": ble._explain(RuntimeError(m) if t == "RuntimeError" else TimeoutError(m))} for m in messaggi for t in ("RuntimeError", "TimeoutError")]
    # ordine della scansione del PC (bleak finto)
    out["scansione_pc"] = []
    for _ in range(12):
        trovati = []
        for i in range(rnd.randint(0, 6)):
            trovati.append((f"AA:BB:CC:DD:EE:{i:02X}", rnd.choice([None, "", "Dev"]), rnd.choice([None, "", "Sensore", "Fascia ñ"]), rnd.choice([None, 0, -40, -70, -70, -127, -128, -30]),
                            sorted(rnd.sample([0x004C, 0x0006, 0x0075, 0xFFFF, 0x02E5], rnd.randint(0, 2)))))  # fmt: skip
        out["scansione_pc"].append({"trovati": trovati, "r": scansione_bleak(trovati)})
    # registro dei dispositivi autorizzati
    reg = [None, "rotta", b"", b"[]", b'[{"address": "AA", "name": "Mio", "added": "2026-01-01"}]', b"\xef\xbb\xbf[]", b"{}", b'{"address": "AA"}', b'"AA"', b"5", b"null", b"true",
           b'[{"address": "AA"}, "x"]', b'["x"]', b"[[1]]", b"[5]", b"[null]", b"[{}]", b'[{"name": "x"}]', b'[{"address": "BB"}, {"address": "AA"}, {"name": "senza"}]', b"\xff",
           b"[1, 2", b'[{"address": "AA", "n": 1.5, "k": [1, {"a": null}]}]', '[{"address": "CC", "name": "è🐙"}]'.encode(), b'\x00[\x00]', b" [ ] ",
           b'[{"address": "AA", "name": "Mio"}, {"address": "AA", "name": "Doppio"}]']  # fmt: skip
    out["autorizzati"] = []
    for r in reg:
        v = Cassaforte()
        if r == "rotta":
            v.voci.append(Elemento("0", "configurazioni", bluetooth_tools.AUTH_NAME, b"[]", {}))
            v.rotta = True
        elif r is not None:
            v.voci.append(Elemento("0", "configurazioni", bluetooth_tools.AUTH_NAME, r, {}))
            v.voci.append(Elemento("1", "configurazioni", "altro.json", b'[{"address": "AA"}]', {}))
        a = bluetooth_tools.AuthorizedDevices(v)
        caso = {"dati": None if r is None else "rotta" if r == "rotta" else r.hex(), "load": esito(a.load)}
        caso["aa"] = esito(a.is_authorized, "AA")
        caso["zz"] = esito(a.is_authorized, "ZZ")
        for k, (ind, nome) in enumerate([("AA", "Nuovo"), ("DD", "")]):
            SCENA.eventi = []
            caso[f"add{k}"] = {"r": esito(a.add, ind, nome), "eventi": SCENA.eventi}
            v.rotta = False
        out["autorizzati"].append(caso)
    SCENA.eventi = []
    # lo strumento vero: righe, servizi, messaggi
    ctx = contesto(cartella)
    w = LavoratoreFinto()
    t = strumento(bluetooth_tools.BluetoothTools, ctx, worker=w)
    t._log = lambda testo: evento("riga", testo)
    out["costanti"] = {"colonne": intestazioni(t.table), "servizi": [t.services.headerItem().text(0), t.services.headerItem().text(1)], "secondi": [t.seconds.minimum(), t.seconds.maximum(), t.seconds.value()],
                       "etichette": testi_etichette(t), "nome_registro": bluetooth_tools.AUTH_NAME}  # fmt: skip
    out["dispositivi"] = []
    for _ in range(25):
        devs = []
        for i in range(rnd.randint(0, 5)):
            devs.append({"address": f"AA:BB:CC:DD:EE:{rnd.randrange(4):02X}" if rnd.random() < 0.7 else f"11:22:33:44:55:{i:02X}", "name": rnd.choice(["", "Sensore", "Fascia ñ", "🐙"]),
                         "rssi": rnd.choice([None, -40, -99, 0]), "manufacturers": sorted(rnd.sample([0x004C, 0x0006, 0x0000, 0xFFFF, 0x02E5], rnd.randint(0, 3))), "services": [], "tx_power": None})  # fmt: skip
        ctx.vault = Cassaforte()
        if rnd.random() < 0.7:
            ctx.vault.voci.append(Elemento("0", "configurazioni", bluetooth_tools.AUTH_NAME, json.dumps([{"address": "AA:BB:CC:DD:EE:01", "name": "x", "added": "2026-01-01"}]).encode(), {}))
        t.auth = bluetooth_tools.AuthorizedDevices(ctx.vault)
        SCENA.eventi = []
        t.show_devices(devs)
        out["dispositivi"].append({"d": devs, "registro": ctx.vault.voci[0].dati.decode() if ctx.vault.voci else None, "righe": celle(t.table), "eventi": SCENA.eventi})
    out["servizi"] = []
    gruppi = [[], [{"uuid": "0000180f-0000-1000-8000-00805f9b34fb", "name": "Batteria", "characteristics": [{"uuid": "00002a19-0000-1000-8000-00805f9b34fb", "name": "Battery Level", "properties": ["read", "notify"], "handle": 12}]}],
              [{"uuid": "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "name": "", "characteristics": [{"uuid": "6e400003-b5a3-f393-e0a9-e50e24dcca9e", "name": "", "properties": [], "handle": 3},
                                                                                                   {"uuid": "6e400002-b5a3-f393-e0a9-e50e24dcca9e", "name": "", "properties": ["write", "write-without-response"], "handle": 5}]},
               {"uuid": "00001800-0000-1000-8000-00805f9b34fb", "name": ble.service_name("00001800-0000-1000-8000-00805f9b34fb"), "characteristics": []}]]  # fmt: skip
    for g in gruppi:
        SCENA.eventi = []
        t.show_services(g)
        albero = []
        for i in range(t.services.topLevelItemCount()):
            top = t.services.topLevelItem(i)
            albero.append({"testo": top.text(0), "proprieta": top.text(1), "caratteristiche": [{"testo": top.child(j).text(0), "proprieta": top.child(j).text(1), "uuid": top.child(j).data(0, bluetooth_tools.UUID_ROLE)} for j in range(top.childCount())]})
        out["servizi"].append({"s": g, "albero": albero, "eventi": SCENA.eventi})
    # flussi: scansione, autorizzazione, collegamento, letture, notifiche, errori
    flussi = []

    def passo(nome, fn, **dati):
        SCENA.eventi = []
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            evento("errore", errore(e))
        flussi.append({"passo": nome, **{k: J(v) for k, v in dati.items()}, "eventi": SCENA.eventi})

    ctx.vault = Cassaforte()
    t.auth = bluetooth_tools.AuthorizedDevices(ctx.vault)
    dev = {"address": "AA:BB:CC:DD:EE:01", "name": "Sensore", "rssi": -50, "manufacturers": [0x004C], "services": [], "tx_power": None}
    dev2 = {"address": "AA:BB:CC:DD:EE:02", "name": "", "rssi": None, "manufacturers": [], "services": [], "tx_power": None}
    w.scansione = fatto([dev, dev2])
    passo("scansione", t.scan, devs=[dev, dev2])
    t.table.clearSelection()
    passo("autorizza_senza_selezione", t.authorize)
    passo("collega_senza_selezione", t.connect)
    t.table.selectRow(0)
    passo("collega_non_autorizzato", t.connect, d=dev)
    SCENA.conferma = False
    passo("autorizza_no", t.authorize, d=dev)
    SCENA.conferma = True
    passo("autorizza_si", t.authorize, d=dev)
    t.table.selectRow(1)
    passo("autorizza_senza_nome", t.authorize, d=dev2)
    passo("autorizza_di_nuovo", t.authorize, d=dev2)
    t.table.selectRow(0)
    w.collegamento = fatto(errore_=ble.BleUnavailable("nessun adattatore Bluetooth trovato o acceso"))
    passo("collega_errore", t.connect, d=dev)
    w.collegamento = fatto(None)
    w.servizi = fatto(gruppi[1])
    passo("collega", t.connect, d=dev)
    t.services.setCurrentItem(None)
    passo("leggi_senza_caratteristica", t.read)
    t.services.setCurrentItem(t.services.topLevelItem(0))
    passo("leggi_su_servizio", t.read)
    t.services.setCurrentItem(t.services.topLevelItem(0).child(0))
    for dato in [b"\x55", b"ok", b"", b"\xff\xfe", "è".encode()]:
        w.letto = fatto(dato)
        passo("leggi", t.read, dati=dato)
    w.letto = fatto(errore_=RuntimeError("lettura non permessa"))
    passo("leggi_errore", t.read)
    passo("notifiche_si", t.notify_on)
    for dato in [b"\x56", b"64"]:
        passo("notifica", lambda dato=dato: w.richiamo("00002a19-0000-1000-8000-00805f9b34fb", dato), dati=dato)
    passo("notifiche_no", t.notify_off)
    passo("scollega", t.disconnect)
    w.scansione = fatto(errore_=ble.BleUnavailable("nessun adattatore Bluetooth trovato o acceso"))
    passo("scansione_errore", t.scan)
    w.scansione = fatto(errore_=TimeoutError("scansione scaduta"))
    passo("scansione_errore_altro", t.scan)
    out["flussi"] = flussi
    t.deleteLater()
    # la scansione del Polpo (modulo Polpo), che ha la stessa forma di quella del telefono
    out["scansione_polpo"] = []
    scansioni = [{}, {"devices": []}, {"devices": [{"name": "A", "addr": "11:22", "rssi": -60, "mfr_id": 0x004C, "connectable": True}, {"name": "", "addr": "33:44", "rssi": -40, "mfr_id": 0, "connectable": False},
                                                     {"addr": "55:66", "rssi": -60}, {"name": None, "rssi": -100, "mfr_id": 65535, "connectable": 1}]},
                 {"devices": [{}]}, {"devices": [{"rssi": None}]}, {"devices": [{"rssi": "x"}]}, {"devices": ["a"]}, {"devices": [{"mfr_id": "x"}]}, {"devices": [{"mfr_id": None}]},
                 {"devices": [{"rssi": True, "connectable": []}, {"rssi": 1.5}]}, {"devices": {"a": 1}}, {"devices": None}]  # fmt: skip
    for _ in range(20):
        scansioni.append({"devices": [{"name": rnd.choice(["", "Cuffie", "Orologio ñ", None]), "addr": ":".join(f"{rnd.randrange(256):02X}" for _ in range(6)), "rssi": rnd.randint(-100, -20),
                                       "mfr_id": rnd.choice([0, 0x004C, 0x0075, rnd.randrange(65536)]), "connectable": rnd.random() < 0.5} for _ in range(rnd.randint(0, 6))]})  # fmt: skip
    for d in scansioni:
        for sim in (False, True):
            f = types.SimpleNamespace(simulated=sim)
            f.messaggi = []
            f.say = lambda testo, error=False, f=f: f.messaggi.append([testo, error])
            f._show = lambda h, righe, f=f: setattr(f, "tabella", [h, righe])
            f.req = lambda cmd, args, ok, f=f, d=d: (setattr(f, "cmd", [cmd, args]), ok(d))
            r = esito(lambda f=f: polpo_tools.PolpoTools.scan_ble(f))
            out["scansione_polpo"].append({"d": d, "sim": sim, "r": r, "tabella": getattr(f, "tabella", None), "cmd": getattr(f, "cmd", None), "messaggi": f.messaggi})
    SCENA.eventi = []
    return out


# ======================================================================================================
# App integrate
# ======================================================================================================


def manifest_casuale(rnd: random.Random) -> dict:
    """Un manifest valido con da 0 a 3 campi cambiati (anche con valori sbagliati) o tolti."""
    m = {"id": rnd.choice(["mia_app", "abc", "a_b_c_1", "x" * 41, "lettore_tag"]), "name": rnd.choice(["App", "Nome lungo " * 8, "🐙 app", "Radio ñ"]),
         "description": rnd.choice(["Descrizione.", "d" * 450, "Usa il Polpo per leggere"]), "version": rnd.choice(["1.0", "0.0.0.0.0.0.0.0.0.0.0.0", "2"]),
         "author": rnd.choice(["Io", "a" * 90, "Progetto Polpo"]), "category": rnd.choice(list(core_apps.APP_CATEGORIES)), "icon": rnd.choice(["apps", "nfc", "radio"]),
         "permissions": rnd.choice([[], ["polpo.info"], ["polpo.ir", "vault.read"], ["vault.read", "vault.write"], list(core_apps.PERMISSIONS)]),
         "hardware": rnd.choice([[], [["polpo"]], [["polpo", "polpo.ir_tx"], ["bridge"]], [["pc.ble"], ["polpo", "polpo.ble"]], [["rfid125.usb"], ["rfid125.rdm6300", "pc.serial"]], [[]]]),
         "vault_categories": rnd.choice([[], ["ir"], ["nfc", "altro"]]), "experimental": rnd.choice([False, True])}  # fmt: skip
    cattivi = {"id": ["ab", "Abc", "x" * 42, "1abc", "abc\n", "abc\n\n", "abc ", "àbc", "abc-d", "", "   ", 5, None],
               "name": ["", "   ", 5, None, ["x"]], "description": ["", None, ["x"], 3.5], "version": ["", 1, None], "author": [" ", None, {}],
               "category": ["boh", None, 3, ["radio"], "Radio"], "icon": [None, 7, ["a"], {"a": 1}, True, 2.5],
               "permissions": [["polpo.info", "boh"], "polpo.info", "", None, 5, {"polpo.info": 1}, {"boh": 1}, [[1]], [{}], [5, None, True], ["vault.read", "rf.tx"], [True]],
               "hardware": [[["boh"]], ["polpo"], [[["polpo"]]], None, [[{}]], "polpo", [["polpo", 5]], [[None]], {"a": 1}],
               "vault_categories": [["boh"], "ir", None, [["ir"]], ["IR"], [None]], "experimental": [0, 1, "", "sì", None, [], [0], {}]}  # fmt: skip
    for _ in range(rnd.choice([0, 0, 1, 1, 1, 2, 3])):
        k = rnd.choice(list(m))
        if rnd.random() < 0.2:
            m.pop(k, None)
        else:
            m[k] = rnd.choice(cattivi[k])
    return m


def casi_app(cartella: str) -> dict:
    rnd = random.Random(55)
    out: dict = {}
    nomi = hardware.hardware_names()
    out["costanti"] = {
        "permessi": [[k, str(v)] for k, v in core_apps.PERMISSIONS.items()],
        "comandi": {k: sorted(v) for k, v in core_apps.COMMANDS_BY_PERMISSION.items()},
        "categorie": list(core_apps.APP_CATEGORIES),
        "hardware": list(hardware.SPECS),
        "nomi_hardware": nomi,
        "cassaforte": list(vault_mod.CATEGORIES),
        "integrate": [m.MANIFEST for m in integrate.BUILTIN],
        "solo_software": capability.tr("Funziona sul PC, non serve hardware.", ""),
    }
    manifest = [m.MANIFEST for m in integrate.BUILTIN]
    manifest += [{"id": "con_hw", "name": "Con hardware", "description": "Usa il Polpo.", "version": "2", "category": "infrarossi", "author": "Io", "permissions": ["polpo.ir"], "hardware": [["polpo", "polpo.ir_tx"], ["bridge"]]},
                 {"id": "sperim", "name": "Sperimentale", "description": "x", "version": "1", "category": "altro", "author": "Io", "experimental": True},
                 {"id": "dichiarato", "name": "Dichiara", "description": "IR Unit", "version": "1", "category": "radio", "author": "Io", "hardware": [["polpo", "polpo.ir_unit"]]}]  # fmt: skip
    manifest += [manifest_casuale(rnd) for _ in range(300)]
    out["leggi"] = []
    for m in manifest:
        for builtin in (True, False):
            if not builtin and rnd.random() < 0.6:
                continue
            out["leggi"].append({"m": m, "integrata": builtin, "r": esito(core_apps.parse_manifest, m, builtin=builtin)})
    validi = [core_apps.parse_manifest(m, builtin=b) for m in manifest for b in (True, False) if esito(core_apps.parse_manifest, m, builtin=b).get("ok")]
    presenze = [p for p in Presence]
    out["valuta"] = []
    for _ in range(150):
        m = rnd.choice(validi)
        snap = {h: HardwareStatus(rnd.choice(presenze), "") for h in rnd.sample(list(hardware.SPECS), rnd.randint(0, 8))}
        ev = capability.evaluate(m.capability(), snap, nomi)
        out["valuta"].append({"m": dataclasses.asdict(m) | {"path": None}, "hw": {k: v.presence.value for k, v in snap.items()},
                              "r": {"stato": ev.status.value, "etichetta": ev.label, "motivo": ev.reason, "usabile": ev.usable, "mancanti": ev.missing}})  # fmt: skip
    # lo strumento vero: elenco filtrato, dettagli, apertura, disinstallazione
    ctx = contesto(cartella)
    t = strumento(apps_tools.AppsTools, ctx)
    out["costanti"]["colonne"] = intestazioni(t.table)
    out["costanti"]["menu_categorie"] = voci(t.cat)
    out["costanti"]["segnaposto"] = t.search.placeholderText()
    out["costanti"]["etichette"] = testi_etichette(t)
    elenco = validi[:12]
    t.manifests = lambda: list(elenco)
    out["catalogo_elenco"] = [dataclasses.asdict(m) | {"path": None} for m in elenco]
    out["catalogo"] = []
    ricerche = ["", "  ", "con", "CON", "radio", "xyz", "Conv", "app", "ñ", "Usa", "dichiara"]
    for _ in range(40):
        snap = {h: HardwareStatus(rnd.choice(presenze), "") for h in rnd.sample(list(hardware.SPECS), rnd.randint(0, 10))}
        ctx.hardware.stato = snap
        cat = rnd.randrange(t.cat.count())
        q = rnd.choice(ricerche)
        t.cat.blockSignals(True)
        t.cat.setCurrentIndex(cat)
        t.cat.blockSignals(False)
        t.search.blockSignals(True)
        t.search.setText(q)
        t.search.blockSignals(False)
        t.refresh()
        righe = celle(t.table)
        for r in range(t.table.rowCount()):
            righe[r][5] = t.table.cellWidget(r, 5).text()
        out["catalogo"].append({"hw": {k: v.presence.value for k, v in snap.items()}, "categoria": t.cat.currentData(), "cerca": q, "righe": righe, "ids": [m.id for m in t._items]})
    ctx.hardware.stato = {}
    out["dettagli"] = []
    catturati = []
    vecchio = apps_tools.QMessageBox.information
    apps_tools.QMessageBox.information = lambda _p, titolo, testo: catturati.append([titolo, testo])
    try:
        for m in validi[:40]:
            for problemi in ([], ["main.py: modificato", "x.py: aggiunto dopo l'installazione"]):
                if m.builtin and problemi:
                    continue
                catturati.clear()
                t._selected = lambda m=m: m
                t.third.verify = lambda _i, problemi=problemi: list(problemi)
                t.details()
                out["dettagli"].append({"m": dataclasses.asdict(m) | {"path": None}, "problemi": problemi, "r": catturati[0]})
    finally:
        apps_tools.QMessageBox.information = vecchio
        del t._selected
    out["apri"] = []
    t.manifests = lambda: [core_apps.parse_manifest(m.MANIFEST, builtin=True) for m in integrate.BUILTIN]
    t.search.blockSignals(True)
    t.search.setText("")
    t.search.blockSignals(False)
    t.cat.setCurrentIndex(0)
    t.refresh()
    t.table.clearSelection()
    SCENA.eventi = []
    t.open_selected()
    t.uninstall()
    out["senza_selezione"] = SCENA.eventi
    for r in range(t.table.rowCount()):
        SCENA.eventi = []
        t.table.selectRow(r)
        win = t.open_selected()
        titolo = win.windowTitle() if win else None
        if win:
            win.close()
        t.uninstall()
        out["apri"].append({"id": t._items[r].id, "titolo": titolo, "eventi": SCENA.eventi})
    t.deleteLater()
    # l'interfaccia offerta alle app: comandi e cassaforte
    out["api"] = []
    comandi = ["info", "diag", "ir.send", "rf.rx.start", "rf.rx.stop", "rf.tx", "nfc.read", "nfc.write_ndef", "fs.list", "fs.read", "fs.write", "ping", "hello", ""]
    ctx.devices.request = lambda cmd, args=None, timeout=None: "inviato"
    ctx.vault = types.SimpleNamespace(items=lambda c: [], item=lambda i: types.SimpleNamespace(category=i), get=lambda i: b"", put=lambda *a, **k: None)
    for m in validi[:60]:
        api = core_apps.AppApi(ctx, m)
        caso = {"m": dataclasses.asdict(m) | {"path": None}, "comandi": {c: esito(api.request, c) for c in comandi}}
        caso["leggi"] = {c: esito(api.vault_items, c) for c in ["ir", "nfc", "altro", "boh"]}
        caso["prendi"] = {c: esito(api.vault_get, c) for c in ["ir", "nfc"]}
        caso["metti"] = {c: esito(api.vault_put, c, "x.json", b"{}") for c in ["ir", "nfc", "altro", "boh"]}
        out["api"].append(caso)
    SCENA.eventi = []
    return out


def main() -> None:
    if sys.version_info[:2] != (3, 13):
        print(f"Attenzione: i casi sono pensati per Python 3.13 (questo è {sys.version.split()[0]}).", file=sys.stderr)
    with tempfile.TemporaryDirectory() as cartella:
        scrivi("bridge", casi_bridge(cartella))
        scrivi("schede_usb", casi_usb(cartella))
        scrivi("console_seriale", casi_console(cartella))
        scrivi("ble", casi_ble(cartella))
        scrivi("app_integrate", casi_app(cartella))
    asyncio.set_event_loop(None)


if __name__ == "__main__":
    main()
