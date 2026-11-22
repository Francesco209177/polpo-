#!/usr/bin/env python3
"""Genera i casi di prova «nfc_vari» per la copia JavaScript di Polpo Studio.

Esegue il codice Python dello Studio (protocolli NDEF, Type 2, 125 kHz, 1-Wire, DuckyScript, elettronica,
convertitore, CRC, costruttore NDEF e gli aiuti puri delle pagine NFC, RFID, iButton, USB e GPIO) su molti
ingressi (normali, al limite, sbagliati; quelli casuali con semi fissi) e scrive i risultati in
site/tests/studio/casi/nfc_vari/*.json. Le prove in site/tests/studio/nfc_vari/ controllano che i moduli
JavaScript diano esattamente gli stessi risultati.

Uso, dalla radice del repository, con l'ambiente Python dello Studio:
    python site/tests/studio/casi/genera_nfc_vari.py
Rigenerare deve dare file identici byte per byte.

Convenzioni nei file: i byte sono testi esadecimali minuscoli; un errore è {"errore": {"tipo", "msg"}} con il nome
della classe Python (moduli non predefiniti con il prefisso, es. "binascii.Error") e il messaggio; i numeri
decimali non finiti sono {"float": "inf"}; i testi con surrogati isolati sono {"cp": [codici]}.
"""

from __future__ import annotations

import base64
import binascii
import dataclasses
import hashlib
import html
import json
import math
import os
import random
import struct
import sys
import tempfile
import time
import types
import zlib
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from polpo_studio.core import i18n  # noqa: E402

i18n.set_language("it")

from PySide6.QtWidgets import QApplication, QCheckBox, QComboBox, QFormLayout, QLineEdit, QPlainTextEdit  # noqa: E402

from polpo_studio.app.tools import common, gpio_tools, ibutton_tools, nfc_tools, rfid_tools, usb_tools  # noqa: E402
from polpo_studio.apps import converter, crc_tool, ndef_app  # noqa: E402
from polpo_studio.protocols import ducky, electronics, ndef, onewire, rfid125, type2  # noqa: E402

USCITA = Path(__file__).resolve().parent / "nfc_vari"

# Ora fissa per tutto ciò che scrive data e ora (time.strftime): 22/11/2026 09:05:07, ora locale.
ORA_FISSA = time.struct_time((2026, 11, 22, 9, 5, 7, 6, 326, 0))


class TempoFisso:
    @staticmethod
    def strftime(fmt: str) -> str:
        return time.strftime(fmt, ORA_FISSA)

    monotonic = staticmethod(time.monotonic)


for _m in (nfc_tools, rfid_tools, ibutton_tools):
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
    t = type(e)
    return t.__name__ if t.__module__ == "builtins" else f"{t.__module__}.{t.__name__}"


def esito(f, *a, conv=J, **k):
    try:
        r = f(*a, **k)
    except Exception as e:  # noqa: BLE001 - si registra qualunque eccezione, con tipo e messaggio
        return {"errore": {"tipo": nome_eccezione(e), "msg": str(e)}}
    return {"ok": conv(r)}


def scrivi(nome: str, dati: dict) -> None:
    USCITA.mkdir(parents=True, exist_ok=True)
    testo = json.dumps(dati, sort_keys=True, indent=1, ensure_ascii=False) + "\n"
    (USCITA / f"{nome}.json").write_text(testo, encoding="utf-8", newline="\n")
    print(f"{nome}.json: {sum(len(v) for v in dati.values() if isinstance(v, list))} casi")


def testo_casuale(rnd: random.Random, alfabeto: str, massimo: int, minimo: int = 0) -> str:
    return "".join(rnd.choice(alfabeto) for _ in range(rnd.randint(minimo, massimo)))


def byte_casuali(rnd: random.Random, n: int) -> bytes:
    return bytes(rnd.randrange(256) for _ in range(n))


def float_casuali(rnd: random.Random, n: int) -> list[float]:
    """Decimali vari: a metà tra due valori, con poche cifre, su molti ordini di grandezza, negativi."""
    out = []
    for _ in range(n):
        tipo = rnd.randrange(5)
        if tipo == 0:
            x = rnd.randint(-4000, 4000) / rnd.choice([2, 4, 8, 16, 32, 1024])
        elif tipo == 1:
            x = round(rnd.uniform(-1000, 1000), rnd.randint(0, 6))
        elif tipo == 2:
            x = 10 ** rnd.uniform(-12, 18)
        elif tipo == 3:
            x = rnd.randint(1, 99999) * 10.0 ** rnd.randint(-8, 8)
        else:
            x = struct.unpack("<d", struct.pack("<Q", rnd.getrandbits(64)))[0]
            if not math.isfinite(x):
                x = 1.0
        out.append(-x if rnd.random() < 0.3 else x)
    return out


# ======================================================================================================
# Regole di Python usate dai moduli (convertitore.js)
# ======================================================================================================


def casi_py() -> dict:
    rnd = random.Random(1)
    out: dict[str, list] = {}

    interi = [
        "0", "1", "-1", "+5", " 7 ", "\t8\n", "1_000", "1__0", "_1", "1_", "0x10", "0X1f", "0x_1f", "0x__1", "0x", "00", "-0",
        "٣", "١٢", "²", "1²", "１２３", "\x1c5", "5\x1c", "\x855", "\xa05　", "\x0b5\x0c", "", " ", "abc", "ff", "FF",
        "0b101", "0B11", "0b_1", "0o17", "1e5", "1.0", "--1", "+-1", "- 1", "1 2", "5\x00", "x" * 300, "9" * 4300, "9" * 4301,
        "1_" * 4300 + "1", "𝟏𝟐", "z", "Z", "0b", "+0x1", "-0x1", "0x-1", "​1", "1﻿", "٣_٣", "🐙", "'", '"', "a'b\"c",
    ]  # fmt: skip
    alfabeto = "0123456789abcdefABCDEFxXbBoO_+- \t٣²　"
    interi += [testo_casuale(rnd, alfabeto, 6) for _ in range(300)]
    out["int"] = [{"s": J(s), "r": {str(b): esito(lambda s=s, b=b: hex(int(s, b))) for b in (10, 16, 2, 8, 36)}} for s in interi]
    for v in [None, True, False, 3.7, -3.7, 1e300, math.inf, -math.inf, math.nan, [1], {"a": 1}, 0, -12]:
        out["int"].append({"v": J(v), "r": esito(lambda v=v: hex(int(v)))})

    decimali = [
        "1", "1.5", ".5", "5.", ".", "-.5e-3", "1e5", "1E+05", "1e", "e5", "inf", "-inf", "+inf", "Infinity", "INF", "infinit",
        "nan", "-nan", "NaN", "nan(1)", "1_000.5", "1__0", "_1", "1_", "1_e5", "1e1_0", "1e_10", "1._5", "1_.5", "0x10",
        " 3.25 ", "\xa03　", "٣.٥", "²", "1,5", "4,7", "", " ", "abc", "1e400", "-1e400", "1e-400", "4.7k", "5\x00",
        "\x1c5", "+", "-", "1.2.3", "0.1", "00.5", "123456789012345678901234567890", "2.5e-324", "-0", "-0.0", "4700",
        "1e-5", "x" * 250, "\t\n1\r", "+.e1", "1e+", ".e1",
    ]  # fmt: skip
    decimali += [testo_casuale(rnd, "0123456789.eE+-_ inf", 7) for _ in range(250)]
    out["float"] = [{"s": J(s), "r": esito(float, s)} for s in decimali]

    spazi = "ab \t\n\x0b\x0c\r\x1c\x1f\x85\xa0   　​﻿x"
    testi = ["", " ", "a", " a b ", "a  b  c", "\ta\n", "　x　"] + [testo_casuale(rnd, spazi, 10) for _ in range(250)]
    out["testo"] = [
        {"s": s, "strip": s.strip(), "split": s.split(), "split1": s.split(None, 1), "split2": s.split(None, 2), "isascii": s.isascii(), "len": len(s)}
        for s in testi
    ]
    cifre = "0123456789٣१²³¹⁴₅①⓪❶１𝟏𝟘a ½Ⅻ"
    out["isdigit"] = [{"s": s, "r": s.isdigit()} for s in ["", "0", "12", "²", "½", "Ⅻ", "١٢٣", "1a"] + [testo_casuale(rnd, cifre, 4) for _ in range(200)]]

    esad = ["", "00", "0a", "0A", "abc", "a b", "ab c", "ab  cd", " ab", "ab ", "a", "zz", "ab\tcd", "ab\x0bcd", "ée", "ab\xa0cd", "abcdé", "zzé", "a\x00", "\n\n"]
    esad += [testo_casuale(rnd, "0123456789abcdefABCDEFgG \t\n\x0bé", 9) for _ in range(250)]
    out["fromhex"] = [{"s": s, "r": esito(bytes.fromhex, s)} for s in esad]

    valori = [
        0.0, -0.0, 0.5, 1.5, 2.5, -2.5, 0.125, 0.375, 1e-5, 1e-4, 9.99995e-5, 0.0001, 123456.5, 999999.5, 999.5, 1e15, 1e16,
        1e21, 1.7976931348623157e308, 5e-324, 2.675, 0.045, 1.005, 4.35, 0.05, 0.15, 0.25, 0.35, 99.95, 9.995, 1234567.0,
        math.inf, -math.inf, math.nan, 4700.0, 4.7, 0.1, 1 / 3, 2 / 3, 100.0, 1e6, 1e-7,
    ]  # fmt: skip
    valori += float_casuali(rnd, 400)
    specifiche = ["g", ".3g", ".1f", ".0f", ".3f", ".2e", ".6g", ".1g", ".0g", ".10g", ".17g", ".2f"]
    out["format"] = [{"x": J(x), "r": {s: format(x, s) for s in specifiche}} for x in valori]
    out["round"] = [{"x": J(x), "r": [J(round(x, n)) for n in (0, 1, 2, 4)]} for x in valori]
    out["round_int"] = [{"x": J(x), "r": esito(lambda x=x: str(round(x)))} for x in valori]
    out["floor"] = [{"x": J(x), "r": esito(lambda x=x: str(math.floor(x)))} for x in valori]

    reprs = ["", "a", "'", '"', "'\"", "a'b", 'a"b', "\\", "\t\n\r", "\x00\x01\x1f\x7f", "\x80\x9f\xa0\xad", "​  ", "",
             "͸", "🐙", "\U000e0001", "é́", "\x85", "　", " ", "ok ✓", "﻿", "\U0010ffff"]  # fmt: skip
    reprs += [testo_casuale(rnd, "a'\"\\\t\n\x00\x7f\xa0\xad​😀é ", 6) for _ in range(150)]
    out["repr"] = [{"s": s, "r": repr(s)} for s in reprs]
    valori_json = [None, True, False, 0, -5, 1.5, 0.1, 1e-5, 1e-7, 123.456, -0.5, "x", [1, "a", None], {"a": 1, "b": [True]}, [], {}, 1.5e-10, 0.0001,
                   0.00001234, ["it's"], {"k": "v\n"}, 12345678.9, 1234567890123.25]  # fmt: skip
    out["str"] = [{"v": v, "r": str(v)} for v in valori_json]

    b64 = ["", "=", "==", "A", "A=", "A==", "AB", "AB=", "AB==", "AB===", "AB==A", "AB=A=", "ABC", "ABC=", "ABC==", "ABCD", "ABCD=",
           "ABCD==", "A===", "AB=C", "ABCDE", "ABCDE=", "ABCDEF", "AB\n", "AB C", "ÀB", "AB=\n", "ABCDEFG=", "AB==AB==", "A=B=",
           "QUJD", "QQ", "QR==", "QUI=", "QUJ=", "UG9scG8=", "UG9scG8", "UG9scG8==", "A=\n", "AB== ", "-_", "AB+/"]  # fmt: skip
    b64 += [testo_casuale(rnd, "AB+/=\n Q9a", 10) for _ in range(400)]
    out["b64decode"] = [{"s": s, "r": esito(base64.b64decode, s, validate=True)} for s in b64]
    out["b64encode"] = [{"b": b.hex(), "r": base64.b64encode(b).decode()} for b in (byte_casuali(rnd, rnd.randint(0, 20)) for _ in range(100))]

    def byte_utf8(n: int) -> bytes:
        pool = [lambda: rnd.randrange(0x80), lambda: rnd.randrange(0x80, 0xC0), lambda: rnd.choice([0xC0, 0xC1]), lambda: rnd.randrange(0xC2, 0xE0),
                lambda: 0xE0, lambda: rnd.randrange(0xE1, 0xED), lambda: 0xED, lambda: rnd.choice([0xEE, 0xEF]), lambda: 0xF0,
                lambda: rnd.randrange(0xF1, 0xF4), lambda: 0xF4, lambda: rnd.randrange(0xF5, 0x100)]  # fmt: skip
        b = bytes(rnd.choice(pool)() for _ in range(n))
        return (b"\xef\xbb\xbf" + b) if rnd.random() < 0.1 else b

    out["utf8"] = [{"b": b.hex(), "r": b.decode("utf-8", "replace")} for b in (byte_utf8(rnd.randint(0, 12)) for _ in range(400))]

    def byte_utf16() -> bytes:
        unita = [rnd.choice([rnd.randrange(0x80), rnd.randrange(0xD800, 0xDC00), rnd.randrange(0xDC00, 0xE000), 0xFEFF, 0xFFFE, rnd.randrange(0x10000)])
                 for _ in range(rnd.randint(0, 6))]  # fmt: skip
        be = rnd.random() < 0.3
        b = b"".join(u.to_bytes(2, "big" if be else "little") for u in unita)
        if rnd.random() < 0.4:
            b = (b"\xfe\xff" if be else b"\xff\xfe") + b
        if rnd.random() < 0.2:
            b += bytes([rnd.randrange(256)])
        return b

    out["utf16"] = [{"b": b.hex(), "r": b.decode("utf-16", "replace")} for b in (byte_utf16() for _ in range(400))]
    out["ascii"] = [{"b": b.hex(), "r": b.decode("ascii", "replace")} for b in (byte_casuali(rnd, rnd.randint(0, 8)) for _ in range(100))]
    out["ascii_enc"] = [{"s": s, "r": s.encode("ascii", "replace").hex()} for s in ["", "it", "ab€", "🐙x"] + [testo_casuale(rnd, "aZ é€🐙", 5) for _ in range(60)]]
    surrogati = [[0x61, 0xD800], [0xD800], [0xDC00, 0xD800, 0x62], [0x62, 0xDC00, 0x63, 0xD800, 0xD801], [0x1F419, 0xDFFF], [0x61, 0x62]]
    out["utf8_enc"] = [{"s": J("".join(map(chr, c))), "r": esito(lambda c=c: "".join(map(chr, c)).encode("utf-8"))} for c in surrogati]
    out["utf8_enc"] += [{"s": s, "r": esito(s.encode, "utf-8")} for s in ["", "a", "€", "🐙", "àèì"]]
    out["html"] = [{"s": s, "r": html.escape(s)} for s in ["", "<a href='x'>&\"</a>"] + [testo_casuale(rnd, "<>&\"'a ", 8) for _ in range(40)]]
    out["to_bytes"] = []
    for v, n, o in [(0, 1, "big"), (255, 1, "big"), (256, 1, "big"), (-1, 2, "big"), (0x123456, 6, "little"), (2**48, 6, "little"), (2**40 - 1, 5, "big")]:
        out["to_bytes"].append({"v": v, "n": n, "ordine": o, "r": esito(v.to_bytes, n, o)})
    return out


