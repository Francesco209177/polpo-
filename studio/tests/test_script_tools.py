"""Pagina «Script» di Polpo Studio con il Polpo virtuale, che esegue i programmi con il firmware vero."""

import pytest
from PySide6.QtCore import Qt

from polpo_studio.app.main_window import MainWindow
from polpo_studio.app.tools import script_tools
from polpo_studio.core.capability import Status
from polpo_studio.devices import firmware_sim

from .test_gui import make_ctx, shot, statuses

MISSING = firmware_sim.unavailable_reason()
needs_sim = pytest.mark.skipif(bool(MISSING), reason=f"firmware simulato non disponibile: {MISSING}")


@pytest.fixture
def win(qtbot, tmp_path):
    ctx = make_ctx(tmp_path / "dati")
    ctx.settings.set("virtual_confirm_dialog", False)
    ctx.devices.virtual_options = dict(time_scale=1.0, latency=0.0, auto_confirm_delay=0.05)
    w = MainWindow(ctx)
    qtbot.addWidget(w)
    w.show()
    yield w
    w.close()


def connect(win, qtbot):
    win.connect_virtual()
    qtbot.waitUntil(lambda: win.ctx.devices.connected, timeout=5000)
    t = tool(win)
    qtbot.waitUntil(lambda: t.b_run.isEnabled(), timeout=5000)  # la pagina riceve la notizia del collegamento


def tool(win):
    win.show_page("script")
    return win.pages["script"].tools_box.itemAt(0).widget()


def test_module_page_and_capabilities(win):
    s = statuses(win.pages["script"])
    assert s["script.files"] == Status.AVAILABLE.value  # scrivere e salvare non richiede il Polpo
    assert s["script.run"] == Status.NEEDS_HARDWARE.value
    assert s["script.transmit"] == Status.NOT_AVAILABLE.value
    t = tool(win)
    assert not t.b_run.isEnabled() and not t.screen_card.isVisible()
    t.run()
    assert "Collega prima il Polpo" in t.status.text()


def test_files_on_the_pc(win, tmp_path):
    t = tool(win)
    t.editor.setPlainText('scrivi("dal PC")\n')
    t.name.setText("mio gioco")  # spazio: non è un nome valido sul Polpo
    t.check()
    assert "Il nome può avere solo" in t.status.text()
    t.name.setText("mio_gioco")
    dest = tmp_path / "mio_gioco.polpo"
    t.save_to_pc(str(dest))
    assert dest.read_text(encoding="utf-8") == 'scrivi("dal PC")\n'
    t.new_program()
    assert t.editor.toPlainText() == script_tools.EXAMPLE
    src = tmp_path / "Altro gioco!.polpo"
    src.write_text("﻿x = 1\n", encoding="utf-8")
    t.open_from_pc(str(src))
    assert t.editor.toPlainText() == "x = 1\n" and t.name.text() == "Altro_gioco_"
    big = tmp_path / "grande.polpo"
    big.write_text("x = 1\n" * 4000)
    t.open_from_pc(str(big))
    assert "Non riesco ad aprire" in t.status.text()
    # la bozza resta per la prossima volta
    t.editor.setPlainText("y = 2\n")
    assert t._draft.read_text(encoding="utf-8") == "y = 2\n"


def test_rgb565_conversion():
    data = bytes([0xF8, 0x00]) + bytes(2 * (script_tools.WIDTH * script_tools.HEIGHT - 1))  # primo punto rosso
    img = script_tools.rgb565_to_image(data)
    assert img.width() == 240 and img.height() == 135
    assert img.pixelColor(0, 0).red() > 240 and img.pixelColor(0, 0).green() == 0
    assert img.pixelColor(1, 0).red() == 0


@needs_sim
def test_check_run_and_errors(win, qtbot):
    connect(win, qtbot)
    t = tool(win)
    assert t.b_run.isEnabled() and t.screen_card.isVisible()
    t.editor.setPlainText('scrivi("uno")\ncerhio(10, 10, 5, ROSSO)\n')
    t.check()
    qtbot.waitUntil(lambda: "Riga 2" in t.status.text(), timeout=5000)
    assert "Forse volevi «cerchio»" in t.status.text()
    assert t.editor.textCursor().blockNumber() == 1 and t.editor.extraSelections()
    t.editor.setPlainText(script_tools.EXAMPLE)
    t.check()
    qtbot.waitUntil(lambda: "Nessun errore" in t.status.text(), timeout=5000)
    assert "/polpo/script/prova.polpo" in win.ctx.devices.virtual.files
    t.run()
    qtbot.waitUntil(lambda: "Programma finito" in t.status.text(), timeout=8000)
    assert t.output.toPlainText().splitlines() == ["Ciao!", "1 per 1 fa 1", "2 per 2 fa 4", "3 per 3 fa 9", "4 per 4 fa 16", "5 per 5 fa 25"]
    assert "SIMULATO" in t.status.text()
    t.editor.setPlainText('scrivi("prima")\nx = 10 / 0\n')
    t.run()
    qtbot.waitUntil(lambda: "dividere per zero" in t.status.text(), timeout=8000)
    assert t.editor.textCursor().blockNumber() == 1
    assert any("Script fermato da un errore" in e.message for e in win.ctx.activity.entries())


