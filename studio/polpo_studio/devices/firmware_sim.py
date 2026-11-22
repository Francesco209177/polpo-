"""Il firmware vero del Polpo eseguito sul PC: lo stesso file WebAssembly del simulatore del sito.

Serve al Polpo virtuale per i programmi PolpoScript: così un programma si comporta in Polpo Studio esattamente
come sul dispositivo, perché a eseguirlo è lo stesso codice. Tutto ciò che sta intorno (tasti, tempo, microSD)
è simulato. Il file ``polpo-sim.wasm`` viene costruito da ``polpo/sim/scripts/compila_web.sh`` (nei pacchetti lo
mette la CI); senza quel file, o senza la libreria ``wasmtime``, gli script nel Polpo virtuale non sono disponibili.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

WIDTH, HEIGHT = 240, 135
WASM = Path(__file__).resolve().parent.parent / "resources" / "polpo-sim.wasm"

# Tastiera del Cardputer: fila e colonna dei tasti che servono a chi prova un programma.
_ROWS = ("`1234567890-=\b", "\tqwertyuiop[]\\", "\0\0asdfghjkl;'\r", "\0\0\0zxcvbnm,./ ")
KEYS: dict[str, tuple[int, int]] = {ch: (r, c) for r, row in enumerate(_ROWS) for c, ch in enumerate(row) if ch != "\0"}
KEYS.update({"ok": KEYS["\r"], "indietro": KEYS["`"], "su": KEYS[";"], "giu": KEYS["."], "sinistra": KEYS[","],
             "destra": KEYS["/"], "spazio": KEYS[" "], "canc": KEYS["\b"], "tab": KEYS["\t"]})  # fmt: skip


class FirmwareSimUnavailable(Exception):
    """Manca il file del firmware simulato o la libreria per eseguirlo."""


def unavailable_reason(wasm: Path | None = None) -> str | None:
    """None se il firmware simulato si può usare, altrimenti il motivo (in italiano)."""
    if not (wasm or WASM).is_file():
        return "manca il file del firmware simulato (polpo-sim.wasm)"
    try:
        import wasmtime  # noqa: F401
    except Exception as e:  # la libreria ha una parte nativa: può mancare o non caricarsi
        return f"la libreria wasmtime non è disponibile ({e})"
    return None


class FirmwareSim:
    """Un Polpo simulato. Tutti i metodi si possono chiamare da più thread: uno alla volta."""

    def __init__(self, wasm: Path | None = None) -> None:
        reason = unavailable_reason(wasm)
        if reason:
            raise FirmwareSimUnavailable(reason)
        import wasmtime

        self._lock = threading.RLock()
        engine = wasmtime.Engine()
        module = wasmtime.Module.from_file(engine, str(wasm or WASM))
        self._store = wasmtime.Store(engine)
        linker = wasmtime.Linker(engine)
        # l'unica cosa che il modulo chiede a chi lo ospita: un avviso (ignorato) quando gli serve più memoria
        linker.define_func("env", "emscripten_notify_memory_growth", wasmtime.FuncType([wasmtime.ValType.i32()], []), lambda _i: None)
        exports = linker.instantiate(self._store, module).exports(self._store)
        self._x = {name: exports[name] for name in exports.keys()}
        self._mem = self._x["memory"]
        if "_initialize" in self._x:
            self._x["_initialize"](self._store)
        self.started = False

    # ---------------- interno ----------------

    def _call(self, name: str, *args: int) -> int:
        return self._x[name](self._store, *args)

    def _text_at(self, ptr: int) -> str | None:
        if not ptr:
            return None
        size = self._mem.data_len(self._store)
        end = ptr
        while end < size:  # a blocchi, fino allo zero finale
            chunk = bytes(self._mem.read(self._store, end, min(end + 4096, size)))
            zero = chunk.find(b"\0")
            if zero >= 0:
                end += zero
                break
            end += len(chunk)
        return bytes(self._mem.read(self._store, ptr, end)).decode("utf-8", "replace")

    def _json_call(self, name: str, command: dict[str, Any]) -> dict[str, Any]:
        raw = json.dumps(command, ensure_ascii=False).encode("utf-8") + b"\0"
        with self._lock:
            ptr = self._call("sim_alloca", len(raw))
            try:
                self._mem.write(self._store, raw, ptr)
                text = self._text_at(self._call(name, ptr))
            finally:
                self._call("sim_libera", ptr)
        return json.loads(text or "{}")

    # ---------------- uso ----------------

    def start(self) -> None:
        with self._lock:
            if not self.started:
                self._call("sim_avvia")
                self.started = True

    def advance(self, ms: int) -> None:
        """Fa passare ``ms`` millisecondi dell'orologio del Polpo simulato."""
        with self._lock:
            self._call("sim_avanza", max(0, int(ms)))

    def script(self, command: dict[str, Any]) -> dict[str, Any]:
        """Comandi per i programmi PolpoScript (vedi ``sim_script`` in polpo/sim/host/sim.h)."""
        return self._json_call("sim_script", command)

    def world(self, command: dict[str, Any]) -> dict[str, Any]:
        return self._json_call("sim_mondo", command)

    def events(self) -> list[dict[str, Any]]:
        out = []
        with self._lock:
            while True:
                text = self._text_at(self._call("sim_evento"))
                if text is None:
                    return out
                out.append(json.loads(text))

    def key(self, name: str, down: bool) -> bool:
        """Preme o rilascia un tasto: un carattere oppure ok, indietro, su, giu, sinistra, destra, spazio, canc, tab."""
        place = KEYS.get(name if len(name) != 1 else name.lower())
        if place is None:
            return False
        with self._lock:
            self._call("sim_tasto", place[0], place[1], 1 if down else 0)
        return True

    def g0(self) -> None:
        with self._lock:
            self._call("sim_g0")

    def screen_rgb565(self) -> bytes:
        """Lo schermo: 240 x 135 punti a 16 bit (RGB565, byte più significativo per primo)."""
        with self._lock:
            ptr = self._call("sim_schermo")
            return bytes(self._mem.read(self._store, ptr, ptr + WIDTH * HEIGHT * 2))

    def screen_hash(self) -> int:
        with self._lock:
            return self._call("sim_impronta_schermo") & 0xFFFFFFFF