# ======================================================================================================
# NDEF e Type 2
# ======================================================================================================

TESTI = ["", "a", "Ciao!", "perché è così?", "🐙 polpo", "433,92 MHz", "x" * 300, "€" * 90, "Il polpo ha otto braccia"]


def testo_unicode(rnd: random.Random, massimo: int = 20) -> str:
    return testo_casuale(rnd, "abcXYZ019 .:/?=&-_àèé€🐙 ​'\"<>", massimo)


def payload_testo(rnd: random.Random) -> bytes:
    lingua = rnd.choice([b"it", b"en", b"", b"en-US", b"\xc3\xa9", b"x" * 63])
    utf16 = rnd.random() < 0.3
    t = testo_unicode(rnd)
    if utf16:
        corpo = t.encode(rnd.choice(["utf-16", "utf-16-le", "utf-16-be"]))
        if rnd.random() < 0.2:
            corpo += b"\x00"
    else:
        corpo = t.encode("utf-8") if rnd.random() < 0.8 else byte_casuali(rnd, rnd.randint(0, 8))
    ll = len(lingua) if rnd.random() < 0.85 else rnd.randrange(64)
    return bytes([(0x80 if utf16 else 0) | ll | (0x40 if rnd.random() < 0.1 else 0)]) + lingua + corpo


def record_casuale(rnd: random.Random, mb: bool, me: bool) -> bytes:
    genere = rnd.randrange(4)
    if genere == 0:
        tnf, tipo = 1, b"U"
        payload = bytes([rnd.randrange(40)]) + (testo_unicode(rnd).encode() if rnd.random() < 0.8 else byte_casuali(rnd, rnd.randint(0, 6)))
    elif genere == 1:
        tnf, tipo = 1, b"T"
        payload = payload_testo(rnd)
    elif genere == 2:
        tnf, tipo = rnd.choice([(1, b"U"), (1, b"T"), (1, b""), (2, b"text/plain"), (1, b"Sp")])
        payload = b"" if rnd.random() < 0.3 else byte_casuali(rnd, rnd.randint(1, 10))
    else:
        tnf, tipo = rnd.choice([0, 2, 3, 4, 5, 6, 7]), rnd.choice([b"", b"U", b"T", b"abc"])
        payload = byte_casuali(rnd, rnd.randint(0, 6))
    if rnd.random() < 0.05:
        payload += byte_casuali(rnd, 256)
    corto = len(payload) <= 255 and rnd.random() < 0.85
    ident = byte_casuali(rnd, rnd.randint(0, 3)) if rnd.random() < 0.2 else None
    testa = (0x80 if mb else 0) | (0x40 if me else 0) | (0x10 if corto else 0) | (0x08 if ident is not None else 0) | tnf
    if rnd.random() < 0.03:
        testa |= 0x20
    out = bytes([testa, len(tipo)]) + (bytes([len(payload)]) if corto else len(payload).to_bytes(4, "big"))
    if ident is not None:
        out += bytes([len(ident)])
    return out + tipo + (ident or b"") + payload


def messaggio_casuale(rnd: random.Random) -> bytes:
    n = rnd.randint(1, 3)
    fine = n - 1 if rnd.random() < 0.85 else rnd.choice([-1, 0])
    m = b"".join(record_casuale(rnd, i == 0, i == fine) for i in range(n))
    return m + (byte_casuali(rnd, 3) if rnd.random() < 0.1 else b"")


def tlv_casuale(rnd: random.Random) -> bytes:
    out = b""
    for _ in range(rnd.randint(0, 4)):
        t = rnd.choice([0x00, 0x01, 0x02, 0xFD, 0x03, 0x03, 0xFE, 0x42])
        if t in (0x00, 0xFE):
            out += bytes([t])
            continue
        corpo = messaggio_casuale(rnd) if t == 0x03 else byte_casuali(rnd, rnd.randint(0, 5))
        if rnd.random() < 0.1:
            corpo += byte_casuali(rnd, 260)
        n = len(corpo)
        out += bytes([t]) + (bytes([n]) if n < 0xFF and rnd.random() < 0.9 else bytes([0xFF, n >> 8, n & 0xFF])) + corpo
    if rnd.random() < 0.3:
        out = out[: rnd.randint(0, len(out))]
    return out


def record_json(r: ndef.Record) -> dict:
    return J(r)


