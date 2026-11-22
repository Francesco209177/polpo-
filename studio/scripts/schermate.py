#!/usr/bin/env python3
"""Rigenera le schermate di Polpo Studio usate dal sito (cartella ``site/assets/img/schermate``).

    cd studio && python scripts/schermate.py ../site/assets/img/schermate

Gira senza schermo (Qt "offscreen") con il Polpo virtuale: tutto ciò che si vede è SIMULATO e nelle
immagini non compaiono cartelle o dati personali.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_SCALE_FACTOR", "2")  # immagini nitide anche sugli schermi ad alta densità

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtGui import QImageWriter  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from polpo_studio.app.context import AppContext  # noqa: E402
from polpo_studio.app.main_window import MainWindow  # noqa: E402
from polpo_studio.app.themes import stylesheet  # noqa: E402

SIZE = (1280, 800)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "schermate").resolve()
    out.mkdir(parents=True, exist_ok=True)
    fmt = "webp" if b"webp" in [bytes(f) for f in QImageWriter.supportedImageFormats()] else "png"
    app = QApplication([sys.argv[0]])
    app.setStyle("Fusion")

    def wait(cond, timeout: float = 8.0) -> None:
        end = time.monotonic() + timeout
        while not cond():
            if time.monotonic() > end:
                raise TimeoutError("condizione non raggiunta: " + getattr(cond, "__doc__", "") or "")
            app.processEvents()
            time.sleep(0.01)

    def settle(seconds: float = 0.25) -> None:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            app.processEvents()
            time.sleep(0.01)

    with tempfile.TemporaryDirectory(prefix="polpo-studio-") as tmp:
        ctx = AppContext.create(Path(tmp), kdf_n=2**12)
        ctx.vault.create("frase usata solo per le schermate")
        ctx.on_unlocked()
        ctx.settings.set("virtual_confirm_dialog", False)
        ctx.devices.virtual_options = dict(time_scale=0.02, latency=0.0, auto_confirm_delay=0.2)
        s = ctx.settings
        app.setStyleSheet(stylesheet(s.get("theme"), s.get("accent"), s.get("font_scale"), s.get("density")))
        win = MainWindow(ctx)
        win.resize(*SIZE)
        win.show()

        def shot(name: str) -> None:
            settle()
            path = out / f"{name}.{fmt}"
            if not win.grab().save(str(path), fmt.upper(), 84):
                raise RuntimeError(f"impossibile salvare {path}")
            print(f"{path.name}: {path.stat().st_size // 1024} KB")

        def tool(key: str):
            win.show_page(key)
            return win.pages[key].tools_box.itemAt(0).widget()

        win.connect_virtual()
        wait(lambda: ctx.devices.connected)
        settle(0.5)
        win.show_page("home")
        shot("studio-home")

        radio = tool("radio")
        radio.tabs.setCurrentIndex(1)
        radio.raw_start()
        wait(lambda: len(radio.raw) > 10)
        radio.raw_stop()
        shot("studio-radio")

        nfc = tool("nfc")
        nfc.read_polpo()
        wait(lambda: nfc.card is not None)
        shot("studio-nfc")

        ir = tool("infrared")
        ir.open_source(("lib", "tv|Samsung"))
        shot("studio-infrarossi")

        usb = tool("usb")
        usb.tabs.setCurrentIndex(4)
        usb.check_ducky()
        shot("studio-duckyscript")

        s.set("theme", "chiaro")
        settle(0.5)
        win.show_page("home")
        shot("studio-chiaro")

        win.close()
        settle(0.2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
