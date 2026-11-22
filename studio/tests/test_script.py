"""Programmi PolpoScript nel Polpo virtuale: li esegue il firmware vero (polpo-sim.wasm caricato con wasmtime)."""

import json
import os
import re

import pytest

from polpo_studio.devices import firmware_sim
from polpo_studio.devices.virtual_polpo import VirtualPolpo

from .conftest import REPO
from .helpers import LineCollector, send

FAST = dict(time_scale=0.01, latency=0.0, auto_confirm_delay=0.5)
MISSING = firmware_sim.unavailable_reason()
if MISSING and os.environ.get("POLPO_FIRMWARE_SIM") == "obbligatorio":
    raise RuntimeError(f"firmware simulato non disponibile: {MISSING} (costruiscilo con studio/scripts/firmware_sim.sh)")
pytestmark = pytest.mark.skipif(bool(MISSING), reason=f"firmware simulato non disponibile: {MISSING}")

COUNT = 'funzione doppio(n)\n  ritorna n * 2\nfine\ntotale = 0\nper i da 1 a 3\n  totale = totale + doppio(i)\n  scrivi("giro", i, totale)\nfine\n'


def device(**kw):
    d = VirtualPolpo(**{**FAST, **kw})
    out = LineCollector()
    d.attach(out)
    d.out = out
    return d


@pytest.fixture
def dev():
    d = device()
    send(d, 1, "hello", {"client": "test"})
    assert d.out.reply(1)["ok"]
    yield d
    d.shutdown()


def put(dev, name, text):
    dev.files[f"/polpo/script/{name}"] = text.encode()
    return f"/polpo/script/{name}"


def test_firmware_sim_runs_a_program_by_itself():
    sim = firmware_sim.FirmwareSim()
    sim.start()
    sim.advance(300)
    assert len(sim.screen_rgb565()) == 240 * 135 * 2
    assert sim.script({"cmd": "scrivi", "file": "/polpo/script/a.polpo", "testo": "scrivi(1 / 3, seno(30), [1, \"è\"])\n"})["ok"]
    assert sim.script({"cmd": "controlla", "file": "/polpo/script/a.polpo"})["valido"] is True
    assert sim.script({"cmd": "apri", "file": "/polpo/script/a.polpo"})["ok"]
    sim.advance(200)
    events = [e for e in sim.events() if e["tipo"].startswith("script.")]
    assert events == [
        {"tipo": "script.print", "riga": 0, "testo": '0.333333 0.5 [1, "è"]'},
        {"tipo": "script.end", "riga": 1, "testo": ""},
    ]
    # i tasti arrivano al programma
    sim.key("a", True)
    sim.advance(100)
    sim.key("a", False)
    sim.advance(200)
    assert sim.script({"cmd": "stato"})["stato"] == "none"  # a programma finito un tasto chiude la schermata


def test_examples_from_the_sd_are_there(dev):
    send(dev, 2, "fs.list", {"path": "/polpo/script"})
    names = {e["name"] for e in dev.out.reply(2)["data"]["entries"]}
    assert {"pallina.polpo", "indovina.polpo", "dado.polpo", "serpente.polpo", "dati"} <= names
    for n in ("pallina", "indovina", "dado", "serpente"):
        send(dev, 3, "script.check", {"file": f"/polpo/script/{n}.polpo"})
        assert dev.out.reply(3)["data"] == {"valid": True, "line": 0, "message": ""}, n


def test_check_reports_line_and_hint(dev):
    path = put(dev, "sbagliato.polpo", 'scrivi("uno")\ncerhio(10, 10, 5, ROSSO)\n')
    send(dev, 2, "script.check", {"file": path})
    assert dev.out.reply(2)["data"] == {"valid": False, "line": 2, "message": "non conosco la funzione «cerhio». Forse volevi «cerchio»?"}
    path = put(dev, "rovinato.polpo", "scrivi(1)\n")
    dev.files[path] = b"scrivi(\xff)\n"
    send(dev, 3, "script.check", {"file": path})
    assert dev.out.reply(3)["data"]["valid"] is False