def casi_ndef() -> dict:
    rnd = random.Random(2)
    out: dict[str, list] = {}
    uri = [p + s for p in ndef.URI_PREFIXES for s in ("", "example.org", "x/y?z=1")]
    uri += ["https://example.org", "HTTPS://EXAMPLE.ORG", "http://", "urn:epc:id:x", "urn:nfc:wkt", "tel:+39 333", "ftp://ftp.x", "mailto:a@b.it", "x" * 260]
    uri += [testo_unicode(rnd, 30) for _ in range(150)]
    uri += [rnd.choice(ndef.URI_PREFIXES) + testo_unicode(rnd, 10) for _ in range(100)]
    uri += ["".join(map(chr, c)) for c in ([0x68, 0xD800], [0x68, 0x74, 0x74, 0x70, 0x3A, 0x2F, 0x2F, 0xDC00, 0xD800])]
    out["uri_message"] = [{"uri": J(u), "r": esito(ndef.uri_message, u)} for u in uri]
    testi = [(t, lingua) for t in TESTI for lingua in ("it", "en-US", "", "é", "x" * 70, "😀")]
    testi += [(testo_unicode(rnd, 30), rnd.choice(["it", "en", "de-DE", "€"])) for _ in range(120)]
    testi += [("".join(map(chr, [0x61, 0xDC00])), "it")]
    out["text_message"] = [{"testo": J(t), "lingua": lingua, "r": esito(ndef.text_message, t, lingua)} for t, lingua in testi]
    out["wrap_tlv"] = [{"m": bytes(i & 0xFF for i in range(n)).hex(), "r": ndef.wrap_tlv(bytes(i & 0xFF for i in range(n))).hex()} for n in (0, 1, 2, 100, 253, 254, 255, 256, 300, 1000)]
    tlv = [b"", b"\x00", b"\xfe", b"\x03", b"\x03\x00", b"\x03\x01", b"\x03\x01\xd0", b"\x03\xff", b"\x03\xff\x00", b"\x03\xff\x00\x01\x55", b"\x01\x03\xa0\x0c\x34\x03\x00\xfe",
           b"\x00\x00\x03\x02\xd0\x00\xfe", b"\x02\x05\x00", b"\xfd\x00\x03\x01\x55", b"\x42\x01\x00\x03\x01\x99", b"\x03\x11\xd1\x01\x0d\x55\x04example.org\xfe"]  # fmt: skip
    tlv += [tlv_casuale(rnd) for _ in range(300)]
    out["find_in_tlv"] = [{"mem": m.hex(), "r": J(ndef.find_in_tlv(m))} for m in tlv]
    messaggi = [b"", b"\xd1", b"\xd1\x01", b"\xd1\x01\x01", b"\xd1\x01\x01U", b"\xd1\x01\x00U", b"\xd1\x01\x01U\x04", b"\xc1\x01\x00\x00\x00\x01U\x00", b"\xc1\x01\x00\x00",
                b"\xf1\x01\x01U\x00", b"\xd9\x01\x01", b"\xd9\x01\x01\x01U\x00\x04", b"\x91\x01\x01U\x04\x51\x01\x01T\x00", b"\x11\x01\x01U\x04\x11\x01\x01U\x05",
                b"\xd1\x01\x03T\x02it", b"\xd1\x01\x04T\x02it", b"\xd1\x01\x05T\x82it\xff", b"\xd1\x01\x07T\x82it\xff\xfeA\x00", b"\xd1\x01\x01T\x3f",
                b"\xd1\x01\x02U\x24", b"\xd1\x01\x02U\xff", b"\xd0\x00\x00", b"\xd5\x00\x00"]  # fmt: skip
    casuali = [messaggio_casuale(rnd) for _ in range(500)]
    messaggi += casuali
    for m in casuali[:40]:
        messaggi += [m[:k] for k in range(1, len(m))][:30]
    messaggi += [byte_casuali(rnd, rnd.randint(1, 12)) for _ in range(200)]
    out["parse"] = [{"m": m.hex(), "r": esito(ndef.parse, m)} for m in messaggi]
    return out


def memoria_tag(rnd: random.Random, *, pagine: int, uid_ok: bool = True, blocco: bytes = b"\x00\x00", cc: bytes | None = None, tlv: bytes = b"") -> bytes:
    u = bytes([0x04]) + byte_casuali(rnd, 6)
    bcc0 = 0x88 ^ u[0] ^ u[1] ^ u[2]
    bcc1 = u[3] ^ u[4] ^ u[5] ^ u[6]
    if not uid_ok:
        bcc1 ^= 1 << rnd.randrange(8)
    mem = u[:3] + bytes([bcc0]) + u[3:7] + bytes([bcc1, 0x48]) + blocco + (cc if cc is not None else bytes([0xE1, 0x10, 0x3E, 0x00]))
    mem += tlv
    mem = mem[: pagine * 4]
    return mem + bytes(pagine * 4 - len(mem))


def carte_type2() -> list[dict]:
    rnd = random.Random(3)
    carte: list[dict] = []
    modelli = ["NTAG213", "NTAG215", "NTAG216", "MIFARE Ultralight", "NTAG210", "MIFARE Ultralight EV1 (MF0UL11)", "", "Sconosciuto"]
    esempio = ndef.wrap_tlv(ndef.uri_message("https://example.org"))
    for k in range(300):
        tlv = rnd.choice(
            [esempio, esempio, ndef.wrap_tlv(ndef.text_message(testo_unicode(rnd), "it")), ndef.wrap_tlv(messaggio_casuale(rnd)), ndef.wrap_tlv(messaggio_casuale(rnd)),
             b"\x01\x03\xa0\x0c\x34" + esempio, b"\x00\x00" + esempio, tlv_casuale(rnd), b"\x03\x00\xfe", b"", b"\x03\x05\xd1\x01\x09U", b"\x03\x03\xf1\x01\x00"]
        )  # fmt: skip
        cc = rnd.choice([None, None, None, bytes([0xE1, 0x10, 0x12, 0x00]), bytes([0xE1, 0x11, 0x6D, 0x0F]), bytes([0x00, 0x00, 0x00, 0x00]), byte_casuali(rnd, 4)])
        blocco = rnd.choice([b"\x00\x00", b"\x00\x00", b"\x00\x00", b"\xff\xff", b"\x08\x00"])
        mem = memoria_tag(rnd, pagine=rnd.choice([4, 5, 16, 30, 45, 45, 45]), uid_ok=rnd.random() < 0.85, blocco=blocco, cc=cc, tlv=tlv)
        pagine = mem.hex().upper() if rnd.random() < 0.7 else (mem.hex() if rnd.random() < 0.5 else mem.hex(" "))
        if rnd.random() < 0.05:
            pagine = pagine[:-1]
        if rnd.random() < 0.04:
            pagine = pagine[: rnd.randint(0, 30)]
        c: dict = {"present": True, "sak": 0, "atqa": 0x44, "pages": pagine, "model": rnd.choice(modelli)}
        if rnd.random() < 0.5:
            c["uid"] = mem[:3].hex().upper() + mem[4:8].hex().upper()
        if rnd.random() < 0.1:
            c["family"] = rnd.choice(["Famiglia data dal Polpo", "", None])
        if rnd.random() < 0.1:
            c["simulated"] = True
        if rnd.random() < 0.08:
            c["read_error"] = rnd.choice([True, "timeout", "", 0])
        if rnd.random() < 0.1:
            c["version"] = "0004040201000F03"
        if rnd.random() < 0.05:
            c["atr"] = "3B8F8001804F0CA0000003060300030000000068"
        if k % 23 == 0:
            del c["pages"]
        carte.append(c)
    for sak, atqa in [(0x08, 0x04), (0x18, 0x02), (0x20, 0x0344), (0x20, 0x0004), (0x28, 0x04), (0x09, 0x04), (0x10, 0x44), (0x11, 0x44), (0x38, 0x04), (0x99, 0)]:
        carte.append({"present": True, "uid": "A1B2C3D4", "sak": sak, "atqa": atqa, "model": ""})
    carte += [
        {"present": False},
        {"present": True},
        {},
        {"sak": "0", "atqa": "68", "pages": "00"},
        {"sak": True, "uid": "X"},
        {"sak": 0.0, "atqa": 68.9, "pages": 1234},
        {"sak": None},
        {"sak": "abc"},
        {"sak": 0, "atqa": None, "family": "x"},
        {"sak": [0]},
        {"uid": None, "model": None, "pages": None},
        {"uid": 12345, "model": True, "sak": False, "pages": "zz"},
        {"present": 1, "sak": 0, "pages": "04A1B2" * 10, "read_error": None},
        {"present": "", "sak": 0},
        {"present": True, "sak": 0, "atqa": -1, "pages": "00" * 16},
        {"present": True, "sak": 0, "atqa": 0x10000, "pages": "0011 2233 4455 6677 8899 aabb ccdd eeff"},
    ]
    return carte


def analisi_json(a: type2.Analysis) -> dict:
    return J(a)


def casi_type2() -> dict:
    rnd = random.Random(4)
    out: dict[str, list] = {}
    versioni = [b"", b"\x00\x04\x04\x02\x01\x00\x0f", b"\x00\x04\x04\x02\x01\x00\x0f\x03", b"\x00\x04\x03\x01\x01\x00\x0b\x03"]
    for _ in range(150):
        v = bytearray(byte_casuali(rnd, 8))
        v[2] = rnd.choice([3, 4, 4, 5])
        v[6] = rnd.choice([0x0B, 0x0E, 0x0F, 0x11, 0x13, rnd.randrange(256)])
        versioni.append(bytes(v))
    out["model_from_version"] = [{"v": v.hex(), "r": J(type2.model_from_version(v))} for v in versioni]
    out["model_by_name"] = [{"n": n, "r": J(type2.model_by_name(n))} for n in [m.name for m in type2.MODELS.values()] + ["", "ntag213", "NTAG 213"]]
    out["card_family"] = [{"sak": s, "atqa": a, "r": type2.card_family(s, a)} for s in range(256) for a in (0x0344, 0x44)] + [
        {"sak": s, "atqa": a, "r": type2.card_family(s, a)} for s, a in [(-1, 0), (0x20, 0x344 + 65536), (1000, 0)]
    ]
    out["analyze"] = [{"card": c, "r": esito(type2.analyze, c)} for c in carte_type2()]
    return out


# ======================================================================================================
# 125 kHz, 1-Wire
# ======================================================================================================


def em_json(c: rfid125.Em4100 | None):
    if c is None:
        return None
    return {"version": c.version, "number": c.number, "value": c.value, "hex": c.hex, "decimal10": c.decimal10, "w26": list(c.w26), "w26_text": c.w26_text, "w26_bits": c.w26_bits}


