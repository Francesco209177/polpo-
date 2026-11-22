"""Casi di prova per il porting in JavaScript di radio e infrarossi (site/assets/js/studio/protocolli/).

Esegue il codice Python di Polpo Studio (flipper_format, ir, subghz, apps/radio_budget) su molti
ingressi - normali, ai limiti, sbagliati - e scrive ingressi e risultati in radio_ir/*.json.
Le prove in site/tests/studio/radio_ir/ controllano che il JavaScript dia gli stessi risultati.

Le funzioni ui_* trascrivono alla lettera la logica pura dei moduli app/tools/ir_tools.py e
app/tools/radio_tools.py (con tr() già risolto in italiano): sono gli aiuti portati in JavaScript.

Tutto è deterministico (generatore pseudo-casuale proprio, semi fissi): rigenerare deve dare file
identici byte per byte. Uso, dalla cartella principale del repository:

    python site/tests/studio/casi/genera_radio_ir.py
"""

from __future__ import annotations

import dataclasses
import html
import json
import math
import struct
import unicodedata
from pathlib import Path

from polpo_studio.apps import radio_budget
from polpo_studio.devices.virtual_polpo import RF_BUDGET_LIMIT_MS
from polpo_studio.protocols import flipper_format as ff
from polpo_studio.protocols import ir, subghz

USCITA = Path(__file__).resolve().parent / "radio_ir"
SICURO = 2**53 - 1
M64 = 2**64 - 1


# ---------------- strumenti ----------------


class Caso:
    """Generatore pseudo-casuale splitmix64: non dipende dalla versione di Python."""

    def __init__(self, seme: int) -> None:
        self.s = seme & M64

    def bit64(self) -> int:
        self.s = (self.s + 0x9E3779B97F4A7C15) & M64
        z = self.s
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
        return z ^ (z >> 31)

    def intero(self, n: int) -> int:
        return self.bit64() % n

    def tra(self, a: int, b: int) -> int:
        return a + self.intero(b - a + 1)

    def scegli(self, seq):
        return seq[self.intero(len(seq))]

    def prob(self, p: float) -> bool:
        return self.bit64() < p * 2**64

    def decimale(self) -> float:
        """Un double qualsiasi (finito), dai suoi 64 bit."""
        while True:
            x = struct.unpack("<d", struct.pack("<Q", self.bit64()))[0]
            if math.isfinite(x):
                return x

    def testo(self, alfabeto: str, n_max: int) -> str:
        return "".join(self.scegli(alfabeto) for _ in range(self.tra(0, n_max)))


def enc(x):
    """Valori Python → JSON leggibile anche da JavaScript senza perdite."""
    if x is None or isinstance(x, bool):
        return x
    if isinstance(x, str):
        if any(0xD800 <= ord(c) <= 0xDFFF for c in x):  # surrogati spaiati: come unità UTF-16
            return {"$u16": [u for c in x for u in ([ord(c)] if ord(c) < 0x10000 else [0xD800 + ((ord(c) - 0x10000) >> 10), 0xDC00 + ((ord(c) - 0x10000) & 0x3FF)])]}
        return x
    if isinstance(x, int):
        return x if -SICURO <= x <= SICURO else {"$int": hex(x)}  # in esadecimale: niente limite di 4300 cifre
    if isinstance(x, float):
        if math.isnan(x):
            return {"$float": "nan"}
        if math.isinf(x):
            return {"$float": "inf" if x > 0 else "-inf"}
        return x
    if isinstance(x, (bytes, bytearray)):
        return {"$bytes": list(x)}
    if isinstance(x, (list, tuple)):
        return [enc(v) for v in x]
    if isinstance(x, dict):
        return {k: enc(v) for k, v in x.items()}
    if isinstance(x, ff.FfDoc):
        return {"filetype": x.filetype, "version": enc(x.version), "lines": enc(x.lines)}
    if isinstance(x, ir.Signal):
        return {f.name: enc(getattr(x, f.name)) for f in dataclasses.fields(x)}
    if isinstance(x, ir.IrFile):
        return {"filetype": x.filetype, "signals": enc(x.signals), "warnings": x.warnings}
    if isinstance(x, subghz.SubFile):
        return {"frequency": enc(x.frequency), "preset": x.preset, "raw": x.raw, "code": enc(x.code), "raw_timings": enc(x.raw_timings), "in_band": x.in_band}
    if dataclasses.is_dataclass(x):  # RcCode, PulseStats, Protocol, LibraryCode
        return {f.name: enc(getattr(x, f.name)) for f in dataclasses.fields(x)}
    raise TypeError(f"non so codificare {type(x).__name__}")


def esegui(fn, *a):
    try:
        return {"out": enc(fn(*a))}
    except Exception as e:  # noqa: BLE001 - si registra ogni eccezione, come la vede il chiamante
        return {"err": {"tipo": type(e).__name__, "msg": str(e)}}


def caso(ingresso, fn, *a):
    return {"in": enc(ingresso), **esegui(fn, *a)}


def scrivi(nome: str, dati: dict) -> None:
    USCITA.mkdir(parents=True, exist_ok=True)
    testo = json.dumps(dati, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False) + "\n"
    (USCITA / nome).write_text(testo, encoding="utf-8", newline="\n")


def segnale(d: dict) -> ir.Signal:
    return ir.Signal(d["name"], raw=d.get("raw", False), protocol=d.get("protocol", ""), address=d.get("address", 0), command=d.get("command", 0), frequency=d.get("frequency", 38000), duty=d.get("duty", 0.33), timings=list(d.get("timings", [])))


def codice_rc(d: dict) -> subghz.RcCode:
    return subghz.RcCode(d.get("protocol", 1), d.get("bits", 24), d.get("value", 0), d.get("pulse_us", 350))


def file_sub(d: dict) -> subghz.SubFile:
    return subghz.SubFile(frequency=d.get("frequency", 433_920_000), preset=d.get("preset", subghz.DEFAULT_PRESET), raw=d.get("raw", False), code=codice_rc(d.get("code", {})), raw_timings=list(d.get("raw_timings", [])))


def sim_suffix(simulated) -> str:  # app/tools/common.py
    return " · " + "SIMULATO" if simulated else ""


# ---------------- trascrizioni della logica pura di app/tools/ir_tools.py ----------------


def ui_segnali_libreria(cat: str, brand: str) -> list[ir.Signal]:  # IrTools.open_source, ramo "lib"
    signals = [c.signal() for c in ir.codes(cat, brand)]
    for s, c in zip(signals, ir.codes(cat, brand)):
        s.name = ir.BUTTONS[c.button][0]
    return signals


def ui_titolo_libreria(cat: str, brand: str) -> str:  # IrTools.open_source
    return f"{brand} · {ir.CATEGORIES[cat][0]}"


def ui_nota(warnings: list[str], simulated: bool) -> str:  # IrTools.open_source, ramo "item"
    note = "Telecomando personale."
    if warnings:
        note += " " + "Tasti saltati: " + "; ".join(warnings)
    if simulated:
        note += " " + "Creato col Polpo virtuale: non si invia al Polpo vero."
    return note


def ui_descrivi(s: ir.Signal) -> str:  # IrTools.show_remote, suggerimento del pulsante
    return "RAW" if s.raw else f"{s.protocol} · {'indirizzo'} 0x{s.address:X} · {'comando'} 0x{s.command:X}"


def ui_nome_file_ir(name: str) -> str:  # IrTools.new_remote
    return name.strip() if name.strip().endswith(".ir") else name.strip() + ".ir"


def ui_nome_copia(title: str) -> str:  # IrTools.copy_to_mine
    return title.replace(" · ", " ")


def ui_importa(text: str) -> str:  # IrTools.import_ir
    f = ir.parse(text)
    msg = "Importato: {n} tasti.".format(n=len(f.signals))
    if f.warnings:
        msg += " " + "Saltati: " + "; ".join(f.warnings)
    return msg


def ui_invio(sig: ir.Signal) -> dict:  # IrTools.send (dopo check_sendable)
    why = sig.validate()
    if why:
        return {"errore": why, "comando": "", "argomenti": None}
    return {"errore": "", "comando": "ir.send", "argomenti": sig.link_args()}


def ui_inviato(sig: ir.Signal, simulated: bool) -> str:  # IrTools.send, ok()
    return "Inviato «{n}».".format(n=sig.name) + sim_suffix(simulated)


def ui_segnale_imparato(d: dict, n) -> ir.Signal:  # IrTools._on_learned
    if d.get("raw"):
        return ir.Signal("tasto {n}".format(n=n), raw=True, timings=[int(x) for x in d.get("timings", [])])
    return ir.Signal("tasto {n}".format(n=n), protocol=str(d.get("protocol")), address=int(d.get("address", 0)), command=int(d.get("command", 0)))


def ui_tasto_imparato(d: dict, n, simulated) -> dict:  # IrTools._on_learned
    sig = ui_segnale_imparato(d, n)
    why = sig.validate()
    if why:
        return {"errore": "Segnale ricevuto ma non valido: {w}".format(w=why), "segnale": None, "simulato": False, "messaggio": ""}
    return {
        "errore": "",
        "segnale": sig,
        "simulato": bool(simulated or d.get("simulated")),
        "messaggio": "Imparato «{n}» ({p}). Rinominalo dal file se vuoi.".format(n=sig.name, p="RAW" if sig.raw else sig.protocol) + sim_suffix(simulated),
    }


# ---------------- trascrizioni della logica pura di app/tools/radio_tools.py ----------------


