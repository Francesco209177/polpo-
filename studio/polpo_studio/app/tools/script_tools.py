"""Modulo Script: mini-app in PolpoScript (vedi polpo/docs/POLPOSCRIPT.md).

Si scrive il programma qui, lo si copia sulla microSD del Polpo (cartella /polpo/script) e lo si fa controllare ed
eseguire al Polpo, anche una riga alla volta guardando le variabili. L'avvio chiede sempre conferma sullo schermo del
Polpo. Con il Polpo virtuale a eseguirlo è il firmware vero compilato per il PC: qui se ne vede lo schermo e lo si
comanda con la tastiera del computer.

Uno script può disegnare, suonare, leggere i tasti e tenere piccoli file nella sua cartella: il linguaggio non ha
funzioni per trasmettere né per scrivere come una tastiera USB.
"""

from __future__ import annotations

import array
import re
import sys
import time
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontDatabase, QImage, QPixmap, QTextCursor, QTextFormat
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
)

from ...core.i18n import tr
from ...devices.firmware_sim import HEIGHT, WIDTH
from ...paths import data_dir
from ..widgets import Card, Note, label
from .common import ToolBase, button_row, sim_suffix

FOLDER = "/polpo/script"
MAX_SOURCE = 16 * 1024  # come il firmware
NAME = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
EXAMPLE = 'scrivi("Ciao!")\nper i da 1 a 5\n  scrivi(i, "per", i, "fa", i * i)\nfine\n'
ERROR_COLOR = QColor(255, 84, 84, 70)
CURRENT_COLOR = QColor(92, 200, 255, 80)

# Tasti del computer -> tasti del Polpo (per lo schermo del Polpo virtuale)
QT_KEYS = {
    Qt.Key.Key_Up: "su", Qt.Key.Key_Down: "giu", Qt.Key.Key_Left: "sinistra", Qt.Key.Key_Right: "destra",
    Qt.Key.Key_Return: "ok", Qt.Key.Key_Enter: "ok", Qt.Key.Key_Escape: "indietro", Qt.Key.Key_Backspace: "canc",
    Qt.Key.Key_Space: "spazio",
}  # fmt: skip


def rgb565_to_image(data: bytes) -> QImage:
    """Lo schermo del Polpo (RGB565 con il byte più significativo per primo) come immagine."""
    pixels = array.array("H", data)
    if sys.byteorder == "little":
        pixels.byteswap()
    return QImage(pixels.tobytes(), WIDTH, HEIGHT, WIDTH * 2, QImage.Format.Format_RGB16).copy()


class PolpoScreen(QLabel):
    """Lo schermo del Polpo virtuale: si vede ciò che disegna il programma e lo si comanda con la tastiera."""

    def __init__(self, tools: ScriptTools) -> None:
        super().__init__()
        self.tools = tools
        self.setFixedSize(WIDTH * 2, HEIGHT * 2)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setStyleSheet("background: #000; border-radius: 6px;")
        self.setAccessibleName(tr("Schermo del Polpo virtuale", "Virtual Polpo screen"))
        self._down: dict[int, tuple[str, float]] = {}
        self.last_hash: int | None = None

    def show_screen(self, data: bytes) -> None:
        img = rgb565_to_image(data).scaled(WIDTH * 2, HEIGHT * 2, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.FastTransformation)
        self.setPixmap(QPixmap.fromImage(img))

    def _name(self, event) -> str | None:
        name = QT_KEYS.get(event.key())
        if name:
            return name
        text = event.text()
        return text.lower() if len(text) == 1 and text.isprintable() and text != "`" else None

    def keyPressEvent(self, event) -> None:  # noqa: N802 (Qt)
        dev = self.tools.virtual_device()
        name = self._name(event)
        if dev is None or name is None:
            return super().keyPressEvent(event)
        if not event.isAutoRepeat() and event.key() not in self._down:
            self._down[event.key()] = (name, time.monotonic())
            dev.script_key(name, True)
        event.accept()

    def keyReleaseEvent(self, event) -> None:  # noqa: N802 (Qt)
        if event.isAutoRepeat() or event.key() not in self._down:
            return super().keyReleaseEvent(event)
        name, since = self._down.pop(event.key())
        dev = self.tools.virtual_device()
        if dev is not None:
            # un tocco brevissimo deve durare abbastanza perché il firmware lo legga
            wait = max(0, int(80 - (time.monotonic() - since) * 1000))
            QTimer.singleShot(wait, lambda: dev.script_key(name, False))
        event.accept()

    def focusOutEvent(self, event) -> None:  # noqa: N802 (Qt)
        dev = self.tools.virtual_device()
        for name, _since in self._down.values():  # nessun tasto deve restare giù
            if dev is not None:
                dev.script_key(name, False)
        self._down.clear()
        super().focusOutEvent(event)