def casi_rfid() -> dict:
    rnd = random.Random(5)
    out: dict[str, list] = {}
    codici = [
        "", " ", "0012345678", "4294967295", "4294967296", "9999999999", "00123456", "25565535", "25665535", "25565536", "123,4567", "255,65535", "256,1",
        "1,65536", " 12 , 345 ", "12,", ",12", "1,2,3", "a,1", "²,1", "1,²", "0A1B2C3D4E", "0a1b2c3d4e", "FFFFFFFFFF", "0x12345678", "0X12345678",
        "-123456789", "-1234567", "+1234567", "12_34_567", "1234_5678", "ABCDEFGH", "ABCDEF12", "abcdef12", "1234567890A", "123456789", "12345 67890",
        "1234\t567890", "　123456789　", "١٢٣٤٥٦٧٨٩٠", "١٢٣٤٥٦٧٨", "١٢٣,٤٥", "²²²²²²²²²²", "²²²²²²²²", "１２３４５６７８９０", "ⅠⅡ", "0x", "-0", "00000000",
        "0000000000", "FFFFFFFF", "0xFFFFFFFF", "- 1234567", "12345678 ", "\x1c0012345678", "0012345678\n", "𝟎𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖",
    ]  # fmt: skip
    for _ in range(200):
        tipo = rnd.randrange(5)
        if tipo == 0:
            codici.append(f"{rnd.randrange(10**10):010d}")
        elif tipo == 1:
            codici.append(f"{rnd.randrange(10**8):08d}")
        elif tipo == 2:
            codici.append(f"{rnd.randrange(300)},{rnd.randrange(70000)}")
        elif tipo == 3:
            codici.append(f"{rnd.randrange(16**10):010X}" if rnd.random() < 0.5 else f"{rnd.randrange(16**8):08x}")
        else:
            codici.append(testo_casuale(rnd, "0123456789aF,_ -x²٣", 11))
    out["parse_code"] = [{"t": t, "r": esito(rfid125.parse_code, t, conv=lambda r: [em_json(r[0]), r[1]])} for t in codici]
    coppie = [(0, 0), (255, 0xFFFFFFFF), (-2, 3703216247), (0, -19088743), (1, 2), (256, 0)] + [(rnd.randrange(256), rnd.randrange(2**32)) for _ in range(60)]
    out["em4100"] = [{"v": v, "n": n, "r": em_json(rfid125.Em4100(v, n)), "frame": esito(rfid125.rdm6300_frame, rfid125.Em4100(v, n))} for v, n in coppie]

    def trama(c: rfid125.Em4100) -> bytes:
        return rfid125.rdm6300_frame(c)

    sequenze = []
    for _ in range(120):
        pezzi = []
        for _ in range(rnd.randint(1, 4)):
            scelta = rnd.randrange(9)
            c = rfid125.Em4100(rnd.randrange(256), rnd.randrange(2**32))
            t = bytearray(trama(c))
            if scelta == 1:
                t[13] = 0x00
            elif scelta == 2:
                t[rnd.randrange(1, 13)] = ord(rnd.choice("0123456789ABCDEF"))
            elif scelta == 3:
                t[rnd.randrange(1, 13)] = rnd.choice([0x80, 0xFF, 0xC3])
            elif scelta == 4:
                t = bytearray(t.decode("ascii").lower().encode())
            elif scelta == 5:
                t = bytearray(b"\x02" + b"  " + t[3:13] + b"\x03")
            elif scelta == 6:
                t = bytearray(rnd.choice([b"\x02          00\x03", b"\x0200        00\x03", b"\x020102030405 1\x03", b"\x020102030405+1\x03", b"\x020102030405-1\x03", b"\x020102030405_1\x03"]))
            elif scelta == 7:
                t = bytearray(byte_casuali(rnd, rnd.randint(0, 6))) + t
            pezzi.append(bytes(t))
        dati = b"".join(pezzi) + (byte_casuali(rnd, rnd.randint(0, 3)) if rnd.random() < 0.3 else b"")
        tagli = sorted(rnd.sample(range(1, len(dati)), min(len(dati) - 1, rnd.randint(0, 3)))) if len(dati) > 1 else []
        sequenze.append([dati[a:b] for a, b in zip([0, *tagli], [*tagli, len(dati)])])
    out["rdm6300"] = []
    for seq in sequenze:
        p = rfid125.Rdm6300Parser()
        passi = []
        for blocco in seq:
            r = esito(p.feed, blocco, conv=lambda cs: [c.hex for c in cs])
            passi.append({"dati": blocco.hex(), "r": r, "scartate": p.bad_frames})
            if "errore" in r:
                break
        out["rdm6300"].append(passi)
    raffiche = []
    for _ in range(100):
        n = rnd.randint(0, 14)
        passo = rnd.choice([0.002, 0.01, 0.03, 0.05, 0.3])
        t0 = rnd.uniform(0, 1000)
        tempi, t = [], t0
        for _ in range(n):
            tempi.append(t)
            t += passo * rnd.uniform(0.5, 1.5)
        raffiche.append([(rnd.choice("0123456789AB,🐙"), x) for x in tempi])
    out["burst"] = []
    for chars in raffiche:
        b = rfid125.burst_from_times(chars)
        out["burst"].append({"chars": [[c, t] for c, t in chars], "text": b.text, "duration_ms": b.duration_ms, "max_gap_ms": b.max_gap_ms, "reader": b.looks_like_reader})
    return out


def rom_json(r: onewire.Rom | None):
    if r is None:
        return None
    return {"raw": r.raw.hex(), "family": r.family, "family_name": r.family_name, "serial": r.serial, "crc_ok": esito(lambda: r.crc_ok), "text": r.text}


def casi_onewire() -> dict:
    rnd = random.Random(6)
    out: dict[str, list] = {}
    out["crc8"] = [{"b": b.hex(), "r": onewire.crc8(b)} for b in [b"", b"123456789"] + [byte_casuali(rnd, rnd.randint(0, 20)) for _ in range(150)]]
    testi = ["", "0102030405060708", "01 02 03 04 05 06 07 08", "01-02-03-04-05-06-07-08", "01:02:03:04:05:06:07:08", "010203040506070", "01020304050607080",
             "0102030405060\n708", "010203040506\n\n07", "00            00", "0102030405060 7 8", "g102030405060708", "é102030405060708", "  0102030405060708  ",
             "\t01\t02\t03\t04\t05\t06\t07\t08\t", "0102030405060708　", "28FF4A1B2C3D4E5F", "01A2B3C4D5E6007F"]  # fmt: skip
    for _ in range(150):
        corpo = bytes([rnd.choice([0x01, 0x28, 0x10, 0x2D, 0x99, rnd.randrange(256)])]) + byte_casuali(rnd, 6)
        rom = corpo + bytes([onewire.crc8(corpo) if rnd.random() < 0.6 else rnd.randrange(256)])
        sep = rnd.choice(["", " ", "-", ":", " - ", "\t"])
        testi.append(sep.join(f"{b:02x}" if rnd.random() < 0.5 else f"{b:02X}" for b in rom))
    out["parse_rom"] = [{"t": t, "r": rom_json(onewire.parse_rom(t))} for t in testi]
    coppie = [(0x01, 0), (0x28, 2**48 - 1), (0, 1), (255, 0x123456789ABC), (256, 0), (-1, 0), (1, 2**48), (1, -1)] + [(rnd.randrange(256), rnd.randrange(2**48)) for _ in range(60)]
    out["make_rom"] = [{"f": f, "s": s, "r": esito(onewire.make_rom, f, s, conv=rom_json)} for f, s in coppie]
    return out


# ======================================================================================================
# DuckyScript
# ======================================================================================================

RIGHE_DUCKY = [
    "REM commento", "// nota", "DELAY 100", "DELAY 0", "DELAY 60000", "DELAY 60001", "DELAY -1", "DELAY abc", "DELAY", "DELAY ٣٠", "DELAY 9999999999",
    "DELAY 99999999999", "DEFAULT_DELAY 50", "DEFAULTDELAY 0", "DEFAULT_DELAY 10001", "DEFAULT_DELAY x", "STRING Ciao", "STRING ", "STRING  doppio spazio",
    "STRINGLN riga", "STRING €@#", "STRING àèìòù", "STRING £§°ç", "STRING 🐙", "STRING ~`", "STRING a\tb", "STRING {}[]", "STRING é", "ENTER", "GUI r",
    "CTRL ALT DEL", "CTRL-ALT-DELETE", "ctrl c", "SHIFT TAB", "ALTGR e", "F1", "F12", "F13", "F0", "F01", "f5", "F٣", "WINDOWS", "CTRL", "a", "A", "è",
    "@", "-", "--", "CTRL -", "CTRL x y", "ENTER ENTER", "REPEAT 3", "REPEAT 0", "REPEAT 501", "REPEAT", "REPEAT x", "PIPPO", "string minuscolo",
    "  STRING indentato  ", "\tDELAY 5", "STRING x\r", "UPARROW", "MENU", "GUI", "ALT F4", "CTRL SHIFT ESC", "COMMAND SPACE", "SHIFT", "SHIFT a b",
    "1", "0", " ", "", "STRING\tTab", "STRING　x", "Ä", "STRİNG x", "GUİ", "rem x", "€", "£", "CTRL £", "ALT-F4", "CTRL--", "-CTRL", "SHIFT-",
]  # fmt: skip


def azioni_json(s: ducky.Script) -> dict:
    return {
        "actions": [f"{a.type} {a.line} {a.modifiers} {a.keycode} {a.ms} {a.text}" for a in s.actions],
        "errors": [list(e) for e in s.errors],
        "line_count": s.line_count,
        "total_delay_ms": s.total_delay_ms,
        "total_chars": s.total_chars,
        "ok": s.ok,
        "seconds": ducky.estimate_seconds(s),
        "seconds_5": ducky.estimate_seconds(s, 5),
    }


def pezzi(*p: tuple[str, int]) -> list:
    """Un testo lungo scritto come pezzi ripetuti: [[testo, volte], ...] (nei file JSON resta corto)."""
    return [list(x) for x in p]


def da_pezzi(src) -> str:
    return src if isinstance(src, str) else "".join(t * n for t, n in src)