@needs_sim
def test_step_by_step(win, qtbot):
    connect(win, qtbot)
    t = tool(win)
    t.editor.setPlainText("funzione doppio(n)\n  ritorna n * 2\nfine\nx = 4\ny = doppio(x)\nscrivi(x + y)\n")
    t.step()
    qtbot.waitUntil(lambda: "Fermo alla riga 1" in t.status.text(), timeout=8000)
    assert t.b_step.text() == "Riga successiva" and t.b_resume.isEnabled()
    for line in (4, 5, 2):
        t.step()
        qtbot.waitUntil(lambda line=line: f"Fermo alla riga {line}" in t.status.text(), timeout=5000)
    assert "dentro «doppio»" in t.status.text()
    cells = [t.vars.item(r, c).text() for r in range(t.vars.rowCount()) for c in range(2)]
    assert cells == ["n (locale)", "4", "x", "4"]
    assert t.editor.textCursor().blockNumber() == 1
    t.resume()
    qtbot.waitUntil(lambda: "Programma finito" in t.status.text(), timeout=5000)
    assert t.output.toPlainText() == "12"
    assert not t.b_resume.isEnabled() and t.b_step.text() == "Una riga alla volta"


@needs_sim
def test_screen_keys_and_g0(win, qtbot):
    connect(win, qtbot)
    t = tool(win)
    t.refresh_list()
    qtbot.waitUntil(lambda: t.polpo_files.count() >= 4, timeout=5000)
    t.open_from_polpo("dado.polpo")
    qtbot.waitUntil(lambda: t.editor.toPlainText().startswith("# Dado"), timeout=5000)
    assert t.name.text() == "dado"
    t.run()
    qtbot.waitUntil(lambda: "In esecuzione" in t.status.text(), timeout=8000)
    # il dado si vede sullo schermo del Polpo virtuale: un quadrato bianco
    def white():
        pm = t.screen.pixmap()
        if pm is None or pm.isNull():
            return 0
        img = pm.toImage()
        return sum(1 for x in range(0, 480, 8) for y in range(0, 270, 8) if img.pixelColor(x, y).lightness() > 240)
    qtbot.waitUntil(lambda: white() > 100, timeout=5000)
    shot(win, "modulo_script")
    # Invio sullo schermo lancia il dado: otto suoni nel registro del firmware simulato
    before = t.screen.last_hash
    qtbot.keyClick(t.screen, Qt.Key.Key_Return)
    qtbot.waitUntil(lambda: t.screen.last_hash != before, timeout=5000)
    t.press_g0()
    qtbot.waitUntil(lambda: "Programma fermato" in t.status.text(), timeout=5000)
    assert not t.b_stop.isEnabled()


@needs_sim
def test_stop_from_studio(win, qtbot):
    connect(win, qtbot)
    t = tool(win)
    t.editor.setPlainText("ripeti sempre\n  aspetta(50)\nfine\n")
    t.run()
    qtbot.waitUntil(lambda: t.b_stop.isEnabled(), timeout=8000)
    t.stop()
    qtbot.waitUntil(lambda: "Programma fermato" in t.status.text(), timeout=5000)
    # un secondo avvio mentre un programma gira ferma quello di prima
    t.run()
    qtbot.waitUntil(lambda: t.b_stop.isEnabled(), timeout=8000)
    t.run()
    qtbot.waitUntil(lambda: "In esecuzione" in t.status.text() and t.b_stop.isEnabled(), timeout=8000)
    t.stop()
    qtbot.waitUntil(lambda: not t.b_stop.isEnabled(), timeout=5000)


def test_without_firmware_file_the_virtual_polpo_says_why(win, qtbot, tmp_path, monkeypatch):
    monkeypatch.setattr(firmware_sim, "wasm_path", lambda: tmp_path / "manca.wasm")
    connect(win, qtbot)
    t = tool(win)
    t.check()
    qtbot.waitUntil(lambda: "polpo-sim.wasm" in t.status.text(), timeout=5000)
    assert "non può eseguire gli script" in t.status.text()