class ScriptTools(ToolBase):
    category = "script"

    def __init__(self, ctx, bridge) -> None:
        super().__init__(ctx, bridge)
        self._open = False  # c'è un programma aperto sul Polpo
        self._paused = False
        self._seen = ""  # l'ultimo evento ricevuto dopo l'avvio («paused», «end»): può arrivare prima della risposta
        self._draft = data_dir() / "script_bozza.polpo"

        self.root.addWidget(
            Note(
                tr(
                    "Scrivi una mini-app in PolpoScript, il linguaggio in italiano del Polpo. Il programma viene copiato "
                    "nella cartella /polpo/script della microSD; l'avvio chiede conferma sullo schermo del Polpo. "
                    "Uno script disegna, suona e legge i tasti: non può trasmettere niente.",
                    "Write a mini-app in PolpoScript, the Polpo's Italian-keyword language. The program is copied to the "
                    "/polpo/script folder of the microSD; starting it asks for confirmation on the Polpo screen. "
                    "A script draws, plays sounds and reads keys: it cannot transmit anything.",
                )
            )
        )

        # ---- programma
        prog = Card(tr("Programma", "Program"))
        names = QHBoxLayout()
        names.addWidget(label(tr("Nome sul Polpo", "Name on the Polpo")))
        self.name = QLineEdit("prova")
        self.name.setMaxLength(40)
        self.name.setAccessibleName(tr("Nome del programma sul Polpo", "Program name on the Polpo"))
        names.addWidget(self.name, 1)
        names.addWidget(label(".polpo", muted=True))
        prog.body.addLayout(names)
        files, _ = button_row(
            (tr("Nuovo", "New"), self.new_program),
            (tr("Apri dal PC…", "Open from PC…"), self.open_from_pc),
            (tr("Salva sul PC…", "Save to PC…"), self.save_to_pc),
        )
        prog.body.addLayout(files)
        on_polpo = QHBoxLayout()
        self.polpo_files = QComboBox()
        self.polpo_files.setMinimumWidth(180)
        self.polpo_files.setAccessibleName(tr("Programmi sulla microSD del Polpo", "Programs on the Polpo microSD"))
        on_polpo.addWidget(label(tr("Sul Polpo", "On the Polpo")))
        on_polpo.addWidget(self.polpo_files, 1)
        self.b_list = QPushButton(tr("Aggiorna elenco", "Refresh list"))
        self.b_list.clicked.connect(self.refresh_list)
        self.b_load = QPushButton(tr("Apri", "Open"))
        self.b_load.clicked.connect(lambda: self.open_from_polpo())
        on_polpo.addWidget(self.b_list)
        on_polpo.addWidget(self.b_load)
        prog.body.addLayout(on_polpo)

        self.editor = QPlainTextEdit()
        font = QFontDatabase.systemFont(QFontDatabase.SystemFont.FixedFont)
        font.setStyleHint(QFont.StyleHint.Monospace)
        self.editor.setFont(font)
        self.editor.setTabStopDistance(self.editor.fontMetrics().horizontalAdvance(" ") * 2)
        self.editor.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        self.editor.setMinimumHeight(260)
        self.editor.setAccessibleName(tr("Testo del programma", "Program text"))
        self.editor.setPlainText(self._load_draft())
        self.editor.textChanged.connect(self._text_changed)
        self.editor.cursorPositionChanged.connect(self._cursor_moved)
        prog.body.addWidget(self.editor)
        self.where = label("", muted=True)
        prog.body.addWidget(self.where)
        run, buttons = button_row(
            (tr("Controlla", "Check"), self.check),
            (tr("Esegui", "Run"), self.run),
            (tr("Una riga alla volta", "One line at a time"), self.step),
            (tr("Riprendi", "Resume"), self.resume),
            (tr("Ferma", "Stop"), self.stop),
        )
        self.b_check, self.b_run, self.b_step, self.b_resume, self.b_stop = buttons
        self.b_run.setProperty("primary", "true")
        prog.body.addLayout(run)
        self.root.addWidget(prog)

        # ---- che cosa succede
        below = QHBoxLayout()
        self.screen_card = Card(tr("Schermo del Polpo virtuale", "Virtual Polpo screen"))
        self.screen = PolpoScreen(self)
        self.screen_card.body.addWidget(self.screen)
        g0row, g0 = button_row((tr("Tasto G0 (ferma)", "G0 key (stop)"), self.press_g0))
        self.b_g0 = g0[0]
        self.screen_card.body.addLayout(g0row)
        self.screen_card.body.addWidget(
            label(
                tr(
                    "Clicca sullo schermo e usa la tastiera del computer: frecce, Invio (OK), Esc (indietro), lettere e numeri. SIMULATO.",
                    "Click the screen and use the computer keyboard: arrows, Enter (OK), Esc (back), letters and numbers. SIMULATED.",
                ),
                muted=True,
                wrap=True,
            )
        )
        below.addWidget(self.screen_card, 0, Qt.AlignmentFlag.AlignTop)

        out = Card(tr("Che cosa fa", "What it does"))
        out.body.addWidget(label(tr("Variabili (quando è fermo su una riga)", "Variables (when stopped on a line)"), muted=True))
        self.vars = QTableWidget(0, 2)
        self.vars.setHorizontalHeaderLabels([tr("Nome", "Name"), tr("Valore", "Value")])
        self.vars.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.vars.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.vars.verticalHeader().setVisible(False)
        self.vars.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.vars.setMinimumHeight(110)
        out.body.addWidget(self.vars)
        out.body.addWidget(label(tr("Ciò che il programma scrive", "What the program writes"), muted=True))
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setFont(font)
        self.output.setMaximumBlockCount(2000)
        self.output.setMinimumHeight(120)
        self.output.setAccessibleName(tr("Righe scritte dal programma", "Lines written by the program"))
        out.body.addWidget(self.output)
        below.addWidget(out, 1)
        self.root.addLayout(below)
        self.finish()

        self.on_polpo_event("script.print", self._on_print)
        self.on_polpo_event("script.paused", self._on_paused)
        self.on_polpo_event("script.end", self._on_end)
        self._timer = QTimer(self)
        self._timer.setInterval(50)
        self._timer.timeout.connect(self._refresh_screen)
        self._timer.start()
        self.on_connection_changed()
        self._cursor_moved()

    # ---------------- stato ----------------

    def virtual_device(self):
        """Il Polpo virtuale, se è quello collegato."""
        if not (self.connected and self.simulated):
            return None
        return getattr(self.ctx.devices, "virtual", None)

    def on_connection_changed(self) -> None:
        if not self.connected:
            self._open = self._paused = False
        self.screen_card.setVisible(self.virtual_device() is not None)
        self._update_buttons()

    def _update_buttons(self) -> None:
        c = self.connected
        for b in (self.b_check, self.b_run, self.b_step, self.b_list, self.b_load):
            b.setEnabled(c)
        self.b_step.setText(tr("Riga successiva", "Next line") if self._paused else tr("Una riga alla volta", "One line at a time"))
        self.b_resume.setEnabled(c and self._paused)
        self.b_stop.setEnabled(c and self._open)
        self.b_g0.setEnabled(c)

    def _text_changed(self) -> None:
        self._mark_line(0, None)
        try:
            self._draft.write_text(self.editor.toPlainText(), encoding="utf-8")
        except OSError:
            pass  # la bozza è solo una comodità

    def _load_draft(self) -> str:
        try:
            if self._draft.is_file():
                return self._draft.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            pass
        return EXAMPLE

    def _cursor_moved(self) -> None:
        c = self.editor.textCursor()
        self.where.setText(tr("Riga {r}, colonna {c}", "Line {r}, column {c}", r=c.blockNumber() + 1, c=c.positionInBlock() + 1))

    def _mark_line(self, line: int, color: QColor | None) -> None:
        """Evidenzia una riga (errore o riga su cui il programma è fermo) e ci porta il cursore."""
        if not line or color is None:
            self.editor.setExtraSelections([])
            return
        block = self.editor.document().findBlockByNumber(line - 1)
        if not block.isValid():
            return
        sel = QTextEdit.ExtraSelection()
        sel.format.setBackground(color)
        sel.format.setProperty(QTextFormat.Property.FullWidthSelection, True)
        cursor = QTextCursor(block)
        sel.cursor = cursor
        self.editor.setExtraSelections([sel])
        self.editor.blockSignals(True)  # spostare il cursore non deve cancellare l'evidenziazione
        self.editor.setTextCursor(cursor)
        self.editor.blockSignals(False)
        self.editor.ensureCursorVisible()
        self._cursor_moved()

    # ---------------- file ----------------

    def path(self) -> str | None:
        name = self.name.text().strip()
        if name.lower().endswith(".polpo"):
            name = name[:-6]
        if not NAME.match(name):
            self.say(tr("Il nome può avere solo lettere senza accenti, cifre, «_» e «-» (al massimo 40).", "The name may only contain plain letters, digits, “_” and “-” (40 at most)."), True)
            return None
        return f"{FOLDER}/{name}.polpo"

    def source(self) -> bytes | None:
        text = self.editor.toPlainText()
        if not text.endswith("\n"):
            text += "\n"
        data = text.encode("utf-8")
        if len(data) > MAX_SOURCE:
            self.say(tr("Il programma è troppo lungo (al massimo 16.000 caratteri).", "The program is too long (16,000 characters at most)."), True)
            return None
        return data

    def new_program(self) -> None:
        self.editor.setPlainText(EXAMPLE)
        self.name.setText("prova")
        self.output.clear()
        self.say(tr("Nuovo programma.", "New program."))

    def open_from_pc(self, path: str | None = None) -> None:
        if path is None:
            path, _ = QFileDialog.getOpenFileName(self, tr("Apri un programma", "Open a program"), "", "PolpoScript (*.polpo);;" + tr("Testo", "Text") + " (*.txt)")
        if not path:
            return
        p = Path(path)
        try:
            if p.stat().st_size > MAX_SOURCE:
                raise ValueError(tr("il file è più lungo di 16.000 caratteri", "the file is longer than 16,000 characters"))
            text = p.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError, ValueError) as e:
            self.say(tr("Non riesco ad aprire il file: {e}", "Cannot open the file: {e}", e=e), True)
            return
        self.editor.setPlainText(text)
        stem = re.sub(r"[^A-Za-z0-9_-]", "_", p.stem)[:40] or "prova"
        self.name.setText(stem)
        self.say(tr("Aperto {f}.", "Opened {f}.", f=p.name))

    def save_to_pc(self, path: str | None = None) -> None:
        if path is None:
            name = (self.name.text().strip() or "prova") + ".polpo"
            path, _ = QFileDialog.getSaveFileName(self, tr("Salva il programma", "Save the program"), name, "PolpoScript (*.polpo)")
        if not path:
            return
        data = self.source()
        if data is None:
            return
        try:
            Path(path).write_bytes(data)
        except OSError as e:
            self.say(tr("Non riesco a salvare: {e}", "Cannot save: {e}", e=e), True)
            return
        self.say(tr("Salvato in {f}.", "Saved to {f}.", f=path))

    def refresh_list(self) -> None:
        def ok(d: dict) -> None:
            current = self.polpo_files.currentText()
            self.polpo_files.clear()
            for e in sorted(d.get("entries") or [], key=lambda e: e.get("name", "")):
                if not e.get("dir") and str(e.get("name", "")).endswith(".polpo"):
                    self.polpo_files.addItem(e["name"])
            i = self.polpo_files.findText(current)
            if i >= 0:
                self.polpo_files.setCurrentIndex(i)
            self.say(tr("Programmi sul Polpo: {n}", "Programs on the Polpo: {n}", n=self.polpo_files.count()) + sim_suffix(self.simulated))

        self.req("fs.list", {"path": FOLDER}, ok)

    def open_from_polpo(self, name: str | None = None) -> None:
        name = name or self.polpo_files.currentText()
        if not name:
            self.say(tr("Scegli prima un programma (Aggiorna elenco).", "Pick a program first (Refresh list)."), True)
            return
        path = f"{FOLDER}/{name}"

        def ok(data: bytes) -> None:
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                self.say(tr("Il file non è un testo (UTF-8).", "The file is not text (UTF-8)."), True)
                return
            self.editor.setPlainText(text)
            self.name.setText(name[:-6] if name.endswith(".polpo") else name)
            self.say(tr("Aperto {f} dal Polpo.", "Opened {f} from the Polpo.", f=name) + sim_suffix(self.simulated))

        self.job(lambda c: c.read_file(path), ok)

    # ---------------- controllo ed esecuzione ----------------

    def _upload_and_check(self, client, path: str, data: bytes) -> dict:
        client.write_file(path, data)
        return client.call("script.check", {"file": path})

    def _show_check(self, r: dict) -> bool:
        if r.get("valid"):
            self._mark_line(0, None)
            return True
        line = int(r.get("line") or 0)
        msg = str(r.get("message") or tr("errore", "error"))
        self.say((tr("Riga {n}: ", "Line {n}: ", n=line) if line else "") + msg, True)
        self._mark_line(line, ERROR_COLOR)
        return False

    def check(self) -> None:
        path, data = self.path(), self.source()
        if not path or data is None:
            return

        def ok(r: dict) -> None:
            if self._show_check(r):
                self.say(tr("Nessun errore: il programma è scritto bene.", "No errors: the program is well written.") + sim_suffix(self.simulated))

        self.job(lambda c: self._upload_and_check(c, path, data), ok)

    def run(self, paused: bool = False) -> None:
        path, data = self.path(), self.source()
        if not path or data is None:
            return

        def prepare(c) -> dict:
            r = self._upload_and_check(c, path, data)
            if r.get("valid") and c.call("script.state").get("state") in ("running", "waiting", "paused"):
                # uno alla volta: quello di prima si ferma, e si aspetta che il Polpo lo abbia chiuso, così la notizia
                # della sua fine arriva prima di quella del programma nuovo
                c.call("script.stop")
                deadline = time.monotonic() + 3.0
                while c.call("script.state").get("state") != "none" and time.monotonic() < deadline:
                    time.sleep(0.05)
            return r

        def started(_d: dict) -> None:
            self.ctx.activity.add(self.category, tr("Script avviato: {f}", "Script started: {f}", f=path.rsplit("/", 1)[-1]), "info", self.simulated)
            if self._seen:  # il programma si è già fermato su una riga o è già finito: lo stato è già giusto
                return
            self._open = True
            self._update_buttons()
            self.say((tr("Pronto: una riga alla volta.", "Ready: one line at a time.") if paused else tr("In esecuzione sul Polpo.", "Running on the Polpo.")) + sim_suffix(self.simulated))
            if not paused and self.virtual_device() is not None:
                self.screen.setFocus()  # le frecce vanno subito al gioco

        def checked(r: dict) -> None:
            if not self._show_check(r):
                return
            # da qui in poi gli eventi riguardano il programma nuovo (anche prima della risposta a script.run)
            self._seen = ""
            self._open = self._paused = False
            self.output.clear()
            self.vars.setRowCount(0)
            self._update_buttons()
            self.say(tr("Chiedo di avviarlo: conferma sullo schermo del Polpo.", "Asking to start it: confirm on the Polpo screen."))
            self.req("script.run", {"file": path, "paused": paused}, started, timeout=35.0)

        self.say(tr("Copio il programma sul Polpo…", "Copying the program to the Polpo…"))
        self.job(prepare, checked)

    def step(self) -> None:
        if self._paused:
            self.req("script.step", {"mode": "into"}, lambda _d: None)
        else:
            self.run(paused=True)

    def resume(self) -> None:
        def ok(_d: dict) -> None:
            if self._seen == "end":
                return
            self._paused = False
            self._mark_line(0, None)
            self.vars.setRowCount(0)
            self._update_buttons()
            self.say(tr("In esecuzione sul Polpo.", "Running on the Polpo.") + sim_suffix(self.simulated))

        self.req("script.resume", None, ok)

    def stop(self) -> None:
        self.req("script.stop", None, lambda _d: None)

    def press_g0(self) -> None:
        dev = self.virtual_device()
        if dev is not None:
            dev.script_g0()
        elif self._open:
            self.stop()  # sul Polpo vero il tasto G0 è sul dispositivo: da qui si ferma il programma

    # ---------------- eventi dal Polpo ----------------

    def _on_print(self, data: dict, _sim: bool) -> None:
        dropped = data.get("dropped")
        if dropped:
            self.output.appendPlainText(tr("(… {n} righe non mostrate: il programma scriveva troppo in fretta)", "(… {n} lines not shown: the program was writing too fast)", n=dropped))
        self.output.appendPlainText(str(data.get("text", "")))

    def _on_paused(self, data: dict, _sim: bool) -> None:
        self._seen = "paused"
        self._open, self._paused = True, True
        self._update_buttons()
        line = int(data.get("line") or 0)
        self._mark_line(line, CURRENT_COLOR)

        def ok(s: dict) -> None:
            self.vars.setRowCount(0)
            for v in s.get("vars") or []:
                r = self.vars.rowCount()
                self.vars.insertRow(r)
                name = str(v.get("name", "")) + (" " + tr("(locale)", "(local)") if v.get("local") else "")
                self.vars.setItem(r, 0, QTableWidgetItem(name))
                self.vars.setItem(r, 1, QTableWidgetItem(str(v.get("value", ""))))
            stack = s.get("stack") or []
            inside = tr(" (dentro «{f}»)", " (inside “{f}”)", f=stack[0].get("function")) if len(stack) > 1 else ""
            self.say(tr("Fermo alla riga {n}", "Stopped at line {n}", n=s.get("line", line)) + inside + sim_suffix(self.simulated))

        self.req("script.state", {"vars": True}, ok)

    def _on_end(self, data: dict, sim: bool) -> None:
        self._seen = "end"
        self._open = self._paused = False
        self.vars.setRowCount(0)
        self._update_buttons()
        error = str(data.get("error") or "")
        if error:
            self.say(error, True)
            self._mark_line(int(data.get("line") or 0), ERROR_COLOR)
            self.ctx.activity.add(self.category, tr("Script fermato da un errore: {e}", "Script stopped by an error: {e}", e=error), "errore", sim)
        else:
            self._mark_line(0, None)
            stopped = bool(data.get("stopped"))
            self.say((tr("Programma fermato.", "Program stopped.") if stopped else tr("Programma finito.", "Program finished.")) + sim_suffix(sim))

    # ---------------- schermo del Polpo virtuale ----------------

    def _refresh_screen(self) -> None:
        dev = self.virtual_device()
        if dev is None or not self.isVisible():
            return
        h = dev.script_screen_hash()
        if h is None or h == self.screen.last_hash:
            return
        data = dev.script_screen()
        if data:
            self.screen.last_hash = h
            self.screen.show_screen(data)