def test_run_needs_confirmation_and_streams_output(dev):
    path = put(dev, "conta.polpo", COUNT)
    send(dev, 2, "script.run", {"file": path})
    send(dev, 3, "script.state")  # durante la conferma il Polpo è occupato
    assert dev.out.reply(3)["error"]["code"] == "busy"
    assert dev.out.reply(2) == {"id": 2, "ok": True, "data": {}}
    assert [dev.out.event("script.print")["data"]["text"] for _ in range(3)] == ["giro 1 2", "giro 2 6", "giro 3 12"]
    assert dev.out.event("script.end")["data"] == {"line": 5, "error": ""}
    send(dev, 4, "script.state")
    assert dev.out.reply(4)["data"] == {"state": "done", "line": 5, "file": path, "error": "", "vars": [], "stack": []}
    # un programma finito lascia il posto a un nuovo avvio
    send(dev, 5, "script.run", {"file": path})
    assert dev.out.reply(5)["ok"]
    assert dev.out.event("script.end")["data"]["error"] == ""


def test_run_denied_on_the_device_screen():
    d = device(confirm_handler=lambda title, body, respond: respond(False))
    d.session = True
    path = put(d, "conta.polpo", COUNT)
    send(d, 2, "script.run", {"file": path})
    assert d.out.reply(2)["error"] == {"code": "denied", "msg": "rifiutato sul Polpo"}
    send(d, 3, "script.state")
    assert d.out.reply(3)["data"]["state"] == "none"
    d.shutdown()


def test_confirmation_text_says_what_a_script_can_do():
    asked = []
    d = device(confirm_handler=lambda title, body, respond: (asked.append((title, body)), respond(True)))
    d.session = True
    send(d, 2, "script.run", {"file": put(d, "conta.polpo", COUNT)})
    assert d.out.reply(2)["ok"]
    assert asked == [("Eseguire lo script?", "Il PC chiede di avviare conta.polpo. Uno script disegna, suona e legge i tasti: non trasmette niente.")]
    d.shutdown()


def test_runtime_error_is_reported_with_its_line(dev):
    path = put(dev, "rotto.polpo", 'scrivi("prima")\nx = 10 / 0\n')
    send(dev, 2, "script.run", {"file": path})
    assert dev.out.reply(2)["ok"]
    assert dev.out.event("script.print")["data"]["text"] == "prima"
    assert dev.out.event("script.end")["data"] == {"line": 2, "error": "Riga 2: non si può dividere per zero"}


def test_step_by_step_with_variables(dev):
    path = put(dev, "conta.polpo", COUNT)
    send(dev, 2, "script.run", {"file": path, "paused": True})
    assert dev.out.reply(2)["ok"]
    assert dev.out.event("script.paused")["data"] == {"line": 1}
    send(dev, 3, "script.breakpoints", {"lines": [2]})
    assert dev.out.reply(3)["ok"]
    send(dev, 4, "script.resume")
    assert dev.out.reply(4)["ok"]
    assert dev.out.event("script.paused")["data"] == {"line": 2}
    send(dev, 5, "script.state", {"vars": True})
    state = dev.out.reply(5)["data"]
    assert state["state"] == "paused" and state["line"] == 2
    assert state["vars"] == [
        {"name": "n", "value": "1", "local": True},
        {"name": "totale", "value": "0", "local": False},
        {"name": "i", "value": "1", "local": False},
    ]
    assert state["stack"] == [{"function": "doppio", "line": 2}, {"function": "", "line": 6}]
    send(dev, 6, "script.step", {"mode": "out"})
    assert dev.out.reply(6)["ok"]
    assert dev.out.event("script.paused")["data"] == {"line": 7}
    send(dev, 7, "script.step", {"mode": "sideways"})
    assert dev.out.reply(7)["error"]["code"] == "bad_args"
    send(dev, 8, "script.breakpoints", {"lines": list(range(40))})
    assert dev.out.reply(8)["error"]["code"] == "bad_args"
    send(dev, 9, "script.breakpoints", {"lines": []})
    assert dev.out.reply(9)["ok"]
    send(dev, 10, "script.resume")
    assert dev.out.reply(10)["ok"]
    assert dev.out.event("script.end")["data"] == {"line": 5, "error": ""}