def script_ducky() -> list[tuple]:
    """(sorgente, layout); la sorgente è un testo oppure una lista di pezzi ripetuti."""
    rnd = random.Random(7)
    casi: list[tuple] = [(r, lay) for r in RIGHE_DUCKY for lay in ("IT", "US")]
    casi += [(usb_esempio(), "IT")]
    casi += [
        ("STRING ab\nREPEAT 500\nREPEAT 500\nREPEAT 500", "IT"),
        ("DEFAULT_DELAY 10\nSTRING a\nREPEAT 2\nDELAY 5\nREPEAT 2\nENTER", "US"),
        ("REPEAT 2", "IT"),
        ("REM x\nREPEAT 2", "IT"),
        (pezzi(("ENTER\n", 2001)), "IT"),
        (pezzi(("ENTER\n", 2000)), "IT"),
        (pezzi(("ENTER\n", 1999), ("ENTER", 1)), "IT"),
        (pezzi(("REM\n", 2002), ("PIPPO", 1)), "US"),
        (pezzi(("REM ", 1), ("x", 33000)), "IT"),
        (pezzi(("REM ", 1), ("x", 32768 - 4)), "IT"),
        (pezzi(("REM ", 1), ("x", 32768 - 3)), "IT"),
        (pezzi(("STRING ", 1), ("€", 10920)), "IT"),
        (pezzi(("STRING ", 1), ("€", 10921)), "IT"),
        (pezzi(("F", 1), ("0", 4299), ("1", 1)), "IT"),
        (pezzi(("F", 1), ("0", 4300), ("1", 1)), "IT"),
        ("F²", "IT"),
        ("CTRL F²", "US"),
        ("DELAY ²", "IT"),
        ("REPEAT ²", "IT"),
        ("STRING x\r\nENTER\r\n", "IT"),
        ("\n\n\n", "IT"),
        ("", "IT"),
        ("\n", "US"),
        ("STRING a", "DE"),
        ("STRING è", "it"),
        ("STRING è", "US"),
        (pezzi(("STRING ", 1), ("a", 1300)), "IT"),
        (pezzi(("STRING a\n", 1201)), "IT"),
        (pezzi(("DEFAULT_DELAY 1\n", 1), ("ENTER\n", 700)), "US"),
        ("".join(map(chr, [0x53, 0x54, 0xD800])), "IT"),
    ]
    for _ in range(400):
        righe = [rnd.choice(RIGHE_DUCKY) for _ in range(rnd.randint(1, 14))]
        casi.append(("\n".join(righe) + ("\n" if rnd.random() < 0.5 else ""), rnd.choice(["IT", "US", "IT", "XX"])))
    return casi


def usb_esempio() -> str:
    return "REM Apre il Blocco note e scrive un saluto (Windows)\nDELAY 500\nGUI r\nDELAY 300\nSTRING notepad\nENTER\nDELAY 700\nSTRINGLN Ciao dal Polpo!\n"


def casi_ducky() -> dict:
    out: dict[str, list] = {}
    out["parse"] = [{"src": J(src), "layout": lay, "r": esito(ducky.parse, da_pezzi(src), lay, conv=azioni_json)} for src, lay in script_ducky()]
    caratteri = [chr(c) for c in range(0x20, 0x7F)] + list("\n\t\ràèéìòùç£§°€¤ÄßÀ🐙\x00")
    out["layout_lookup"] = [{"l": lay, "c": c, "r": J(ducky.layout_lookup(lay, c))} for lay in ("IT", "US", "XX") for c in caratteri]
    return out


# ======================================================================================================
# Elettronica
# ======================================================================================================


def log_uniforme(rnd: random.Random, a: float, b: float) -> float:
    return 10 ** rnd.uniform(a, b)


def casi_elettronica() -> dict:
    rnd = random.Random(8)
    out: dict[str, list] = {}
    terne = [(None, None, None), (5.0, None, None), (5.0, 0.02, 220.0), (5.0, None, 0.0), (5.0, 0.0, None), (None, 0.0, 220.0), (0.0, None, -0.0), (-5.0, -0.01, None)]
    for _ in range(250):
        v = [round(log_uniforme(rnd, -3, 4), rnd.randint(0, 4)) * rnd.choice([1, 1, 1, -1]) for _ in range(3)]
        if rnd.random() < 0.1:
            v[rnd.randrange(3)] = 0.0
        v[rnd.randrange(3)] = None
        terne.append(tuple(v))
    out["ohm"] = [{"v": J(v), "i": J(i), "r": J(r), "out": esito(electronics.ohm, v=v, i=i, r=r)} for v, i, r in terne]
    terne = [(5.0, 10000.0, 20000.0), (5.0, 0.0, 0.0), (5.0, -1.0, 1.0), (3.3, 0.0, 1.0), (12.0, 1.0, -0.5)]
    terne += [(round(rnd.uniform(-1, 30), 3), round(log_uniforme(rnd, 0, 6), 2), round(log_uniforme(rnd, 0, 6), 2)) for _ in range(150)]
    out["divider"] = [{"vin": a, "r1": b, "r2": c, "out": esito(electronics.divider, a, b, c)} for a, b, c in terne]
    valori = [0.0, -1.0, 1.0, 10.0, 100.0, 1000.0, 999.9999999999999, 1000.0000000000001, 9.999999999999998, 0.1, 0.01, 0.001, 1e-6, 1e12, 1.7976931348623157e308,
              5e-324, 1e-320, 8.2, 8.21, 8.2000000001, 8.19999999999, 4.7e3 * (1 - 1e-10), 4.7e3 * (1 - 1e-8), 9.9, 9.1, 9.10001, 1.0000000001, math.inf, math.nan]  # fmt: skip
    valori += [s * 10.0**k for s in electronics.E24 for k in (-3, 0, 2, 5)]
    valori += [log_uniforme(rnd, -6, 12) for _ in range(300)]
    out["nearest_standard"] = []
    for v in valori:
        for serie, nome in ((electronics.E12, "E12"), (electronics.E24, "E24")):
            for up in (True, False):
                out["nearest_standard"].append({"x": J(v), "serie": nome, "up": up, "r": esito(electronics.nearest_standard, v, serie, up)})
    terne = [(5.0, 2.0, 10.0), (5.0, 5.0, 10.0), (3.3, 2.0, 0.0), (3.3, 2.0, -1.0), (12.0, 3.2, 20.0), (5e-324, 0.0, 1000.0), (1.0, 0.0, 5e-324), (math.inf, 2.0, 10.0)]
    terne += [(round(rnd.uniform(1.5, 24), 2), round(rnd.uniform(1.2, 3.6), 2), round(log_uniforme(rnd, -1, 2), 1)) for _ in range(250)]
    out["led_resistor"] = [{"s": J(a), "l": J(b), "ma": J(c), "out": esito(electronics.led_resistor, a, b, c)} for a, b, c in terne]
    fasce = [["giallo", "viola", "rosso", "oro"], ["marrone", "nero", "nero"], ["GIALLO ", " Viola", "rosso"], ["rosso", "rosso", "nero", "nero", "marrone"], ["nero"],
             ["giallo", "viola", "oro"], ["giallo", "viola", "argento", "argento"], ["giallo", "viola", "rosso", "nero"], ["giallo", "viola", "rosa"], ["oro", "viola", "rosso"],
             ["a", "b", "c", "d", "e", "f"], [], ["bianco", "bianco", "bianco", "bianco", "grigio"], ["verde", "blu", "bianco", "viola"], ["marrone", "nero", "nero", "oro", "oro"]]  # fmt: skip
    colori = list(electronics.COLORS) + ["oro", "argento", "rosa", "Nero", "BIANCO", " blu "]
    fasce += [[rnd.choice(colori) for _ in range(rnd.choice([3, 4, 5, 5]))] for _ in range(300)]
    out["decode_bands"] = [{"b": b, "r": esito(electronics.decode_bands, b)} for b in fasce]
    valori = [0.0, -4700.0, 4700.0, 0.1, 0.01, 0.001, 0.47, 99.5, 995.0, 999.5, 9995.0, 0.995, 1e10, 9.99e9, 9.995e10, 1e11, 47.0, 4.7, 0.009, 12345.0, 2.5, 25.0, 250.0,
              1.5e-322, math.inf, -math.inf, math.nan, 1.7976931348623157e308, 999.9999999999999, 1000.0000000000001]  # fmt: skip
    valori += [log_uniforme(rnd, -3, 12) for _ in range(250)] + [round(log_uniforme(rnd, 0, 6), rnd.randint(0, 2)) for _ in range(100)]
    out["encode_bands"] = [{"x": J(v), "five": f, "r": esito(electronics.encode_bands, v, f)} for v in valori for f in (False, True)]
    valori = [0.0, -1.0, 1.0, 999.0, 1000.0, 999999.0, 1e6, 4700.0, 4.7, 0.47, 1234567.0, 1e12, 1e-7, math.inf, math.nan, 12345.678, 999999.5, 999.9995]
    valori += [log_uniforme(rnd, -3, 10) for _ in range(250)]
    out["format_ohms"] = [{"x": J(v), "r": electronics.format_ohms(v)} for v in valori]
    return out


# ======================================================================================================
# Convertitore, CRC, costruttore NDEF (anche le pagine Qt, guidate senza finestra)
# ======================================================================================================


def app_qt() -> QApplication:
    return QApplication.instance() or QApplication([])


def righe_modulo(w) -> list:
    f: QFormLayout = w.layout()
    out = []
    for r in range(f.rowCount()):
        item = f.itemAt(r, QFormLayout.ItemRole.FieldRole)
        out.append(item.widget() if item else None)
    return out


def ingressi_convertitore() -> list[tuple[str, str]]:
    rnd = random.Random(9)
    casi = []
    dec = ["0", "255", "256", "-1", " 42 ", "1_000", "abc", "", "٣", "65535", "18446744073709551616", "9" * 4300, "1" + "0" * 4300, "+7", "0x10", "1e3", "２５５"]
    dec += [str(rnd.randrange(10 ** rnd.randint(1, 60))) for _ in range(80)]
    casi += [(d, "dec") for d in dec]
    esa = ["50 6F 6C 70 6F", "0x1F", "0X1F", "abc", "", "  ", "zz", "é", "ff" * 1785, "ff" * 1786, "0x", "0x0", "a b c", "AB CD\nEF", "　ab", "0x 1f", "00 00"]
    esa += [byte_casuali(rnd, rnd.randint(0, 12)).hex(*rnd.choice([(), (" ",)])) for _ in range(80)] + [testo_casuale(rnd, "0123456789abcdefxg ", 7) for _ in range(60)]
    casi += [(e, "hex") for e in esa]
    binari = ["0b101", "101", "1 0 1", "", "2", "-1", "1_0", "0B11", "١٠", "0b", "11111111", "100000000", "0" * 17, "+1", "0b_1"]
    binari += [testo_casuale(rnd, "01 _b", 20) for _ in range(60)]
    casi += [(b, "bin") for b in binari]
    b64 = ["UG9scG8=", "UG9scG8", "", "====", " UG9s ", "UG9s\nbG8=", "€", "/w==", "AAAA"] + [base64.b64encode(byte_casuali(rnd, rnd.randint(0, 10))).decode() for _ in range(40)]
    b64 += [testo_casuale(rnd, "AB+/=Q9 ", 9) for _ in range(40)]
    casi += [(b, "b64") for b in b64]
    testi = ["Polpo", "", "  spazi  ", "àèì", "🐙", "\x00\x01\x7f", "".join(map(chr, [0x61, 0xD800]))] + [testo_unicode(rnd, 12) for _ in range(40)]
    casi += [(t, k) for t in testi for k in ("text", "altro")]
    return casi