def ui_riga_codice(d: dict, simulated) -> dict:  # RadioTools._on_code (senza l'ora)
    value = int(str(d.get("value", "0")), 16)
    bits = int(d.get("bits", 0))
    vals = [str(d.get("protocol")), str(bits), f"0x{value:0{max(1, (bits + 3) // 4)}X}", f"{d.get('pulse_us')} µs", "SIMULATO" if simulated or d.get("simulated") else "reale"]
    return dict(zip(["protocollo", "bit", "codice", "impulso", "origine"], vals))


def ui_sub_evento(d: dict) -> subghz.SubFile:  # RadioTools.save_selected
    return subghz.code_to_sub(int(d["protocol"]), int(d["bits"]), str(d["value"]), int(d["pulse_us"]))


def ui_nome_codice(d: dict) -> str:  # RadioTools.save_selected, nome proposto
    return "codice {v}".format(v=d["value"].lstrip("0") or "0")


def ui_salva_codice(d: dict, sim, name: str, device_id) -> dict:  # RadioTools.save_selected
    sim = sim or bool(d.get("simulated"))
    sub = subghz.code_to_sub(int(d["protocol"]), int(d["bits"]), str(d["value"]), int(d["pulse_us"]))
    meta = {"device": device_id or "", "protocol": sub.code.protocol, "bits": sub.code.bits, "pulse_us": sub.code.pulse_us}
    return {"nomeFile": f"{name}.sub", "testo": subghz.serialize(sub), "origine": "simulato" if sim else "reale", "meta": meta, "messaggio": "Salvato «{n}» nella cassaforte.".format(n=name)}


def ui_istantanea(d: dict) -> list:  # RadioTools.raw_snapshot, ok()
    return [int(x) for x in d.get("timings", [])]


def ui_raw_da_salvare(raw: list) -> dict:  # RadioTools.raw_save
    t = list(raw)
    while t and t[0] < 0:
        t.pop(0)
    if not subghz.raw_valid(t):
        return {"errore": "Niente di valido da salvare: registra prima qualche impulso.", "sub": None, "testo": ""}
    sub = subghz.SubFile(raw=True, raw_timings=t)
    return {"errore": "", "sub": sub, "testo": subghz.serialize(sub)}


def ui_analisi(timings: list) -> str:  # RadioTools.show_analysis
    st = subghz.pulse_analyze(timings)
    return "Impulsi: {n} · breve ≈ {s} µs · lungo ≈ {l} µs · rapporto {r:.2f} · gruppi {c}\nIpotesi: {g}".format(n=st.count, s=st.short_us, l=st.long_us, r=st.ratio, c=st.clusters, g=subghz.guess_protocol(st))


def ui_didascalia(timings: list) -> str:  # PulsePlot.paintEvent
    if not timings:
        return "Nessun impulso registrato"
    total = sum(abs(x) for x in timings) or 1
    return "{n} impulsi · {ms:.1f} ms".format(n=len(timings), ms=total / 1000)


def ui_archivio(text: str) -> dict:  # RadioTools.refresh_archive
    try:
        sub = subghz.parse(text)
        kind = "RAW" if sub.raw else f"rc-switch {sub.code.protocol}, {sub.code.bits} bit"
        why = subghz.check_transmittable(sub)
    except ff.FormatError as e:
        kind, why = "non valido", str(e)
    return {"tipo": kind, "trasmissibile": "sì" if not why else "no: " + why}


def ui_codice_fisso(code: subghz.RcCode) -> str:  # RadioTools.analyse_selected, codice fisso
    us = subghz.rc_airtime_us(code, 1)
    return "Codice fisso {b} bit, impulso {p} µs, circa {ms:.1f} ms per invio.".format(b=code.bits, p=code.pulse_us, ms=us / 1000)


def ui_nome_dispositivo(devices: list, dev_id) -> str:  # DeviceRegister.name
    return next((d["name"] for d in devices if d["id"] == dev_id), "?")


def ui_verifica(text: str) -> dict:  # RadioTools.transmit (dopo check_sendable)
    try:
        sub = subghz.parse(text)
    except ff.FormatError as e:
        return {"errore": str(e), "sub": None}
    why = subghz.check_transmittable(sub)
    if why:
        return {"errore": "Non trasmissibile: {w}".format(w=why), "sub": None}
    return {"errore": "", "sub": sub}


def ui_percorso(item_id: str) -> str:  # RadioTools.transmit
    return f"/polpo/rf433/pc_{item_id[:8]}.sub"


def ui_conferma(name: str, meta: dict, devices: list) -> dict:  # RadioTools.transmit
    dev = ui_nome_dispositivo(devices, meta.get("device", "")) if meta.get("device") else "nessun dispositivo registrato"
    return {"titolo": "Trasmettere a 433,92 MHz?", "testo": "Codice «{n}» per: {d}.\nDopo questa conferma il Polpo ti chiederà di confermare sul suo schermo.".format(n=name, d=dev)}


def ui_trasmesso(d: dict, simulated) -> str:  # RadioTools.transmit, ok()
    return "Trasmesso. Tempo radio usato nell'ultima ora: {s:.1f} s.".format(s=d.get("budget_used_ms", 0) / 1000) + sim_suffix(simulated)


def ui_dettagli(text: str) -> str:  # RadioTools.report, colonna Dettagli
    try:
        sub = subghz.parse(text)
        info = "RAW" if sub.raw else f"rc-switch {sub.code.protocol} · {sub.code.bits} bit · {sub.code.pulse_us} µs"
        if sub.raw:
            st = subghz.pulse_analyze(sub.raw_timings)
            info += f" · {st.short_us}/{st.long_us} µs · {html.escape(subghz.guess_protocol(st))}"
    except ff.FormatError as e:
        info = html.escape(str(e))
    return info


def ui_report(voci: list, devices: list, quando: str) -> str:  # RadioTools.report (con la data già scritta)
    devs = {d["id"]: d for d in devices}
    rows = []
    for it in voci:
        info = ui_dettagli(it["testo"])
        dev = devs.get(it["meta"].get("device", ""), {}).get("name", "—")
        rows.append(f"<tr><td>{html.escape(it['nome'])}</td><td>{html.escape(dev)}</td><td>{info}</td><td>{'SIMULATO' if it['simulato'] else 'reale'}</td><td><tt>{it['sha256'][:16]}</tt></td></tr>")
    return (
        "<!doctype html><meta charset='utf-8'><title>Report radio</title>"
        "<style>body{font-family:sans-serif;margin:2em}td,th{border-bottom:1px solid #ccc;padding:4px 8px;text-align:left}</style>"
        f"<h1>Report radio 433 MHz</h1><p>Creato il {quando} con Polpo Studio. Solo dispositivi propri.</p>"
        "<table><tr><th>Nome</th><th>Dispositivo</th><th>Dettagli</th><th>Origine</th><th>SHA-256</th></tr>" + "".join(rows) + "</table>"
    )


def ui_stato_editor(text: str) -> str:  # RadioTools.check_editor
    try:
        sub = subghz.parse(text)
    except subghz.Unsupported as e:
        text = "Non supportato: {e}".format(e=e)
    except ff.FormatError as e:
        text = "Errore: {e}".format(e=e)
    else:
        why = subghz.check_transmittable(sub)
        text = "Valido. " + ("Trasmissibile con il Polpo." if not why else "Non supportato per la trasmissione: {w}".format(w=why))
    return text


def ui_nome_file_sub(name: str) -> str:  # RadioTools.save_editor
    name = name.strip() or "nuovo.sub"
    return name if name.endswith(".sub") else name + ".sub"


def ui_salva_editor(text: str, name: str) -> dict:  # RadioTools.save_editor
    try:
        subghz.parse(text)
    except ff.FormatError as e:
        return {"errore": str(e), "nomeFile": "", "messaggio": ""}
    return {"errore": "", "nomeFile": ui_nome_file_sub(name), "messaggio": "Salvato nella cassaforte."}


BANDE = [  # RadioTools._bands_tab (colonna Stato già in italiano)
    ("433,92 MHz · OOK/ASK · codici fissi (rc-switch, PT2262/EV1527)", "Supportato"),
    ("433,92 MHz · OOK · RAW (fino a 4096 impulsi)", "Supportato"),
    ("315 / 868 / 915 MHz", "Non supportato: i moduli RF433 lavorano solo a 433,92 MHz"),
    ("FSK / GFSK / LoRa", "Non supportato dall'hardware"),
    ("Rolling code (KeeLoq, Somfy, auto…)", "Escluso per scelta di sicurezza"),
    ("Disturbo radio, prove a forza bruta", "Escluso: illegale"),
]
NOTA_BANDE = "In Italia e in Europa la banda 433,05–434,79 MHz ha limiti di tempo di trasmissione: il Polpo ne tiene conto con il suo limite orario."


def testo_stima(p, b, pulse, rep) -> str:  # apps/radio_budget.create, update()
    ms, n = radio_budget.estimate(p, b, pulse, rep)
    return f"Un invio dura circa {ms:.1f} ms. Nel limite di {RF_BUDGET_LIMIT_MS / 1000:.0f} s all'ora ne rientrano circa {n}."


# ---------------- unicode.json: le tabelle di Python ----------------


