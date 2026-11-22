"""Autodiagnosi (``polpo-studio --self-test``): controlla che il programma installato funzioni.

Non usa hardware vero: protocollo contro i casi del firmware, Polpo virtuale, cassaforte in una
cartella temporanea, finestra senza schermo. Restituisce 0 se tutto va bene.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
from collections.abc import Callable
from pathlib import Path


def _golden() -> None:
    from ..paths import resources_dir
    from ..protocols import link

    cases = [json.loads(x) for x in (resources_dir() / "link_pure.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    assert len(cases) >= 14
    for c in cases:
        resp, _ = link.preprocess(c["send"], c["session"], c["busy"])
        assert resp == c["expect"], c["name"]


def _virtual_polpo() -> None:
    from ..devices.link_client import PolpoLinkClient
    from ..devices.transport import VirtualTransport
    from ..devices.virtual_polpo import VirtualPolpo

    c = PolpoLinkClient(VirtualTransport(VirtualPolpo(time_scale=0.01, latency=0.0, auto_confirm_delay=0.2)))
    c.open()
    try:
        assert c.probe()["pong"]
        assert c.hello()["virtual"] is True
        data = os.urandom(2000)
        c.write_file("/polpo/logs/autodiagnosi.bin", data)
        assert c.read_file("/polpo/logs/autodiagnosi.bin") == data
    finally:
        c.close()


class Skipped(Exception):
    """Controllo non applicabile qui (non è un errore)."""


def _scripts() -> None:
    """Gli script nel Polpo virtuale: li esegue il firmware simulato (polpo-sim.wasm con wasmtime)."""
    import threading
    import time

    from ..devices import firmware_sim
    from ..devices.link_client import PolpoLinkClient
    from ..devices.transport import VirtualTransport
    from ..devices.virtual_polpo import VirtualPolpo

    reason = firmware_sim.unavailable_reason()
    if reason:
        # nel programma installato deve esserci; da sorgente (senza il file costruito) si può saltare
        if getattr(sys, "frozen", False) or os.environ.get("POLPO_FIRMWARE_SIM") == "obbligatorio":
            raise RuntimeError(reason)
        raise Skipped(reason)
    events: list[tuple[str, dict]] = []
    ended = threading.Event()

    def on_event(ev: str, data: dict) -> None:
        events.append((ev, data))
        if ev == "script.end":
            ended.set()

    c = PolpoLinkClient(VirtualTransport(VirtualPolpo(latency=0.0, auto_confirm_delay=0.05)), on_event=on_event)
    c.open()
    try:
        c.hello()
        path = "/polpo/script/autodiagnosi.polpo"
        c.write_file(path, "x = seno(30) * 4\nscrivi(\"risultato\", x + 1)\n".encode())
        assert c.call("script.check", {"file": path}) == {"valid": True, "line": 0, "message": ""}
        started = time.monotonic()
        c.call("script.run", {"file": path}, timeout=20.0)
        assert ended.wait(20.0), "il programma non è finito"
        prints = [d.get("text") for ev, d in events if ev == "script.print"]
        assert prints == ["risultato 3"], prints
        assert [d for ev, d in events if ev == "script.end"] == [{"line": 2, "error": ""}]
        assert time.monotonic() - started < 20
    finally:
        c.close()


def _vault() -> None:
    from ..security.audit import AuditLog
    from ..security.vault import Vault

    with tempfile.TemporaryDirectory() as d:
        v = Vault(Path(d) / "c", kdf_n=2**12)
        rec = v.create("frase di autodiagnosi lunga")
        it = v.put("altro", "prova", b"dati")
        v.lock()
        v.unlock_recovery(rec)
        assert v.get(it.id) == b"dati" and v.verify() == []
        log = AuditLog(v)
        log.append({"ts": 0, "category": "test", "message": "ok", "level": "info", "simulated": False})
        assert log.verify() == []
        v.lock()


def _window() -> None:
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from PySide6.QtWidgets import QApplication

    from .context import AppContext
    from .main_window import MainWindow

    app = QApplication.instance() or QApplication([sys.argv[0]])
    with tempfile.TemporaryDirectory() as d:
        ctx = AppContext.create(Path(d), kdf_n=2**12)
        ctx.vault.create("frase di autodiagnosi lunga")
        ctx.on_unlocked()
        w = MainWindow(ctx)
        for key in list(w.pages):
            w.show_page(key)
            app.processEvents()
        assert len(w.pages) >= 14
        w.close()
        app.processEvents()


def _modules() -> None:
    import cryptography  # noqa: F401
    import serial  # noqa: F401

    from ..core.catalog import all_capabilities
    from ..core.hardware import SPECS

    for _m, c in all_capabilities():
        for r in c.routes:
            assert all(h in SPECS for h in r.hardware)


CHECKS: list[tuple[str, Callable[[], None]]] = [
    ("moduli e catalogo", _modules),
    ("protocollo Polpo Link (casi del firmware)", _golden),
    ("Polpo virtuale e trasferimento file", _virtual_polpo),
    ("script nel Polpo virtuale (firmware simulato)", _scripts),
    ("cassaforte cifrata e registro", _vault),
    ("finestra e pagine", _window),
]


def run(out=print) -> int:
    from .. import __version__

    out(f"Polpo Studio {__version__} — autodiagnosi")
    failed = 0
    for name, fn in CHECKS:
        try:
            fn()
            out(f"  OK      {name}")
        except Skipped as e:
            out(f"  SALTATO {name}: {e}")
        except Exception:  # noqa: BLE001 - si riporta tutto
            failed += 1
            out(f"  ERRORE  {name}")
            out("          " + traceback.format_exc().strip().replace("\n", "\n          "))
    out("Tutto a posto." if not failed else f"{failed} controlli non riusciti.")
    return 1 if failed else 0