def test_stop_and_only_one_at_a_time(dev):
    path = put(dev, "attesa.polpo", "ripeti sempre\n  aspetta(50)\nfine\n")
    send(dev, 2, "script.run", {"file": path})
    assert dev.out.reply(2)["ok"]
    send(dev, 3, "script.run", {"file": path})
    assert dev.out.reply(3)["error"] == {"code": "busy", "msg": "c'è già un programma in esecuzione sul Polpo"}
    send(dev, 4, "script.stop")
    assert dev.out.reply(4)["ok"]
    assert dev.out.event("script.end")["data"]["stopped"] is True
    send(dev, 5, "script.stop")
    assert dev.out.reply(5)["error"] == {"code": "bad_args", "msg": "nessun programma aperto sul Polpo"}


def test_closing_the_link_closes_the_program(dev):
    send(dev, 2, "script.run", {"file": put(dev, "attesa.polpo", "ripeti sempre\n  aspetta(50)\nfine\n")})
    assert dev.out.reply(2)["ok"]
    send(dev, 3, "bye")
    assert dev.out.event("script.end")["data"]["stopped"] is True


def test_only_polpo_files_inside_the_script_folder(dev):
    for bad in ("/polpo/badusb/ciao_linux.txt", "/polpo/script/../badusb/x.polpo", "/polpo/LEGGIMI.txt", "/polpo/script/.polpo", ""):
        for cmd in ("script.run", "script.check"):
            send(dev, 2, cmd, {"file": bad})
            assert dev.out.reply(2)["error"] == {"code": "bad_args", "msg": "serve un file .polpo dentro /polpo/script"}, (cmd, bad)
    send(dev, 3, "script.run", {"file": "/polpo/script/manca.polpo"})
    assert dev.out.reply(3)["error"]["code"] == "io_error"


def test_without_the_firmware_file_scripts_are_unsupported(tmp_path):
    d = device(firmware_wasm=tmp_path / "manca.wasm")
    d.session = True
    send(d, 2, "script.check", {"file": put(d, "conta.polpo", COUNT)})
    err = d.out.reply(2)["error"]
    assert err["code"] == "unsupported" and "polpo-sim.wasm" in err["msg"]
    send(d, 3, "script.state")
    assert d.out.reply(3)["data"]["state"] == "none"
    d.shutdown()


def test_same_answers_as_the_real_firmware(dev):
    """Le risposte del Polpo virtuale ai comandi script.* sono quelle del firmware (scenario 12 del simulatore)."""
    scenario = (REPO / "polpo/sim/tests/12_link_script.copione").read_text(encoding="utf-8").splitlines()
    expected = {}
    for line in (REPO / "polpo/sim/tests/12_link_script.atteso").read_text(encoding="utf-8").splitlines():
        if line.startswith("< ") and '"id"' in line:
            obj = json.loads(line[2:])
            expected[obj["id"]] = obj
    for line in scenario:  # gli stessi file dello scenario
        if line.startswith("script ") and '"scrivi"' in line:
            c = json.loads(line[7:])
            dev.files[c["file"]] = c["testo"].encode()
    compared = 0
    for line in scenario:
        m = re.match(r"seriale (\{.*\})$", line)
        if not m:
            continue
        req = json.loads(m.group(1))
        if req["id"] not in (3, 4, 5, 6, 7, 8, 9, 10):  # quelli che non dipendono da ciò che succede sullo schermo
            continue
        send(dev, req["id"], req["cmd"], req.get("args"))
        assert dev.out.reply(req["id"]) == expected[req["id"]], line
        compared += 1
    assert compared == 8