def serie(punti: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for c in punti:
        if out and out[-1][1] == c - 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return out


def genera_unicode() -> None:
    tutti = range(0x110000)
    decimali = serie([c for c in tutti if chr(c).isdecimal()])
    for a, b in decimali:  # ogni serie è fatta di gruppi completi 0…9: il valore è (c − a) % 10
        assert (b - a + 1) % 10 == 0 and all(unicodedata.decimal(chr(c)) == (c - a) % 10 for c in range(a, b + 1))
    scrivi("unicode.json", {"spazi": [c for c in tutti if chr(c).isspace()], "decimali": decimali, "cifre": serie([c for c in tutti if chr(c).isdigit()])})


# ---------------- flipper.json ----------------

TESTI_FF = [
    "",
    "\n\n",
    "Filetype: x",
    "Version: 1",
    "Filetype: x\nVersion: 1",
    "Filetype: x\nVersion: 1\n",
    "Filetype: IR signals file\nVersion: 1\n#\nname: a\ntype: parsed\n",
    "Filetype: x\r\nVersion: 1\r\nchiave: valore\r\n",
    "Filetype: x\rVersion: 1\r",
    "   Filetype   :   x   \n\tVersion\t:\t7\t\n",
    "# commento\n\n  # altro\nFiletype: x\nVersion: 2\n# fine",
    "Filetype:\nVersion: 0\n",
    "Filetype: a: b: c\nVersion: 1\nk: v: w\n",
    "Filetype : x\nVersion: 01\n",
    "Filetype: x\nVersion: a\n",
    "Filetype: x\nVersion: 1.0\n",
    "Filetype: x\nVersion: -1\n",
    "Filetype: x\nVersion: +1\n",
    "Filetype: x\nVersion:\n",
    "Filetype: x\nVersion: 1 2\n",
    "Filetype: x\nVersion: ²\n",
    "Filetype: x\nVersion: ①\n",
    "Filetype: x\nVersion: ٣\n",
    "Filetype: x\nVersion: ١٢٣\n",
    "Filetype: x\nVersion: 𝟗\n",
    "Filetype: x\nVersion: 99999999999999999999999999\n",
    "Filetype: x\nVersion: " + "7" * 4300 + "\n",
    "Filetype: x\nVersion: " + "7" * 4301 + "\n",
    "Filetype: x\nVersion: " + "²" * 300 + "\n",
    "Filetype: x\nVersione: 1\n",
    "filetype: x\nVersion: 1\n",
    "\ufeffFiletype: x\nVersion: 1\n",
    "Filetype: x\n:Version: 1\n",
    ":\n",
    "abc\n",
    "Filetype: x\nVersion: 1\nsenza due punti\n",
    "Filetype: x\nVersion: 1\n: valore\n",
    "Filetype: x\nVersion: 1\nk:\n",
    "Filetype: x\nVersion: 1\nk:v\nk2 :v2\n",
    "\u3000Filetype:\u00a0x\u2003\n\x85Version:\u20281\u2029\n\x1ck\x1d:\x1ev\x1f\n",
    "Filetype: x\nVersion: 1\n\u200bk: v\u200b\n",
    "Filetype: x\nVersion: 1\n\vk\f: \tv \n",
    "Filetype: x\nVersion: 1\n#k: v\n #k: v\nk: #v\n",
    "Filetype: ✓ è\nVersion: 1\nchiave😀: valore😀\n",
    "Version: 1\nFiletype: x\n",
    "Filetype: x\nFiletype: y\nVersion: 1\n",
    "Filetype: x\nVersion: 1\nVersion: 2\nFiletype: y\n",
]


def genera_flipper() -> None:
    c = Caso(1)
    testi = list(TESTI_FF)
    pezzi = ["Filetype: x", "Version: 1", "Version: 3", "# nota", "", "  ", "k: v", "chiave : valore con spazi", ":", "a:b", "riga", "\u00a0k\u00a0:\u00a0v", "Version: x", "\tTE: 350", "dati: 1 2 3"]
    for _ in range(120):
        righe = ["Filetype: f", "Version: 1"] if c.prob(0.7) else []
        righe += [c.scegli(pezzi) for _ in range(c.tra(0, 8))]
        testi.append(c.scegli(["\n", "\r\n", "\n\n"]).join(righe) + ("\n" if c.prob(0.5) else ""))

    hex_in = ["", " ", "07 00 00 00", "07000000", "0700 0000", "7", "070", "0g", "GG", "ff FF fF", "  0a\t0B\n", "0 7", "07 00 00 00 00", "zz", "0x07", "٠٧", "0\u00a07", "١", "😀😀", "-1", "+1", "1 2 3 4 5 6 7 8"]
    for _ in range(60):
        hex_in.append(c.testo("0123456789abcdefABCDEF  g\t", 12))

    def fmt_hex(v, w):
        return format(v, "X") if w == 0 else format(v, f"0{w}X")

    int_dieci = ["0", "7", "-7", "+7", " 7 ", "\t7\n", "007", "1_000", "1__0", "_1", "1_", "", " ", "-", "+", "+-1", "0x1f", "1.5", "1e3", "٣٨", "١_٢", "\u20037", "\x1c7", "7\x1c", "7\x00", "²", "①", "𝟗", "-0", "  -  7", "9" * 30, "-" + "9" * 30, "1" * 4300, "1" * 4301, "1_" * 2200 + "1", "1_" * 4300 + "1", "١" * 20, "7\u00a0", "\u30007\u3000", "7 7", "\u0e53", "٣x"]
    int_sedici = ["0x1f", "0X_1F", " -ff ", "+0x", "1_f", "zz", "", "١f", "0x", "x1", "0b1", "f" * 30, "0x_", "0x__1", "FFFFFFFFFFFFFFFF", "0000000000515A01", "g", "1 2", "-0", "ff\n", "\u00a0ff", "-0x10", "0x-10", "_f", "f_", "f__f", "0xx1", "00x1", "1" * 5000, "\x1cf", "ff\x00"]
    for _ in range(150):
        int_dieci.append(c.testo("0123456789_+- \t\u0663\u00b2\u2003\x1cxa", 8))
        int_sedici.append(c.testo("0123456789abcdefABCDEFxX_+- \t\u0663\u2003g", 8))

    dec_in = ["0.33", "0.330000", "1", "1.", ".5", ".", "", " ", "-0", "-0.0", "+.5e-3", "1e5", "1E-5", "1e", "1e+", "e5", ".e5", "1.e5", "inf", "-Infinity", "+INF", "nAn", "-nan", "infinit", "infinityx", "in", "1_0.5", "1__0", "1_", "_1", "1._5", "1_.5", "1e1_0", "1e_10", "0x10", " 0.5 ", "\u2003.5", "١.٥", "--1", "1e500", "-1e500", "1e-500", "4.9e-324", "2.5e-324", "0.1e-1", "1,5", "½", "0.5\x00", "\x1c0.5", "0.5\x85", "1" * 400, "0." + "1" * 400, "9" * 309, "1_000_000.000_1"]
    for _ in range(150):
        dec_in.append(c.testo("0123456789.eE+-_ nNaAiIfF\u0661\t", 9))

    fissi = [0.0, -0.0, 1 / 128, 3 / 128, 0.125, 0.375, 2.5, 0.5, 1.5, -2.5, 0.33, 0.330000001, 1e22, 1e-7, -1e-7, 5e-324, 1.7976931348623157e308, -1.7976931348623157e308, 0.0000005, 0.0000015, 0.0000025, 123.456, 0.05, 0.15, 0.25, 0.35, 44.8, 179.2, 288.0, float("nan"), float("inf"), float("-inf")]
    for k in range(40):
        fissi.append(k / 64)
    for _ in range(80):
        fissi.append(c.decimale())
    for _ in range(80):
        fissi.append(c.tra(-10**7, 10**7) / c.scegli([10, 100, 1000, 1024, 2**20, 3]))
    casi_fissi = []
    for x in fissi:
        for n in (0, 1, 2, 6):
            casi_fissi.append({"in": [enc(x), n], "out": f"{x:.{n}f}"})

    reprf = [0.0, -0.0, 1.0, -1.0, 0.33, 0.1, 1e16, 1.5e16, 9999999999999998.0, 1e15, 123456789012345678.0, 1e-4, 1e-5, 0.0001, 0.00012345, 5e-324, 1.7976931348623157e308, 2.0**53, 2.0**53 + 2, 1 / 3, 2 / 3, 100.0, 1e21, 1e22, 44.8, float("nan"), float("inf"), float("-inf")]
    for _ in range(250):
        reprf.append(c.decimale())
    for _ in range(100):
        reprf.append(c.tra(-10**9, 10**9) / c.scegli([7, 10, 1000, 3, 1e6]))

    stringhe = ["", "a", "a'b", 'a"b', "a'\"b", "\\", "\t\n\r", "\x00\x1f\x7f\x80\xa0\xad", "\u2028\u2029", "é\u0301", "😀", "\u200b\u200e\ufeff", "\ue000", "\U000e0001", " ", "\u3000\u00a0", "ab\x0bcd\x0c", "Samsung · Televisori", "²①", "'", '"', "''", "\x85", "\u00ff\u0100", "\U0001d7d7", "z" * 300, "ê" * 250, "\x01" * 80]
    for _ in range(80):
        stringhe.append(c.testo("ab'\"\\\t\n\x00\x7f\x9f\xa0é\u2003\u200b😀\ue000", 10))

    valori_json = [None, True, False, 0, 1, -5, 2**60, -(2**70), 0.5, -0.25, 1e-7, 1.5e300, float("nan"), float("inf"), "", "x", "it's", [], [1, "a", None], {}, {"a": 1}, {"a": [1, 2], "b": {"c": "d"}}, [[], {}], "😀", "\x00"]
    interi_json = [0, 1, -1, 2**53 + 1, -(2**80), True, False, 4.7, -4.7, 0.5, -0.5, 1e20, -1e300, float("nan"), float("inf"), float("-inf"), "12", " -12 ", "1_2", "0x10", "1.0", "", "abc", "٣", None, [1], {"a": 1}]
    veri_json = [None, True, False, 0, 1, -1, 0.0, -0.0, 0.1, float("nan"), "", "0", " ", [], [0], {}, {"a": 0}, 2**70]

    divint = [[7, 2], [-7, 2], [7, -2], [-7, -2], [0, 5], [0, -5], [6, 3], [288000, 44.8], [288000, 0.001], [288000, 179.2], [288000, 1e-300], [288000, -44.8], [-1, 2**70], [2**70, 3], [-(2**70), 3], [1, 0.1], [1, 3.3], [0, -5.5], [-0.0, 5.5], [5.5, float("inf")], [-5.5, float("inf")], [float("inf"), 3.5], [float("nan"), 2.5], [3, float("nan")], [1e308, 1e-308]]
    for _ in range(100):
        divint.append([c.tra(-10**6, 10**6), c.scegli([c.tra(1, 1000), -c.tra(1, 1000)])])
        divint.append([c.tra(-10**6, 10**6), c.tra(1, 10**6) / c.scegli([7, 10, 1000])])
        divint.append([c.decimale(), c.decimale()])
    divint = [d for d in divint if d[1] != 0]

    divvera = [[1, 1000], [0, 1000], [-1, 1000], [2**53 + 1, 1000], [(2**53 + 1) * 1000 + 499, 1000], [10**30 + 7, 1000], [-(10**30 + 7), 1000], [10**400, 3], [10**307 * 179, 1], [2**1024 - 2**970, 1], [2**1024 - 2**969, 1], [2**1024 - 2**971, 1], [2**1024 - 2**970 - 1, 1], [2**54 + 1, 1], [2**54 + 3, 1], [2**54 + 2, 1], [-(2**54 + 3), 1], [3 * 2**60 + 1, 3], [7, 2], [1, 3], [2**60, 3], [2**60 + 1, 2**60], [True, 1000], [350.5, 1000], [2**70, 0.5], [float("inf"), 1000], ["a", 1000], [None, 1000], [[1], 1000]]
    for _ in range(120):
        divvera.append([c.bit64() * c.bit64() * c.tra(1, 2**40) * c.scegli([1, -1]), c.scegli([1000, 3, 7, c.tra(1, 2**62), c.tra(1, 2**100)])])
        divvera.append([c.tra(-(2**53), 2**53), c.tra(1, 10**6)])

    def dividi_vera(a, b):
        return a / b

    a_byte = [[0, 4, "little"], [4, 4, "little"], [2**32 - 1, 4, "little"], [2**32, 4, "little"], [-1, 4, "little"], [-(2**40), 4, "little"], [0x515A01, 8, "big"], [2**64 - 1, 8, "big"], [2**64, 8, "big"], [0x200280, 4, "little"], [1.5, 4, "little"], [True, 4, "little"]]
    da_byte = [[[], "big"], [[1], "big"], [[1, 2], "big"], [[1, 2], "little"], [[255] * 8, "big"], [[0, 0, 0, 0, 0, 0x51, 0x5A, 0x01], "big"], [[7, 0, 0, 0], "little"], [[0x80, 2, 0x20, 0], "little"]]
    esa = [[0, 0], [255, 0], [255, 4], [-5, 4], [-5, 1], [0, 1], [0x515A01, 6], [2**64 - 1, 16], [2**70, 1], [-(2**70), 30], [10, 10]]

    html_in = ["", "<a href=\"x\">'&'</a>", "&amp;", "compatibile con PT2262 / EV1527 (rc-switch 1, \"Princeton\")", "riga 3: manca ':'", "à è ì"]
    utf8 = [[], [0x41], [0xEF, 0xBB, 0xBF, 0x41], [0xC3, 0xA8], [0xC3], [0xC3, 0x41], [0xE2, 0x82], [0xE2, 0x82, 0xAC], [0xF0, 0x9F, 0x98, 0x80], [0xF0, 0x9F, 0x98], [0xED, 0xA0, 0x80], [0xC0, 0xAF], [0xF8, 0x88, 0x80, 0x80, 0x80], [0xFF], [0x80, 0x80], [0xF4, 0x90, 0x80, 0x80], [0xE0, 0x80, 0x80], [0xF0, 0x80, 0x80, 0x80]]
    for _ in range(150):
        utf8.append([c.scegli([0x41, 0x0A, 0x80, 0xBF, 0xC2, 0xC3, 0xDF, 0xE0, 0xE2, 0xED, 0xEF, 0xF0, 0xF4, 0xF5, 0xFF, 0x9F, 0xA0, 0x8F, 0x90]) for _ in range(c.tra(0, 10))])
    codifica = ["", "abc", "è😀", "a\ud800b", "\udc00", "ab\ud800\ud800c", "\udc00\ud800x", "\ud83d"]

    scrivi(
        "flipper.json",
        {
            "parse": [caso(t, ff.parse, t) for t in testi],
            "line": [caso(a, ff.line, *a) for a in (["Frequency", 433920000], ["Preset", "x"], ["k", ""], ["", "v"], ["Version", 2**70], ["TE", -5], ["k", "a: b"])],
            "header": [caso(a, ff.header, *a) for a in (["IR signals file", 1], ["Flipper SubGhz Key File", 1], ["", 0], ["x", 12])],
            "parse_hex_bytes": [caso(t, ff.parse_hex_bytes, t) for t in hex_in],
            "hex_bytes": [caso(b, lambda b: ff.hex_bytes(bytes(b)), b) for b in ([], [0], [7, 0, 0, 0], [255, 16, 1], list(range(0, 256, 17)))],
            "isdigit": [caso(t, str.isdigit, t) for t in ["", "1", "12", "1a", "²", "①", "٣", "𝟗", " 1", "-1", "½", "Ⅳ", "\u0e53\u0e54", "1²", "0" * 50]],
            "strip": [caso(t, str.strip, t) for t in stringhe[:40] + [" \t\n\x0b\x0c\r\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000x \u3000", "\u200bx\u200b", "\ufeffx\ufeff"]],
            "split": [caso(t, str.split, t) for t in ["", " ", "a b", "  a  b  ", "a\tb\nc\x1cd\x85e\u3000f\u200bg", "1 2 3", "\u00a0\u00a0", "a\ufeffb"]],
            "int_dieci": [caso(t, int, t) for t in int_dieci],
            "int_sedici": [caso(t, lambda t: int(t, 16), t) for t in int_sedici],
            "float": [caso(t, float, t) for t in dec_in],
            "fmt_fixed": casi_fissi,
            "repr_float": [caso(x, repr, x) for x in reprf],
            "repr_str": [caso(s, repr, s) for s in stringhe],
            "repr_json": [caso(v, repr, v) for v in valori_json],
            "str_json": [caso(v, str, v) for v in valori_json],
            "int_json": [caso(v, int, v) for v in interi_json],
            "bool_json": [caso(v, bool, v) for v in veri_json],
            "floordiv": [caso(d, lambda a, b: a // b, *d) for d in divint],
            "truediv": [caso(d, dividi_vera, *d) for d in divvera],
            "to_bytes": [caso(a, lambda v, n, o: v.to_bytes(n, o), *a) for a in a_byte],
            "from_bytes": [caso(a, lambda b, o: int.from_bytes(bytes(b), o), *a) for a in da_byte],
            "hex_fmt": [caso(a, fmt_hex, *a) for a in esa],
            "html_escape": [caso(s, html.escape, s) for s in html_in + stringhe[:20]],
            "utf8_decode": [caso(b, lambda b: bytes(b).decode("utf-8", "replace"), b) for b in utf8],
            "utf8_encode": [caso(s, lambda s: list(s.encode()), s) for s in codifica],
        },
    )


# ---------------- ir.json ----------------

NOMI_PROTOCOLLI = [p.name for p in ir.PROTOCOLS.values()]
ESEMPIO_TV = (Path(__file__).resolve().parents[4] / "polpo/sd_template/polpo/ir/esempio_tv.ir").read_text(encoding="utf-8")


def segnali_casuali(c: Caso) -> list[dict]:
    out = []
    for _ in range(400):
        raw = c.prob(0.45)
        p = c.scegli(NOMI_PROTOCOLLI + ["", "boh", "nec", "SAMSUNG32", "\u212aaseikyo", "NEC "])
        proto = ir.protocol(p)
        ab = proto.address_bits if proto else 8
        cb = proto.command_bits if proto else 8
        d = {
            "name": c.scegli(["", "tasto", "Accendi", "😀", " "]),
            "raw": raw,
            "protocol": p,
            "address": c.scegli([0, 1, 2**ab - 1, 2**ab, c.tra(0, 2**ab - 1), c.tra(0, 2**32 - 1), -1, 2**40, 2**60]),
            "command": c.scegli([0, 1, 2**cb - 1, 2**cb, c.tra(0, 2**cb - 1), -1, 2**33]),
            "frequency": c.scegli([38000, 9999, 10000, 36000, 100000, 100001, 0, -38000, 2**70, c.tra(5000, 120000)]),
            "duty": c.scegli([0.33, 0.0, 1e-9, 0.5, 0.999999, 1.0, -0.1, 1.5, float("nan"), float("inf"), c.intero(1000) / 1000]),
        }
        n = c.scegli([0, 1, 2, c.tra(3, 24), c.tra(3, 24), c.tra(3, 12)])
        tempi = []
        for _ in range(n):
            tempi.append(c.scegli([c.tra(1, 3000), c.tra(1, 3000), c.tra(1, 3000), 100000, 100001, 0, -5, 99999]))
        if c.prob(0.05):
            tempi = [100000] * 21  # totale 2,1 s
        if c.prob(0.03):
            tempi = [100000] * 20  # esattamente 2 s
        d["timings"] = tempi
        out.append(d)
    return out


def testo_ir_casuale(c: Caso) -> str:
    righe = []
    if c.prob(0.9):
        righe.append("Filetype: " + c.scegli(["IR signals file"] * 6 + ["IR library file", "IR signal file", "Flipper SubGhz Key File"]))
        righe.append("Version: " + c.scegli(["1"] * 8 + ["2", "x"]))
    for _ in range(c.tra(0, 6)):
        if c.prob(0.3):
            righe.append("#")
        righe.append("name: " + c.scegli(["Power", "Vol_up", "", "tasto 1", "😀", "  spazi  ", "a: b"]))
        raw = c.prob(0.4)
        if c.prob(0.95):
            righe.append("type: " + (c.scegli(["raw"] * 9 + ["RAW", "boh"]) if raw else c.scegli(["parsed"] * 9 + ["Parsed", ""])))
        if raw:
            if c.prob(0.9):
                righe.append("frequency: " + c.scegli(["38000"] * 5 + ["36000", "9999", "100001", "38k", "", "-38000", "٣٨٠٠٠", "40000"]))
            if c.prob(0.9):
                righe.append("duty_cycle: " + c.scegli(["0.330000"] * 4 + ["0.5", "1", "0", "nan", "inf", "abc", "0,33", ".25", "1e-1", "0.3_3", "-0.1"]))
            for _ in range(c.tra(0, 3)):
                n = c.tra(0, 16)
                toks = [str(c.scegli([c.tra(1, 3000), c.tra(100, 9000), 0, 100000, 100001])) for _ in range(n)]
                if c.prob(0.1):
                    toks.insert(c.tra(0, len(toks)), c.scegli(["-560", "abc", "1.5", "+5", "٣٠٠", "1_000"]))
                righe.append("data: " + c.scegli([" ", "  ", "\t"]).join(toks))
        else:
            if c.prob(0.95):
                righe.append("protocol: " + c.scegli(NOMI_PROTOCOLLI + ["nec", "SIRC", "Boh", "", "RC-5"]))
            for k in ("address", "command"):
                if c.prob(0.95):
                    b = [c.scegli([0, c.tra(0, 255), 0, 0]) for _ in range(4)]
                    v = " ".join(f"{x:02X}" for x in b)
                    v = c.scegli([v] * 8 + [v.lower(), v.replace(" ", ""), v[:-3], v + " 00", v[:-1], "zz 00 00 00", ""])
                    righe.append(f"{k}: {v}")
        if c.prob(0.1):
            righe.append(c.scegli(["note: qualcosa", "bits: 32", "repeat: 1"]))
    if c.prob(0.03):
        righe.insert(c.tra(0, len(righe)), "riga senza due punti")
    return c.scegli(["\n", "\r\n"]).join(righe) + "\n"


TESTI_IR = [
    ESEMPIO_TV,
    "Filetype: altro\nVersion: 1\n",
    "Filetype: IR signals file\nVersion: 1\n",
    "Filetype: IR library file\nVersion: 1\n#\nname: a\ntype: parsed\nprotocol: nec\naddress: 04 00 00 00\ncommand: 08 00 00 00\n",
    (
        "Filetype: IR signals file\nVersion: 1\n#\nname: ok\ntype: parsed\nprotocol: NEC\naddress: 04 00 00 00\ncommand: 08 00 00 00\n"
        "#\nname: grande\ntype: parsed\nprotocol: NEC\naddress: 00 01 00 00\ncommand: 08 00 00 00\n"
        "#\nname: ignoto\ntype: parsed\nprotocol: Boh\n"
        "#\nname: raw\ntype: raw\nfrequency: 38000\nduty_cycle: 0.330000\ndata: 9000 4500\ndata: 560 560\n"
    ),
    "Filetype: IR signals file\nVersion: 1\nprotocol: NEC\naddress: 04 00 00 00\n#\nname: dopo\ntype: parsed\nprotocol: RC5\n",
    "Filetype: IR signals file\nVersion: 1\nname:\ntype: parsed\nprotocol: NEC\n",
    "Filetype: IR signals file\nVersion: 1\nname: k\ntype: parsed\nprotocol: \u212aaseikyo\naddress: 80 02 20 00\ncommand: D0 03 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: k\ntype: parsed\nprotocol: Kaseikyo\naddress: 00 00 00 04\ncommand: 00 04 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: t\ntype: boh\nprotocol: NEC\n#\nname: u\ntype: raw\nfrequency: 38000\ndata: 1 2 3\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: ²\ndata: 100\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\ndata: 100 ①\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: ٣٨٠٠٠\nduty_cycle: ٠.٥\ndata: ٥٦٠ 1690\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\nduty_cycle: nan\ndata: 100\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\nduty_cycle: 1_0e-1_0\ndata: 100\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\nduty_cycle: 0.0078125\ndata: 100\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\ndata:\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\ndata: " + " ".join(["500"] * 1024) + "\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\ndata: " + " ".join(["500"] * 1025) + "\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\ndata: " + " ".join(["100000"] * 20) + "\n#\nname: s\ntype: raw\nfrequency: 38000\ndata: " + " ".join(["100000"] * 21) + "\n",
    "Filetype: IR signals file\nVersion: 1\nname: r\ntype: raw\nfrequency: 38000\ndata: 100001 99999999999999999999\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: NEC\nfrequency: 99999999999999999999\ndata: 5 6\naddress: 04 00 00 00\ncommand: 08 00 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: NEC\naddress: 04 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: NEC\naddress: 04 00 00 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: NEC\ncommand: 0x08\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: NECext\naddress: FF FF 00 00\ncommand: FF FF 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: NECext\naddress: FF FF 01 00\ncommand: FF FF 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: RC5\naddress: 1F 00 00 00\ncommand: 40 00 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: p\ntype: parsed\nprotocol: RC5\naddress: 1F 00 00 00\ncommand: 3F 00 00 00\n",
    "Filetype: IR signals file\nVersion: 1\nname: a\n#\nname: b\ntype: parsed\nprotocol: NEC\naddress: 04 00 00 00\ncommand: 08 00 00 00\nname: c\ntype: raw\n",
    "Filetype: IR signals file\nVersion: 1\nname: x\ntype: parsed\nriga rotta\n",
    "Filetype: IR signals file\r\nVersion: 1\r\nname: crlf\r\ntype: parsed\r\nprotocol: SIRC20\r\naddress: FF 1F 00 00\r\ncommand: 7F 00 00 00\r\n",
]


def genera_ir() -> None:
    c = Caso(2)
    testi = list(TESTI_IR) + [testo_ir_casuale(c) for _ in range(300)]
    segnali = segnali_casuali(Caso(3))
    a_mano = [
        {"name": "x", "raw": True, "timings": [200_000]},
        {"name": "x", "raw": True, "timings": []},
        {"name": "", "raw": True, "timings": [1]},
        {"name": "x", "raw": True, "timings": [1], "frequency": 10_000, "duty": 1e-300},
        {"name": "x", "raw": True, "timings": [2**70]},
        {"name": "x", "raw": True, "timings": [1950] * 1023},
        {"name": "x", "raw": True, "timings": [1950] * 1024},
        {"name": "x", "raw": True, "timings": [1950] * 1025},
        {"name": "x", "raw": True, "timings": [100000] * 20},
        {"name": "x", "raw": True, "timings": [100000] * 20 + [1]},
        {"name": "x", "protocol": "NEC", "address": 4, "command": 8},
        {"name": "x", "protocol": "nec", "address": 255, "command": 256},
        {"name": "x", "protocol": "Kaseikyo", "address": 2**26 - 1, "command": 2**10 - 1},
        {"name": "x", "protocol": "NEC42ext", "address": 2**26, "command": 0},
        {"name": "x", "protocol": "\u212aaseikyo", "address": 1, "command": 1},
        {"name": "x", "protocol": "constructor"},
        {"name": "x", "protocol": "__proto__"},
        {"name": "x", "protocol": "toString"},
        {"name": "x", "protocol": "hasOwnProperty"},
        {"name": "x", "protocol": "nec42EXT", "address": -1},
        {"name": "x", "protocol": "RCA", "address": 15, "command": 255},
        {"name": "x", "protocol": "RCA", "address": 16, "command": 255},
    ]
    tutti = a_mano + segnali

    letti = []
    for t in testi:
        try:
            letti.append(ir.parse(t))
        except Exception:  # noqa: BLE001
            pass
    da_scrivere = [{"filetype": f.filetype, "signals": [enc(s) for s in f.signals]} for f in letti]
    for i in range(0, len(tutti), 6):
        da_scrivere.append({"filetype": "IR signals file", "signals": [enc(segnale(d)) for d in tutti[i : i + 6]]})
    da_scrivere.append({"filetype": "x", "signals": [enc(ir.Signal("t", raw=True, duty=d, timings=[1, 2])) for d in (1 / 128, 3 / 128, -0.0, 0.0000005, float("nan"), float("-inf"), 1e22)]})
    da_scrivere.append({"filetype": "x", "signals": [enc(ir.Signal("t", protocol="NEC", address=2**32))]})
    da_scrivere.append({"filetype": "x", "signals": [enc(ir.Signal("t", protocol="boh", command=-1))]})
    da_scrivere.append({"filetype": "IR signals file", "signals": []})

    def scrivi_ir(d):
        return ir.serialize(ir.IrFile(d["filetype"], [segnale(dec_segnale(s)) for s in d["signals"]]))

    def rilettura(d):
        return ir.parse(scrivi_ir(d))

    categorie = list(ir.CATEGORIES) + ["altro"]
    coppie = [[cat, b] for cat in categorie for b in ir.brands(cat) + ["Nessuna"]] + [["tv", "Sony"], ["audio", "Sony"], ["", ""]]
    eventi = [
        {"protocol": "NEC", "address": 4, "command": 8, "simulated": True},
        {"protocol": "Samsung32", "address": 7, "command": 2, "simulated": True},
        {"raw": True, "timings": [9000, 4500, 560, 560, 560, 1690, 560], "simulated": True},
        {"raw": True, "timings": []},
        {"raw": True, "timings": ["560", 1690.7, True]},
        {"raw": True, "timings": "123"},
        {"raw": True, "timings": None},
        {"raw": True, "timings": 5},
        {"raw": True, "timings": {"100": 1, "200": 2}},
        {"raw": True},
        {"raw": 1, "timings": [100, "x"]},
        {"raw": "", "protocol": "nec", "address": "4", "command": 8.9},
        {"raw": [], "protocol": "RC6"},
        {"raw": 0},
        {},
        {"protocol": None},
        {"protocol": 5, "address": 1},
        {"protocol": "NEC", "address": None},
        {"protocol": "NEC", "address": 256},
        {"protocol": "NEC", "address": "0x10"},
        {"protocol": "NEC", "address": float("nan")},
        {"protocol": "NEC", "command": float("inf")},
        {"protocol": "NEC", "address": [1]},
        {"protocol": "NEC", "address": True, "command": False},
        {"protocol": ["NEC"], "address": 1},
        {"protocol": {"a": 1}},
        {"protocol": "NECext", "address": 2**60, "command": 1},
        {"protocol": "NEC", "address": 1, "command": 1, "simulated": 0},
        {"protocol": "NEC", "address": 1, "command": 1, "simulated": "sì"},
        {"raw": True, "timings": [100] * 1025},
    ]
    scrivi(
        "ir.json",
        {
            "costanti": {"MAX_RAW_TIMINGS": ir.MAX_RAW_TIMINGS, "MAX_RAW_TIMING_US": ir.MAX_RAW_TIMING_US, "MAX_RAW_TOTAL_US": ir.MAX_RAW_TOTAL_US},
            "protocolli": [[k, enc(p)] for k, p in ir.PROTOCOLS.items()],
            "protocollo": [caso(n, lambda n: (lambda p: p.name if p else None)(ir.protocol(n)), n) for n in NOMI_PROTOCOLLI + [n.lower() for n in NOMI_PROTOCOLLI] + [n.upper() for n in NOMI_PROTOCOLLI] + ["", "boh", " nec", "nec ", "\u212aaseikyo", "\u212a", "constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "NEC\u0130", "s\u0130rc", "ſirc"]],
            "valida": [caso(d, lambda d: segnale(d).validate(), d) for d in tutti],
            "argomenti_link": [caso(d, lambda d: segnale(d).link_args(), d) for d in tutti[:140]],
            "leggi": [caso(t, ir.parse, t) for t in testi],
            "scrivi": [caso(d, scrivi_ir, d) for d in da_scrivere],
            "rilettura": [caso(d, rilettura, d) for d in da_scrivere[: len(letti)]],
            "tasti": {k: v[0] for k, v in ir.BUTTONS.items()},
            "ordine_tasti": list(ir.BUTTONS),
            "categorie": {k: v[0] for k, v in ir.CATEGORIES.items()},
            "ordine_categorie": list(ir.CATEGORIES),
            "libreria": [enc(x) for x in ir.LIBRARY],
            "segnali_libreria": [enc(x.signal()) for x in ir.LIBRARY],
            "valida_libreria": [x.signal().validate() for x in ir.LIBRARY],
            "marche": [caso(cat, ir.brands, cat) for cat in categorie + [""]],
            "codici": [caso(p, ir.codes, *p) for p in coppie],
            "ui_segnali_libreria": [caso(p, ui_segnali_libreria, *p) for p in coppie],
            "ui_titolo_libreria": [caso(p, ui_titolo_libreria, *p) for p in coppie],
            "ui_nota": [caso([w, s], ui_nota, w, s) for w in ([], ['"a" saltato: tipo x'], ['"a" saltato: x', '"b" saltato: y']) for s in (False, True)],
            "ui_descrivi": [caso(d, lambda d: ui_descrivi(segnale(d)), d) for d in tutti[:90]],
            "ui_nome_file": [caso(n, ui_nome_file_ir, n) for n in ["tv camera", " tv.ir ", "tv.IR", "", "   ", ".ir", "a.ir.ir", "\u3000tv\u3000", "tv.ir\u200b"]],
            "ui_nome_copia": [caso(t, ui_nome_copia, t) for t in ["Samsung · Televisori", "a · b · c", "senza", " ·  · "]],
            "ui_importa": [caso(t, ui_importa, t) for t in testi[:80]],
            "ui_invio": [caso(d, lambda d: ui_invio(segnale(d)), d) for d in tutti[:100]],
            "ui_inviato": [caso([d, s], lambda d, s: ui_inviato(segnale(d), s), d, s) for d in tutti[:6] for s in (False, True)],
            "ui_tasto_imparato": [caso([e, n, s], ui_tasto_imparato, e, n, s) for e in eventi for n, s in ((1, False), (7, True))],
        },
    )


def dec_segnale(s: dict) -> dict:
    """Da un segnale codificato da enc() di nuovo a valori Python."""
    return {k: dec(v) for k, v in s.items()}


def dec(x):
    if isinstance(x, dict):
        if "$int" in x:
            return int(x["$int"], 16)
        if "$float" in x:
            return float(x["$float"])
        return {k: dec(v) for k, v in x.items()}
    if isinstance(x, list):
        return [dec(v) for v in x]
    return x


# ---------------- subghz.json ----------------


def testo_sub_casuale(c: Caso) -> str:
    righe = []
    raw = c.prob(0.4)
    if c.prob(0.95):
        righe.append("Filetype: " + (c.scegli([subghz.RAW_TYPE] * 6 + [subghz.KEY_TYPE, "IR signals file"]) if raw else c.scegli([subghz.KEY_TYPE] * 6 + [subghz.RAW_TYPE, "Flipper SubGhz"])))
        righe.append("Version: " + c.scegli(["1"] * 9 + ["x"]))
    campi = []
    if c.prob(0.9):
        campi.append("Frequency: " + c.scegli(["433920000"] * 5 + ["433050000", "434790000", "433049999", "434790001", "868350000", "315000000", "433.92", "", "99999999999999999999", "٤٣٣٩٢٠٠٠٠"]))
    if c.prob(0.8):
        campi.append("Preset: " + c.scegli([subghz.DEFAULT_PRESET, "FuriHalSubGhzPreset2FSKDev238Async", "", "x: y"]))
    if raw:
        campi.append("Protocol: " + c.scegli(["RAW"] * 9 + ["raw"]))
        for _ in range(c.tra(0, 3)):
            n = c.tra(0, 24)
            inizio = 1 if c.prob(0.7) else -1
            toks = []
            for i in range(n):
                v = c.scegli([350, 1050, c.tra(50, 2000), c.tra(1, 30000)])
                toks.append(str(v * (inizio if i % 2 == 0 else -inizio)))
            if c.prob(0.15):
                toks.insert(c.tra(0, len(toks)), c.scegli(["0", "abc", "+350", "-0", "1_000", "٣٥٠", "3.5", "--1", "99999999999999999999", "-99999999999999999999"]))
            if c.prob(0.1) and toks:
                toks[c.tra(0, len(toks) - 1)] = c.scegli(["350", "-350"])
            campi.append("RAW_Data: " + " ".join(toks))
    else:
        campi.append("Protocol: " + c.scegli(["Princeton"] * 5 + ["Polpo_RCSwitch"] * 3 + ["KeeLoq", "Nice FLO", "princeton", ""]))
        bits = c.scegli([24] * 4 + [1, 12, 32, 0, 33, c.tra(1, 32)])
        if c.prob(0.9):
            campi.append("Bit: " + c.scegli([str(bits)] * 6 + ["x", "", "024", "²"]))
        if c.prob(0.9):
            nb = c.scegli([8] * 6 + [1, 3, 4, 9, 0])
            v = c.intero(2 ** min(bits if 0 < bits <= 32 else 24, 32))
            if c.prob(0.1):
                v = c.intero(2**64)
            b = v.to_bytes(8, "big")[-nb:] if nb <= 8 else bytes(nb - 8) + v.to_bytes(8, "big")
            k = ff.hex_bytes(b)
            campi.append("Key: " + c.scegli([k] * 8 + [k.replace(" ", ""), k[:-1], "zz"]))
        if c.prob(0.9):
            campi.append("TE: " + c.scegli(["350"] * 5 + ["50", "5000", "49", "5001", "x", str(c.tra(50, 5000))]))
        if c.prob(0.4):
            campi.append("RCS_Protocol: " + c.scegli(["1", "2", "5", "12", "0", "13", "x", str(c.tra(1, 12))]))
    for _ in range(c.tra(0, 1)):
        campi.insert(c.tra(0, len(campi)), c.scegli(["# commento", "Altro: x", ""]))
    righe += campi
    return c.scegli(["\n", "\r\n"]).join(righe) + "\n"


def princeton(bits_val: int, bits: int = 24, short: int = 350) -> list[int]:
    t = []
    for i in range(bits - 1, -1, -1):
        t += [3 * short, -short] if (bits_val >> i) & 1 else [short, -3 * short]
    return t + [short, -31 * short]


def tempi_casuali(c: Caso) -> list[int]:
    tipo = c.intero(6)
    if tipo == 0:  # PT2262 con un po' di tremolio
        s = c.tra(150, 700)
        t = princeton(c.intero(2**24), 24, s)
        return [x + c.tra(-s // 8, s // 8) * (1 if x > 0 else -1) for x in t]
    if tipo == 1:  # rapporto 1:2
        s = c.tra(100, 900)
        return [(s if c.prob(0.5) else 2 * s) * (1 if i % 2 == 0 else -1) for i in range(c.tra(10, 60))]
    if tipo == 2:  # rumore
        return [c.tra(1, 25000) * (1 if i % 2 == 0 else -1) for i in range(c.tra(0, 60))]
    if tipo == 3:  # pochi impulsi
        return [c.tra(40, 3000) * c.scegli([1, -1]) for _ in range(c.tra(0, 18))]
    if tipo == 4:  # valori ai limiti
        return [c.scegli([49, 50, 51, 19999, 20000, 20001, 0, -50, -20000, 2**70, -(2**70)]) for _ in range(c.tra(1, 30))]
    s = c.tra(50, 400)  # tre durate
    return [c.scegli([s, 2 * s, 5 * s, 9 * s]) * (1 if i % 2 == 0 else -1) for i in range(c.tra(16, 80))]


TESTI_SUB = [
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: 433920000\nPreset: FuriHalSubGhzPresetOok650Async\nProtocol: Princeton\nBit: 24\nKey: 00 00 00 00 00 51 5A 01\nTE: 350\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: 868350000\nPreset: FuriHalSubGhzPresetOok650Async\nProtocol: Princeton\nBit: 24\nKey: 00 00 00 00 00 12 34 56\nTE: 350\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: KeeLoq\nBit: 64\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: 433920000\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nBit: 8\nKey: 00 00 00 00 00 51 5A 01\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nBit: 32\nKey: 00 00 00 01 FF FF FF FF\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nBit: 32\nKey: FF FF FF FF\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nKey: FF FF FF\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nKey: 01 00 00 00\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Polpo_RCSwitch\nRCS_Protocol: 12\nBit: 12\nKey: 0F FF\nTE: 5000\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nRCS_Protocol: 5\nBit: 12\nKey: 0F FF\nTE: 50\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nRCS_Protocol: 5\nProtocol: Polpo_RCSwitch\nKey: 00\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nKey: \n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nKey: 00 00 00 00 00 00 00 00 00\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nBit: ²\nKey: 00\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: Princeton\nTE: ①\nKey: 00\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: ³\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: ٤٣٣٩٢٠٠٠٠\nProtocol: Princeton\nBit: ٢٤\nKey: 01\nTE: ٣٥٠\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: 433920000000000000000000\nProtocol: Princeton\nKey: 01\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: " + "4" * 4301 + "\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nFrequency: 433920000\nProtocol: RAW\nRAW_Data: 350 -1050 1050 -350\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: -5000 350 -1050\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: -5000 -350 1050\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: 350 0 -350\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: -350\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: 350 abc\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: +350 -1_050 ٣٥٠ -0x10\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: +350 -1_050 ٣٥٠ -10\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: 350 ²\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: 350 -" + "9" * 4301 + "\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nRAW_Data: 99999999999999999999 -99999999999999999999 1\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\nKey: FF FF FF FF FF FF FF FF\nBit: 3\nRAW_Data: 1 -1\n",
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\n" + "".join("RAW_Data: " + " ".join(["350", "-1050"] * 256) + "\n" for _ in range(8)),
    "Filetype: Flipper SubGhz RAW File\nVersion: 1\nProtocol: RAW\n" + "".join("RAW_Data: " + " ".join(["350", "-1050"] * 256) + "\n" for _ in range(8)) + "RAW_Data: 350\n",
    "Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: RAW\nRAW_Data: 1 -2\n",
    "Filetype: IR signals file\nVersion: 1\n",
    "Filetype: Flipper SubGhz Key File\nVersion: x\n",
    "Filetype: Flipper SubGhz Key File\r\nVersion: 1\r\nFrequency: 433920000\r\nProtocol: Princeton\r\nBit: 24\r\nKey: 00 00 00 00 00 51 5A 01\r\nTE: 350\r\n",
]


def genera_subghz() -> None:
    c = Caso(4)
    testi = list(TESTI_SUB) + [testo_sub_casuale(c) for _ in range(350)]
    letti = []
    for t in testi:
        try:
            letti.append(subghz.parse(t))
        except Exception:  # noqa: BLE001
            pass
    c2 = Caso(5)
    file_a_mano = [
        {},
        {"frequency": 868_350_000},
        {"frequency": 433_050_000, "code": {"protocol": 2, "bits": 32, "value": 2**32 - 1, "pulse_us": 650}},
        {"code": {"protocol": 1, "bits": 33}},
        {"raw": True, "code": {"bits": 40}},
        {"raw": True, "raw_timings": [350, -1050] * 300},
        {"raw": True, "raw_timings": []},
        {"raw": True, "raw_timings": [2**70, -(2**70)]},
        {"code": {"protocol": 1, "value": 2**64 - 1}},
        {"code": {"protocol": 1, "value": 2**64}},
        {"code": {"protocol": 3, "value": -1}},
        {"code": {"protocol": 0, "bits": 0, "value": 0, "pulse_us": 0}},
        {"frequency": 2**70},
        {"preset": ""},
    ]
    for _ in range(60):
        file_a_mano.append({"frequency": c2.scegli([433_920_000, 433_049_999, 434_790_000, 315_000_000]), "raw": c2.prob(0.3), "code": {"protocol": c2.tra(1, 12), "bits": c2.tra(1, 40), "value": c2.intero(2**32), "pulse_us": c2.tra(50, 5000)}, "raw_timings": [c2.tra(1, 2000) * (1 if i % 2 == 0 else -1) for i in range(c2.tra(0, 20))]})
    file_in = [enc(f) for f in letti] + [enc(file_sub(d)) for d in file_a_mano]
    for f in file_in:
        f.pop("in_band", None)
    lunghi = [f for f in file_in if len(f["raw_timings"]) > 64]
    file_in = [f for f in file_in if len(f["raw_timings"]) <= 64] + lunghi[:2]  # due file lunghi bastano (righe da 512)
    testi_brevi = [t for t in testi if len(t) < 2000]

    def scrivi_sub(d):
        return subghz.serialize(file_sub(dec(d)))

    def trasmissibile(d):
        return subghz.check_transmittable(file_sub(dec(d)))

    rawv = [[], [1], [-1], [0], [1, -1], [1, 1], [1, -1, 1], [1, 0, -1], [5, -5, -5], [2**70, -1], [1, -(2**70), 3], [350, -1050] * 4, [-350, 1050]]
    for _ in range(100):
        rawv.append([c2.scegli([c2.tra(1, 3000), -c2.tra(1, 3000), 0]) for _ in range(c2.tra(0, 10))])
        t = [c2.tra(1, 3000) * (1 if i % 2 == 0 else -1) for i in range(c2.tra(1, 12))]
        rawv.append(t)

    serie_tempi = [[], [350], princeton(0x515A01), princeton(0x515A01)[:30], [1050, -350] * 12 + [350, -10850]] + [tempi_casuali(Caso(100 + i)) for i in range(260)]
    t = []
    for i in range(24):
        t += [1050, -350] if i % 3 == 0 else [350, -1050]
    serie_tempi.append(t + [350, -10850])

    def analisi(tempi):
        st = subghz.pulse_analyze(tempi)
        return {**enc(st), "guess": subghz.guess_protocol(st)}

    stat = []
    for cnt in (0, 15, 16, 100):
        for r in (0.0, 1.69, 1.7, 2.0, 2.3, 2.31, 2.59, 2.6, 3.0, 3.4, 3.41):
            for s in (149, 150, 700, 701):
                stat.append({"count": cnt, "ratio": r, "short_us": s})

    aria = []
    for p in (-1, 0, 1, 2, 3, 7, 8, 9, 12, 13):
        for b in (0, 1, 24, 32, 33):
            for pulse in (350, 50):
                for rep in (1, 4):
                    aria.append([p, b, pulse, rep])
    aria += [[1, 24, 0, 1], [1, 24, -350, 1], [1, 24, 350, 0], [1, 24, 350, -2], [1, 24, 10**12, 10**9], [8, 32, 2**60, 2**60], [1.5, 24, 350, 1], [1, 24.5, 350, 1], [1, 24, 350.5, 3], [1, 24, 350, 2.5], [True, 24, 350, 1], [1, True, 350, 1]]

    def tempo_aria(p, b, pulse, rep):
        return subghz.rc_airtime_us(subghz.RcCode(p, b, 0, pulse), rep)

    a_sub = [[1, 24, "0000000000515A01", 350], [2, 12, "fff", 650], [1, 24, "0x10", 350], [1, 24, "zz", 350], [1, 24, "", 350], [1, 24, "-1", 350], [1, 24, "F" * 16, 350], [1, 24, "1" + "0" * 16, 350], [1, 24, " 1_0 ", 350], [1, 24, 5, 350], [13, 99, "1", 1]]
    eventi = [
        {"protocol": 1, "bits": 24, "value": "0000000000515A01", "pulse_us": 350, "simulated": True},
        {"protocol": 1, "bits": 24, "value": "0000000000515A02", "pulse_us": 352, "simulated": True},
        {"protocol": 2, "bits": 12, "value": "0FFF", "pulse_us": 650},
        {"protocol": "3", "bits": 8.9, "value": "00", "pulse_us": True},
        {"protocol": 1, "bits": 0, "value": "0", "pulse_us": 350},
        {"protocol": 1, "bits": -7, "value": "-5", "pulse_us": 350},
        {"protocol": 1, "bits": 64, "value": "FFFFFFFFFFFFFFFF", "pulse_us": 350},
        {"protocol": 1, "bits": 24, "value": "1" + "0" * 20, "pulse_us": 350},
        {"protocol": 1, "bits": 24, "value": 4096, "pulse_us": 350},
        {"protocol": 1, "bits": 24, "value": "zz", "pulse_us": 350},
        {"protocol": 1, "bits": 24, "value": "000000", "pulse_us": None},
        {"protocol": None, "bits": 24, "value": "1", "pulse_us": 350},
        {"protocol": 1, "value": "1", "pulse_us": 350},
        {"protocol": 1, "bits": 24, "pulse_us": 350},
        {"bits": 24, "value": "1"},
        {"protocol": 1, "bits": "24", "value": "abc", "pulse_us": "350", "simulated": 0},
        {"protocol": 1, "bits": 24, "value": "1", "pulse_us": 350.5, "simulated": []},
        {"protocol": [1], "bits": 24, "value": "1", "pulse_us": 350},
        {},
    ]
    istantanee = [{"timings": [350, -1050, "5", 2.5, True]}, {"timings": []}, {}, {"timings": None}, {"timings": "12"}, {"timings": [None]}, {"timings": ["x"]}, {"timings": {"7": 1}}]
    dispositivi = [{"id": "a1", "name": "presa del salotto"}, {"id": "b2", "name": "cancello <casa> & \"garage\""}, {"id": "a1", "name": "doppione"}, {"id": "c3", "name": ""}, {"id": "d4"}]
    voci = [{"nome": f"voce {i} <{i}>", "testo": testi[i], "meta": {"device": c2.scegli(["", "a1", "b2", "c3", "zz", "d4"])} if c2.prob(0.9) else {}, "simulato": c2.prob(0.3), "sha256": f"{c2.bit64():016x}{c2.bit64():016x}"} for i in range(40)]
    budget = [{"budget_used_ms": 1234}, {"budget_used_ms": 0}, {}, {"budget_used_ms": 250}, {"budget_used_ms": 2**70}, {"budget_used_ms": 99.95}, {"budget_used_ms": True}, {"budget_used_ms": "5"}, {"budget_used_ms": None}, {"budget_used_ms": -50}]
    codici = [subghz.RcCode(*a) for a in ([1, 24, 0, 350], [2, 12, 0, 650], [13, 24, 0, 350], [1, 0, 0, 350], [8, 32, 0, 5000], [1, 1, 0, 50], [1, 24, 0, 10**15])]
    nomi_sub = ["", "  ", "nuovo.sub", "presa", " presa.sub ", "presa.SUB", "\u3000x\u3000", ".sub"]

    scrivi(
        "subghz.json",
        {
            "costanti": {
                "KEY_TYPE": subghz.KEY_TYPE, "RAW_TYPE": subghz.RAW_TYPE, "RAW_MAX_PER_LINE": subghz.RAW_MAX_PER_LINE, "RAW_MAX_TIMINGS": subghz.RAW_MAX_TIMINGS,
                "BAND_MIN": subghz.BAND_MIN, "BAND_MAX": subghz.BAND_MAX, "RC_PROTOCOLS": subghz.RC_PROTOCOLS, "RC_MAX_BITS": subghz.RC_MAX_BITS,
                "DEFAULT_PRESET": subghz.DEFAULT_PRESET, "RC_TABLE": enc(subghz.RC_TABLE), "predefinito": enc(subghz.SubFile()),
            },
            "raw_valido": [caso(t, subghz.raw_valid, t) for t in rawv],
            "leggi": [caso(t, subghz.parse, t) for t in testi],
            "scrivi": [caso(f, scrivi_sub, f) for f in file_in],
            "trasmissibile": [caso(f, trasmissibile, f) for f in file_in[-110:]],
            "analizza": [caso(t, analisi, t) for t in serie_tempi],
            "ipotesi": [caso(s, lambda s: subghz.guess_protocol(subghz.PulseStats(count=s["count"], ratio=s["ratio"], short_us=s["short_us"])), s) for s in stat],
            "tempo_aria": [caso(a, tempo_aria, *a) for a in aria],
            "codice_in_sub": [caso(a, subghz.code_to_sub, *a) for a in a_sub],
            "ui_riga_codice": [caso([e, s], ui_riga_codice, e, s) for e in eventi for s in (False, True)],
            "ui_sub_evento": [caso(e, ui_sub_evento, e) for e in eventi],
            "ui_nome_codice": [caso(e, ui_nome_codice, e) for e in eventi],
            "ui_salva_codice": [caso([e, s, "presa", dev], ui_salva_codice, e, s, "presa", dev) for e in eventi for s, dev in ((False, None), (True, "a1"), (0, ""))],
            "ui_istantanea": [caso(d, ui_istantanea, d) for d in istantanee],
            "ui_raw_da_salvare": [caso(t, ui_raw_da_salvare, t) for t in rawv[:80] + [[-1, -2, 350, -350], [-1, -2]]],
            "ui_analisi": [caso(t, ui_analisi, t) for t in serie_tempi[:120]],
            "ui_didascalia": [caso(t, ui_didascalia, t) for t in serie_tempi[:80] + [[0], [0, 0], [2**70, -1]]],
            "ui_archivio": [caso(t, ui_archivio, t) for t in testi_brevi[:160]],
            "ui_codice_fisso": [caso(enc(k), ui_codice_fisso, k) for k in codici],
            "ui_nome_dispositivo": [caso([dispositivi, i], ui_nome_dispositivo, dispositivi, i) for i in ("a1", "b2", "c3", "zz", "")],
            "ui_verifica": [caso(t, ui_verifica, t) for t in testi_brevi[:160]],
            "ui_percorso": [caso(i, ui_percorso, i) for i in ("0123456789abcdef", "abc", "", "😀😀😀😀😀😀😀😀😀😀")],
            "ui_conferma": [caso(["presa", m, dispositivi], ui_conferma, "presa", m, dispositivi) for m in ({}, {"device": ""}, {"device": "a1"}, {"device": "b2"}, {"device": "zz"}, {"device": "c3"})],
            "ui_trasmesso": [caso([d, s], ui_trasmesso, d, s) for d in budget for s in (False, True)],
            "ui_dettagli": [caso(t, ui_dettagli, t) for t in testi_brevi[:160]],
            "ui_report": [caso([voci[:k], dispositivi, "22/11/2026 18:30"], ui_report, voci[:k], dispositivi, "22/11/2026 18:30") for k in (0, 1, 40)],
            "ui_stato_editor": [caso(t, ui_stato_editor, t) for t in testi_brevi[:160]],
            "ui_testo_editor": subghz.serialize(subghz.SubFile(code=subghz.RcCode(1, 24, 0x000001, 350))),
            "ui_nome_file_sub": [caso(n, ui_nome_file_sub, n) for n in nomi_sub],
            "ui_salva_editor": [caso([t, n], ui_salva_editor, t, n) for t in testi_brevi[:60] for n in nomi_sub[:2]],
            "bande": BANDE,
            "nota_bande": NOTA_BANDE,
        },
    )


# ---------------- budget_radio.json ----------------


def genera_budget() -> None:
    griglia = []
    for p in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13):
        for b in (0, 1, 24, 32, 33):
            for pulse in (50, 351, 650, 5000):
                for rep in (1, 4, 20):
                    griglia.append([p, b, pulse, rep])
    griglia += [[1, 24, 0, 4], [1, 24, -350, 4], [1, 24, 350, 0], [1, 24, 350, -1], [1, 1, 1, 1], [8, 32, 10**15, 10**6], [8, 32, 2**80, 3], [1, 24, 350.5, 4], [1, 24, 350, 0.001], [1, 24, 1e-300, 1]]
    scrivi(
        "budget_radio.json",
        {
            "limite_ms": RF_BUDGET_LIMIT_MS,
            "manifest": radio_budget.MANIFEST,
            "stima": [caso(a, radio_budget.estimate, *a) for a in griglia],
            "testo": [caso(a, testo_stima, *a) for a in griglia[::3] + griglia[-10:]],
        },
    )


if __name__ == "__main__":
    genera_unicode()
    genera_flipper()
    genera_ir()
    genera_subghz()
    genera_budget()
    print("casi scritti in", USCITA)