def casi_convertitore() -> dict:
    out: dict[str, list] = {}
    casi = ingressi_convertitore()
    out["convert"] = [{"t": J(t), "k": k, "r": esito(converter.convert, t, k)} for t, k in casi]
    app_qt()
    w = converter.create(None)
    righe = righe_modulo(w)
    tipo, campo, uscite = righe[0], righe[1], righe[2:]
    out["pagina"] = []
    for t, k in casi:
        try:
            converter.convert(t, k)
        except (ValueError, binascii.Error):
            pass
        except Exception:  # noqa: BLE001 - la pagina Qt non le gestisce: niente caso di pagina
            continue
        if ha_surrogati(t) or len(t) > 1000:
            continue
        tipo.setCurrentIndex(tipo.findData(k) if tipo.findData(k) >= 0 else tipo.findData("text"))
        campo.setText(t)
        out["pagina"].append({"t": campo.text(), "k": tipo.currentData(), "r": [lb.text() for lb in uscite]})
    w.deleteLater()
    out["manifest"] = [converter.MANIFEST]
    return out


def casi_crc() -> dict:
    rnd = random.Random(10)
    out: dict[str, list] = {}
    dati = [b"", b"123456789", b"a", bytes(range(256))] + [byte_casuali(rnd, n) for n in (55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 1000)]
    dati += [byte_casuali(rnd, rnd.randint(0, 80)) for _ in range(150)]
    out["checks"] = [
        {"b": d.hex(), "ccitt": crc_tool.crc16_ccitt(d), "ccitt0": crc_tool.crc16_ccitt(d, 0), "modbus": crc_tool.crc16_modbus(d), "crc32": zlib.crc32(d), "sha256": hashlib.sha256(d).hexdigest(), "r": crc_tool.checks(d)}
        for d in dati
    ]
    app_qt()
    w = crc_tool.create(None)
    casella = w.findChild(QCheckBox)
    campo = w.findChild(QPlainTextEdit)
    f: QFormLayout = w.layout()
    etichette = []
    for r in range(f.rowCount()):
        lab = f.itemAt(r, QFormLayout.ItemRole.LabelRole)
        fld = f.itemAt(r, QFormLayout.ItemRole.FieldRole)
        if lab and fld and fld.widget() is not campo:
            etichette.append((lab.widget().text(), fld.widget()))
    testi = ["123456789", "", "Polpo", "àèì🐙", "01 02 03", "0102 03", "zz", "abc", "a b", "\n00\nff\n", "€", "0x01"] + [testo_unicode(rnd, 10) for _ in range(40)]
    testi += [byte_casuali(rnd, rnd.randint(0, 10)).hex(*rnd.choice([(), (" ",), ("\n",)])) for _ in range(40)]
    out["pagina"] = []
    for t in testi:
        for esa in (False, True):
            casella.setChecked(esa)
            campo.setPlainText(t)
            out["pagina"].append({"t": campo.toPlainText(), "hex": esa, "r": {k: lb.text() for k, lb in etichette}})
    w.deleteLater()
    out["manifest"] = [crc_tool.MANIFEST]
    return out


def casi_ndef_app() -> dict:
    rnd = random.Random(11)
    out: dict[str, list] = {}
    valori = ["https://example.org", "", "https://", "tel:+390000", "Ciao dal Polpo", "x" * 140, "x" * 500, "€" * 300, "🐙"] + [testo_unicode(rnd, 40) for _ in range(60)]
    out["build"] = [{"k": k, "v": v, "l": lingua, "r": esito(ndef_app.build, k, v, lingua)} for v in valori for k in ("uri", "text") for lingua in ("it", "en")]
    app_qt()
    w = ndef_app.create(None)
    righe = righe_modulo(w)
    tipo, campo, byte, spazio = righe
    out["pagina"] = []
    for v in valori:
        for k in ("uri", "text"):
            tipo.setCurrentIndex(tipo.findData(k))
            campo.setText(v)
            out["pagina"].append({"k": tipo.currentData(), "v": campo.text(), "byte": byte.text(), "spazio": spazio.text()})
    w.deleteLater()
    out["manifest"] = [ndef_app.MANIFEST]
    return out


# ======================================================================================================
# Aiuti delle pagine (metodi degli strumenti chiamati con oggetti finti al posto dei widget Qt)
# ======================================================================================================


class Campo:
    """Al posto di QLineEdit, QPlainTextEdit, QLabel, QTextBrowser, QComboBox, QDoubleSpinBox, QCheckBox."""

    def __init__(self, testo: str = "", dato=None, valore: float = 0.0, spuntato: bool = False) -> None:
        self._t, self.dato, self.valore, self.spuntato = testo, dato, valore, spuntato

    def text(self) -> str:
        return self._t

    toPlainText = currentText = toHtml = text

    def setText(self, t: str) -> None:
        self._t = t

    setHtml = setText

    def clear(self) -> None:
        self._t = ""

    def currentData(self):
        return self.dato

    def value(self) -> float:
        return self.valore

    def isChecked(self) -> bool:
        return self.spuntato

    def setCurrentIndex(self, _i: int) -> None:
        pass


class Registro:
    def __init__(self) -> None:
        self.voci: list = []

    def add(self, *a, **k) -> None:
        self.voci.append([*a, *k.values()])


class Cassaforte:
    def __init__(self, voci=None) -> None:
        self.messi: list = []
        self.voci = voci or []

    def put(self, categoria, nome, dati, **k) -> None:
        self.messi.append({"categoria": categoria, "nome": nome, "dati": dati.decode(), **{a: J(b) for a, b in k.items()}})

    def items(self, _categoria):
        return self.voci

    def get(self, ident):
        return next(v for v in self.voci if v.id == ident).dati


def finto(**attr) -> types.SimpleNamespace:
    f = types.SimpleNamespace(**attr)
    f.messaggi = []
    f.say = lambda testo, errore=False: f.messaggi.append([testo, errore])
    f.ctx = types.SimpleNamespace(activity=Registro(), vault=Cassaforte(), bus=types.SimpleNamespace(publish=lambda *_a: None), settings=types.SimpleNamespace(get=lambda _k: {}))
    return f


def lega(f, classe, *nomi) -> None:
    for n in nomi:
        setattr(f, n, types.MethodType(getattr(classe, n), f))


def casi_pagina_nfc() -> dict:
    rnd = random.Random(12)
    out: dict[str, list] = {}
    carte = carte_type2()
    out["render"] = [{"card": c, "sim": s, "r": esito(nfc_tools.render, c, s)} for c in carte for s in (False, True) if s or rnd.random() < 0.5]
    testi = ["03 11 D1 01 0D 55 04 65 78 61 6D 70 6C 65 2E 6F 72 67 FE", "", "zz", "D1 01 0D 55 04 65 78 61 6D 70 6C 65 2E 6F 72 67", "03 00 FE", "00", "01 03 A0 0C 34 03 00 FE", "FD", "03",
             "d1 01 05 54 02 69 74 3c 62", "D1 01 05 54 02 69 74 26 27", "c1 01 00", "a", "03 11 D1 01 0D 55"]  # fmt: skip
    testi += [messaggio_casuale(rnd).hex(*rnd.choice([(), (" ",)])) for _ in range(120)] + [tlv_casuale(rnd).hex(" ") for _ in range(80)]
    out["analyse_ndef"] = []
    for t in testi:
        f = finto(ndef_in=Campo(t), ndef_out=Campo())
        r = esito(nfc_tools.NfcTools.analyse_ndef, f)
        out["analyse_ndef"].append({"t": t, "r": r, "html": f.ndef_out.text()})
    out["size"] = []
    valori = ["https://", "https://example.org", "", "Ciao", "€" * 200, "x" * 600] + [testo_unicode(rnd, 30) for _ in range(30)]
    for v in valori:
        for k in ("uri", "text"):
            for lingua in ("it", "", "en-US"):
                f = finto(value=Campo(v), kind=Campo(dato=k), lang=Campo(lingua), size_info=Campo())
                lega(f, nfc_tools.NfcTools, "_message")
                nfc_tools.NfcTools._size(f)
                out["size"].append({"k": k, "v": v, "l": lingua, "r": f.size_info.text()})
    out["write"] = []
    valori = ["https://example.org/mio", "", "   ", "  ciao  ", "x" * 400, "x" * 401, "€" * 133, "€" * 134, "🐙 testo"]
    risposte = [{"bytes": 23, "model": "NTAG215", "uid": "04A1B2C3D4E5F6"}, {}, {"bytes": None, "model": 5, "uid": [1]}]
    for v in valori:
        for k in ("uri", "text"):
            for lingua in ("it", ""):
                for sim in (False, True):
                    f = finto(value=Campo(v), kind=Campo(dato=k), lang=Campo(lingua), simulated=sim)
                    conferme, richieste = [], []
                    f.need_polpo = lambda: True
                    f.require_lab = lambda _a: True
                    f.req = lambda cmd, args, ok, timeout=None, richieste=richieste: richieste.append((cmd, args, ok, timeout))
                    vecchio = common.confirm_sensitive
                    common.confirm_sensitive = lambda _p, titolo, testo, conferme=conferme: conferme.append([titolo, testo]) or True
                    try:
                        nfc_tools.NfcTools.write(f)
                    finally:
                        common.confirm_sensitive = vecchio
                    caso = {"k": k, "v": v, "l": lingua, "sim": sim, "msg": f.messaggi, "conferma": conferme, "req": [[c, a, t] for c, a, _ok, t in richieste], "dopo": []}
                    for c, a, ok, t in richieste:
                        for d in risposte:
                            f.messaggi, f.ctx.activity.voci = [], []
                            ok(d)
                            caso["dopo"].append({"d": d, "msg": f.messaggi, "att": f.ctx.activity.voci})
                    out["write"].append(caso)
    out["read"] = []
    risposte = [{"present": False}, {"present": True, "uid": "04AABB", "model": "NTAG213", "sak": 0, "pages": ""}, {"present": True, "family": "MIFARE Classic 1K", "sak": 8, "uid": "A1B2C3D4"},
                {"present": True, "simulated": True, "uid": "X", "sak": 0}, {"present": 1}, {"present": True, "model": "", "family": ""}]  # fmt: skip
    risposte += [c for c in carte if "present" in c][:40]
    for d in risposte:
        for sim in (False, True):
            f = finto(simulated=sim, view=Campo(), card=None, card_sim=False)
            richieste = []
            f.req = lambda cmd, args, ok, richieste=richieste: richieste.append((cmd, args, ok))
            lega(f, nfc_tools.NfcTools, "_show_card")
            nfc_tools.NfcTools.read_polpo(f)
            cmd, args, ok = richieste[0]
            r = esito(ok, d)
            out["read"].append({"d": d, "sim": sim, "cmd": cmd, "r": r, "html": f.view.text(), "card_sim": f.card_sim, "msg": f.messaggi, "att": f.ctx.activity.voci})
    out["save"] = []
    for c in [None, {}, {"present": False}, {"present": True, "uid": "04AABB", "model": "NTAG213"}, {"present": True}, {"present": True, "uid": None, "letto_il": "vecchio", "x": [1, 2.5]},
              {"present": True, "uid": "Z", "nota": "àè\n\"🐙", "n": {"a": []}}]:  # fmt: skip
        for sim in (False, True):
            for nome in (None, "mio.json"):
                f = finto(card=c, card_sim=sim)
                r = esito(nfc_tools.NfcTools.save_card, f, nome)
                # l'ordine delle chiavi conta nel JSON salvato, e nei file dei casi le chiavi sono in ordine alfabetico
                out["save"].append({"card": c, "chiavi": list(c) if c is not None else None, "sim": sim, "nome": nome, "r": r, "msg": f.messaggi, "messi": f.ctx.vault.messi})
    out["report"] = []
    gruppi = [[], [("a.json", carte[0], False), ("b.txt", carte[1], True), ("c.json", carte[2], True)], [(f"t{i}.json", c, i % 2 == 0) for i, c in enumerate(carte[3:9])]]
    for g in gruppi:
        voci = [types.SimpleNamespace(id=str(i), name=n, dati=json.dumps(c).encode(), simulated=s, meta={}) for i, (n, c, s) in enumerate(g)]
        f = finto()
        f.ctx.vault = Cassaforte(voci)
        lega(f, nfc_tools.NfcTools, "_items")
        with tempfile.TemporaryDirectory() as cartella:
            dest = os.path.join(cartella, "r.html")
            r = esito(nfc_tools.NfcTools.report, f, dest)
            doc = Path(dest).read_text(encoding="utf-8") if os.path.exists(dest) else None
        out["report"].append({"voci": [{"nome": n, "card": c, "sim": s} for n, c, s in g], "r": r, "doc": doc, "msg": len(f.messaggi)})
    archivio = []
    for n, meta, s in [("a.json", {"uid": "04AA", "model": "NTAG213"}, False), ("b.json", {}, True), ("c.txt", {"uid": "1"}, False)]:
        f = finto(arch=types.SimpleNamespace(righe={}, setRowCount=lambda _n: None))
        f.arch.setItem = lambda r, c, cella, f=f: f.arch.righe.setdefault(r, {}).__setitem__(c, cella)
        f.ctx.vault = Cassaforte([types.SimpleNamespace(id="1", name=n, meta=meta, simulated=s)])
        lega(f, nfc_tools.NfcTools, "_items")
        vecchio = nfc_tools.QTableWidgetItem
        nfc_tools.QTableWidgetItem = CellaFinta
        try:
            nfc_tools.NfcTools.refresh_archive(f)
        finally:
            nfc_tools.QTableWidgetItem = vecchio
        archivio.append({"nome": n, "meta": meta, "sim": s, "riga": [f.arch.righe[0][c].testo for c in range(4)] if f.arch.righe else None})
    out["archivio"] = archivio
    return out


class CellaFinta:
    def __init__(self, testo: str) -> None:
        self.testo = testo

    def setData(self, *_a) -> None:
        pass


def casi_pagina_rfid() -> dict:
    rnd = random.Random(13)
    out: dict[str, list] = {}
    carte = [rfid125.Em4100(rnd.randrange(256), rnd.randrange(2**32)) for _ in range(30)] + [rfid125.Em4100(0, 0), rfid125.Em4100(-2, 3703216247)]
    out["show_card"] = []
    for c in carte:
        for fonte, fmt in [("lettore USB (12 ms)", "decimale a 10 cifre (32 bit)"), ("<b>&'\"", ""), ("RDM6300", "trama con controllo XOR valido")]:
            f = finto(result=Campo())
            rfid_tools.RfidTools.show_card(f, c, fonte, fmt)
            out["show_card"].append({"c": [c.version, c.number], "fonte": fonte, "fmt": fmt, "r": f.result.text()})
    out["burst"] = []
    codici = ["0012345678", "abc", "", "1234,5678", "²²²²²²²²²²", "<script>", "0A1B2C3D4E", "12345678"]
    for t in codici:
        for durata, pausa in [(5.0, 1.0), (399.4, 39.9), (399.5, 10.0), (12.5, 2.0), (13.5, 2.0), (500.0, 100.0), (0.0, 0.0), (2.4999, 1.0)]:
            for dichiarato in (False, True):
                f = finto(result=Campo(), last=None, last_source="")
                f.ctx.settings = types.SimpleNamespace(get=lambda _k, d=dichiarato: {"rfid125.usb": d})
                lega(f, rfid_tools.RfidTools, "show_card")
                r = esito(rfid_tools.RfidTools.on_burst, f, rfid125.Burst(t, durata, pausa))
                out["burst"].append({"t": t, "durata": durata, "pausa": pausa, "dich": dichiarato, "r": r, "msg": f.messaggi, "html": f.result.text(), "src": f.last_source, "hex": f.last.hex if f.last else None})
    out["convert"] = []
    for t in codici + ["255,65535", "FFFFFFFFFF", " 0012345678 ", "١٢٣٤٥٦٧٨٩٠"]:
        f = finto(result=Campo(), conv_in=Campo(t), tabs=Campo(), last=None, last_source="")
        lega(f, rfid_tools.RfidTools, "show_card")
        r = esito(rfid_tools.RfidTools.convert, f)
        out["convert"].append({"t": t, "r": r, "msg": f.messaggi, "html": f.result.text(), "src": f.last_source})
    out["rdm_feed"] = []
    for _ in range(25):
        c = rfid125.Em4100(rnd.randrange(256), rnd.randrange(2**32))
        dati = rfid125.rdm6300_frame(c) * rnd.randint(0, 2) + (b"\x02000000000000\x03" if rnd.random() < 0.5 else b"") + byte_casuali(rnd, rnd.randint(0, 4))
        f = finto(result=Campo(), rdm_info=Campo(), parser=rfid125.Rdm6300Parser(), last=None, last_source="")
        lega(f, rfid_tools.RfidTools, "show_card")
        r = esito(rfid_tools.RfidTools.rdm_feed, f, dati)
        out["rdm_feed"].append({"dati": dati.hex(), "r": r, "msg": f.messaggi, "html": f.result.text(), "info": f.rdm_info.text()})
    out["save"] = []
    for c in [None, carte[0], carte[1]]:
        for nome in ("", "  badge palestra mio  ", "x"):
            for prova in (False, True):
                f = finto(last=c, last_source="lettore USB (5 ms)", card_name=Campo(nome), test_media=Campo(spuntato=prova))
                r = esito(rfid_tools.RfidTools.save_card, f)
                out["save"].append({"c": [c.version, c.number] if c else None, "nome": nome, "prova": prova, "r": r, "msg": f.messaggi, "messi": f.ctx.vault.messi, "att": f.ctx.activity.voci})
    voci = [("a", {"hex": "0A1B2C3D4E", "prova": True}), ("b", {"hex": "zz"}), ("c<", {}), ("d", {"hex": "0012345678", "prova": 0}), ("e", {"hex": "255,65535", "prova": "sì"})]
    out["archivio"] = []
    for n, meta in voci:
        f = finto(arch=types.SimpleNamespace(righe={}, setRowCount=lambda _n: None))
        f.arch.setItem = lambda r, c, cella, f=f: f.arch.righe.setdefault(r, {}).__setitem__(c, cella)
        f.ctx.vault = Cassaforte([types.SimpleNamespace(id="1", name=n, meta=meta)])
        lega(f, rfid_tools.RfidTools, "_items")
        vecchio = rfid_tools.QTableWidgetItem
        rfid_tools.QTableWidgetItem = CellaFinta
        try:
            rfid_tools.RfidTools.refresh_archive(f)
        finally:
            rfid_tools.QTableWidgetItem = vecchio
        out["archivio"].append({"nome": n, "meta": meta, "riga": [f.arch.righe[0][c].testo for c in range(4)]})
    out["report"] = []
    for g in [[], voci, voci[:1]]:
        f = finto()
        f.ctx.vault = Cassaforte([types.SimpleNamespace(id=str(i), name=n, meta=m) for i, (n, m) in enumerate(g)])
        lega(f, rfid_tools.RfidTools, "_items")
        with tempfile.TemporaryDirectory() as cartella:
            dest = os.path.join(cartella, "r.html")
            rfid_tools.RfidTools.report(f, dest)
            doc = Path(dest).read_text(encoding="utf-8")
        out["report"].append({"voci": [{"nome": n, "meta": m} for n, m in g], "doc": doc})
    return out


def casi_pagina_ibutton() -> dict:
    rnd = random.Random(14)
    out: dict[str, list] = {}
    testi = ["", "01 A2 B3 C4 D5 E6 00 7F", "0102030405060708", "28-FF-4A-1B-2C-3D-4E-5F", "zz", "010203040506\n\n07", "00            00"]
    for _ in range(40):
        corpo = bytes([rnd.choice([0x01, 0x28, 0x99])]) + byte_casuali(rnd, 6)
        testi.append((corpo + bytes([onewire.crc8(corpo) if rnd.random() < 0.6 else rnd.randrange(256)])).hex(" "))
    out["analyse"] = []
    for t in testi:
        f = finto(manual=Campo(t), manual_out=Campo())
        out["analyse"].append({"t": t, "r": esito(ibutton_tools.IButtonTools.analyse, f)})
    risposte = [{}, {"roms": []}, {"roms": [{"rom": "01 A2 B3 C4 D5 E6 00 7F"}, {"rom": "zz"}, {}, {"rom": "28FF4A1B2C3D4E5F"}]}, {"roms": [{"rom": None}]}, {"roms": ["01"]},
                {"roms": [{"rom": 5}]}, {"roms": [{"rom": t} for t in testi[7:15]]}, {"roms": [{"rom": "010203040506\n\n07"}]}]  # fmt: skip
    out["search"] = []
    for d in risposte:
        f = finto(roms=[], table=types.SimpleNamespace(righe={}, setRowCount=lambda _n: None))
        f.table.setItem = lambda r, c, cella, f=f: f.table.righe.setdefault(r, {}).__setitem__(c, cella)
        richieste = []
        vecchi = ibutton_tools.bridge_req, ibutton_tools.QTableWidgetItem
        ibutton_tools.bridge_req = lambda _t, cmd, args, ok, richieste=richieste: richieste.append((cmd, ok))
        ibutton_tools.QTableWidgetItem = CellaFinta
        try:
            lega(f, ibutton_tools.IButtonTools, "show_roms")
            ibutton_tools.IButtonTools.search(f)
            cmd, ok = richieste[0]
            r = esito(ok, d)
        finally:
            ibutton_tools.bridge_req, ibutton_tools.QTableWidgetItem = vecchi
        righe = [[f.table.righe[i][c].testo for c in range(4)] for i in sorted(f.table.righe)]
        out["search"].append({"d": d, "cmd": cmd, "r": r, "righe": righe, "msg": f.messaggi, "att": f.ctx.activity.voci})
    out["presence"] = []
    for d in [{}, {"presence": True}, {"presence": False}, {"presence": 1}, {"presence": ""}]:
        f = finto()
        richieste = []
        vecchio = ibutton_tools.bridge_req
        ibutton_tools.bridge_req = lambda _t, cmd, args, ok, richieste=richieste: richieste.append((cmd, ok))
        try:
            ibutton_tools.IButtonTools.presence(f)
        finally:
            ibutton_tools.bridge_req = vecchio
        cmd, ok = richieste[0]
        ok(d)
        out["presence"].append({"d": d, "cmd": cmd, "msg": f.messaggi})
    out["save"] = []
    for t in testi[1:4] + testi[7:12]:
        rom = onewire.parse_rom(t)
        f = finto(roms=[rom], table=types.SimpleNamespace(selectionModel=lambda: types.SimpleNamespace(selectedRows=lambda: [types.SimpleNamespace(row=lambda: 0)])))
        r = esito(ibutton_tools.IButtonTools.save_selected, f)
        out["save"].append({"t": t, "r": r, "messi": f.ctx.vault.messi})
    f = finto(roms=[], table=types.SimpleNamespace(selectionModel=lambda: types.SimpleNamespace(selectedRows=lambda: [])))
    out["save"].append({"t": None, "r": esito(ibutton_tools.IButtonTools.save_selected, f), "msg": f.messaggi})
    return out


def casi_pagina_usb() -> dict:
    rnd = random.Random(15)
    out: dict[str, list] = {}
    out["check"] = []
    for src, lay in script_ducky()[::3]:
        if not isinstance(src, str) or ha_surrogati(src):
            continue
        lay = lay if lay in ("IT", "US") else rnd.choice(["IT", "US"])
        f = finto(ducky=Campo(src), layout_box=Campo(lay), ducky_out=Campo())
        r = esito(usb_tools.UsbTools.check_ducky, f, conv=lambda s: s.ok)
        out["check"].append({"src": src, "layout": lay, "r": r, "testo": f.ducky_out.text()})
    out["filename"] = []
    for n in ["mio_script", "", "   ", "a b/c", "àèì", "🐙", "x" * 50, "nome-ok_1", "..", "\tpippo\n", "a　b", "Ciao Mondo!"]:
        f = finto(ducky_name=Campo(n))
        out["filename"].append({"n": n, "r": usb_tools.UsbTools._ducky_filename(f), "msg": f.messaggi})
    out["save"] = []
    for n, src in [("prova", usb_esempio()), ("", usb_esempio()), ("x y", "PIPPO"), ("àè", "STRING ok"), ("z", "STRING 🐙")]:
        for lay in ("IT", "US"):
            f = finto(ducky_name=Campo(n), ducky=Campo(src), layout_box=Campo(lay), ducky_out=Campo())
            lega(f, usb_tools.UsbTools, "check_ducky", "_ducky_filename")
            r = esito(usb_tools.UsbTools.save_ducky, f)
            out["save"].append({"n": n, "src": src, "layout": lay, "r": r, "msg": f.messaggi, "messi": f.ctx.vault.messi, "testo": f.ducky_out.text()})
    out["copy"] = []
    for n, src in [("prova", usb_esempio()), ("", usb_esempio()), ("x", "PIPPO"), ("àè", "STRING ok")]:
        for sim in (False, True):
            f = finto(ducky_name=Campo(n), ducky=Campo(src), layout_box=Campo("IT"), ducky_out=Campo(), simulated=sim)
            lega(f, usb_tools.UsbTools, "check_ducky", "_ducky_filename")
            lavori, scritti = [], []
            f.job = lambda fn, ok, lavori=lavori: lavori.append((fn, ok))
            usb_tools.UsbTools.copy_ducky(f)
            for fn, ok in lavori:
                fn(types.SimpleNamespace(write_file=lambda dest, dati, scritti=scritti: scritti.append([dest, dati.decode()])))
                ok(None)
            out["copy"].append({"n": n, "src": src, "sim": sim, "msg": f.messaggi, "scritti": scritti, "att": f.ctx.activity.voci})
    return out


def casi_pagina_gpio() -> dict:
    rnd = random.Random(16)
    out: dict[str, list] = {}
    out["ohm"] = []
    terne = [(5.0, 0.0, 220.0), (0.0, 0.0, 0.0), (5.0, 0.02, 220.0), (0.0, 0.02, 220.0), (5.0, 0.02, 0.0), (5.0, 0.0, 0.0), (12.0, 0.5, 0.0), (0.001, 0.0, 1e7)]
    terne += [tuple(0.0 if rnd.random() < 0.35 else round(log_uniforme(rnd, -3, 6), 3) for _ in range(3)) for _ in range(200)]
    for v, i, r in terne:
        f = finto(o_v=Campo(valore=v), o_i=Campo(valore=i), o_r=Campo(valore=r), o_out=Campo())
        out["ohm"].append({"v": v, "i": i, "r": r, "testo": esito(gpio_tools.GpioTools.calc_ohm, f)})
    out["divider"] = []
    terne = [(5.0, 10000.0, 20000.0), (5.0, 0.0, 0.0), (0.0, 1.0, 1.0)] + [tuple(round(log_uniforme(rnd, -1, 6), 3) for _ in range(3)) for _ in range(100)]
    for a, b, c in terne:
        f = finto(d_vin=Campo(valore=a), d_r1=Campo(valore=b), d_r2=Campo(valore=c), d_out=Campo())
        out["divider"].append({"vin": a, "r1": b, "r2": c, "testo": esito(gpio_tools.GpioTools.calc_divider, f)})
    out["led"] = []
    terne = [(5.0, 2.0, 10.0), (5.0, 5.0, 10.0), (3.3, 2.0, 0.0), (12.0, 3.2, 20.0), (5.0, 2.0, 1000.0)]
    terne += [(round(rnd.uniform(0, 24), 3), round(rnd.uniform(0, 4), 3), round(log_uniforme(rnd, -1, 3), 3)) for _ in range(200)]
    for a, b, c in terne:
        f = finto(l_vs=Campo(valore=a), l_vf=Campo(valore=b), l_ma=Campo(valore=c), l_out=Campo())
        out["led"].append({"s": a, "l": b, "ma": c, "testo": esito(gpio_tools.GpioTools.calc_led, f)})
    out["colori"] = []
    fasce = ["giallo viola rosso oro", "marrone nero nero", "", "rosso rosso", "Giallo  Viola  Rosso", "giallo viola rosso nero", "blu grigio oro argento", "a b c d e f",
             "rosso rosso nero nero marrone", "verde\tblu\nmarrone"]  # fmt: skip
    colori = list(electronics.COLORS) + ["oro", "argento", "rosa"]
    fasce += [" ".join(rnd.choice(colori) for _ in range(rnd.choice([3, 4, 5]))) for _ in range(60)]
    valori = ["4700", "4,7", "0", "-1", "abc", "", "1e3", "inf", "-inf", "nan", "1_000", "0,005", "99,5", " 220 ", "1e11", "1e400", "٣٣٠", "4,7,1", "0x10"]
    valori += [str(round(log_uniforme(rnd, -2, 10), rnd.randint(0, 3))).replace(".", rnd.choice([".", ","])) for _ in range(60)]
    for k in range(max(len(fasce), len(valori))):
        b, v = fasce[k % len(fasce)], valori[k % len(valori)]
        f = finto(c_bands=Campo(b), c_value=Campo(v), c_out=Campo())
        out["colori"].append({"b": b, "v": v, "testo": esito(gpio_tools.GpioTools.calc_colors, f)})
    return out


def main() -> None:
    if sys.version_info[:2] != (3, 13):
        print(f"Attenzione: i casi sono pensati per Python 3.13 (questo è {sys.version.split()[0]}).", file=sys.stderr)
    scrivi("py", casi_py())
    scrivi("ndef", casi_ndef())
    scrivi("type2", casi_type2())
    scrivi("rfid125", casi_rfid())
    scrivi("onewire", casi_onewire())
    scrivi("ducky", casi_ducky())
    scrivi("elettronica", casi_elettronica())
    scrivi("convertitore", casi_convertitore())
    scrivi("crc", casi_crc())
    scrivi("ndef_app", casi_ndef_app())
    scrivi("pagina_nfc", casi_pagina_nfc())
    scrivi("pagina_rfid", casi_pagina_rfid())
    scrivi("pagina_ibutton", casi_pagina_ibutton())
    scrivi("pagina_usb", casi_pagina_usb())
    scrivi("pagina_gpio", casi_pagina_gpio())


if __name__ == "__main__":
    main()
