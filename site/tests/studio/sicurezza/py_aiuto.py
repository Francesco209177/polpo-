"""Aiuto per le prove di compatibilità tra la sicurezza di Polpo Studio (Python) e la sua porta in JavaScript.

Uso:  python -I py_aiuto.py <comando>     argomenti in JSON sullo standard input, risultato in JSON sull'uscita.
Lo usano le prove di compatibilita.test.mjs con l'interprete indicato da POLPO_PYTHON (polpo_studio installato).
I byte viaggiano in base64.
"""

from __future__ import annotations

import base64
import json
import struct
import sys
import zlib
from pathlib import Path

from polpo_studio.security import crypto
from polpo_studio.security.audit import AuditLog
from polpo_studio.security.backup import MAGIC, BackupError, export_backup, import_backup, read_backup
from polpo_studio.security.vault import Vault, VaultError


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def unb64(s: str) -> bytes:
    return base64.b64decode(s)


def canonico(raw: bytes, **kw) -> bool:
    """Vero se ``raw`` è esattamente ciò che scriverebbe json.dumps di Python."""
    try:
        return json.dumps(json.loads(raw), **kw).encode() == raw
    except ValueError:
        return False


def voce(v: Vault, it) -> dict:
    try:
        data = b64(v.get(it.id))
    except (crypto.IntegrityError, OSError):
        data = None  # file alterato o mancante: lo segnala verify()
    return {
        "id": it.id,
        "category": it.category,
        "name": it.name,
        "created": it.created,
        "modified": it.modified,
        "version": it.version,
        "size": it.size,
        "sha256": it.sha256,
        "origin": it.origin,
        "meta": it.meta,
        "data": data,
    }


def apri(a: dict) -> Vault:
    v = Vault(Path(a["cartella"]), kdf_n=a.get("n", crypto.KDF_N))
    if "recupero" in a:
        v.unlock_recovery(a["recupero"])
    else:
        v.unlock(a["frase"])
    return v


def errore(e: Exception) -> dict:
    return {"errore": type(e).__name__, "codice": getattr(e, "code", None), "messaggio": str(e)}


# ---------------- comandi ----------------


def cmd_vettori(a: dict) -> dict:
    out: dict = {
        "hkdf": [crypto.hkdf(unb64(k), info).hex() for k, info in a.get("hkdf", [])],
        "scrypt": [crypto.derive(unb64(s), unb64(sale), n, r, p).hex() for s, sale, n, r, p in a.get("scrypt", [])],
        "mac": [crypto.mac(unb64(k), unb64(d)) for k, d in a.get("mac", [])],
        "sha256": [crypto.sha256(unb64(d)) for d in a.get("sha256", [])],
        "sigillati": [b64(crypto.seal(unb64(k), unb64(d), unb64(aad))) for k, d, aad in a.get("sigilla", [])],
        "dissigillati": [],
        "recupero": [],
        "frasi": [crypto.passphrase_problems(t) for t in a.get("frasi", [])],
        "json": [],
        "base64": [],
        "nuove_chiavi": [crypto.new_recovery_key() for _ in range(5)],
    }
    for k, blob, aad in a.get("dissigilla", []):
        try:
            out["dissigillati"].append(b64(crypto.unseal(unb64(k), unb64(blob), unb64(aad))))
        except crypto.IntegrityError as e:
            out["dissigillati"].append("IntegrityError: " + str(e))
    for t in a.get("recupero", []):
        raw = crypto.normalize_recovery_key(t)
        out["recupero"].append(None if raw is None else raw.hex())
    for t in a.get("json", []):
        x = json.loads(t)
        out["json"].append([json.dumps(x), json.dumps(x, ensure_ascii=False), json.dumps(x, indent=2)])
    for t in a.get("base64", []):
        try:
            out["base64"].append(crypto.b64d(t).hex())
        except ValueError:
            out["base64"].append(None)
    return out


def cmd_crea(a: dict) -> dict:
    """Crea una cassaforte con voci, aggiornamenti, eliminazioni, PIN, registro e backup facoltativi."""
    v = Vault(Path(a["cartella"]), kdf_n=a.get("n", crypto.KDF_N))
    recupero = v.create(a["frase"])
    ids = []
    for x in a.get("voci", []):
        it = v.put(x["category"], x["name"], unb64(x["data"]), origin=x.get("origin", "reale"), meta=x.get("meta"))
        ids.append(it.id)
    for u in a.get("aggiornamenti", []):
        kw = {}
        if "data" in u:
            kw["data"] = unb64(u["data"])
        if "name" in u:
            kw["name"] = u["name"]
        if "meta" in u:
            kw["meta"] = u["meta"]
        if u.get("mark_simulated"):
            kw["mark_simulated"] = True
        v.update(ids[u["indice"]], **kw)
    for i in a.get("elimina", []):
        v.delete(ids[i])
    if a.get("pin"):
        v.set_pin(a["pin"])
    if a.get("registro"):
        log = AuditLog(v)
        for e in a["registro"]:
            log.append(e)
    out = {"recupero": recupero, "id": v.id, "voci": [voce(v, it) for it in v.items()]}
    if a.get("backup"):
        b = a["backup"]
        out["quanti"] = export_backup(v, Path(b["file"]), b["password"], kdf_n=b.get("n", crypto.KDF_N))
    v.lock()
    return out


def cmd_apri(a: dict) -> dict:
    """Apre una cassaforte (anche creata da JavaScript), la legge, la verifica e controlla la forma dei file."""
    try:
        v = apri(a)
    except VaultError as e:
        return errore(e)
    out = {
        "id": v.id,
        "voci": [voce(v, it) for it in v.items()],
        "cerca": [it.name for it in v.items(query=a["cerca"])] if "cerca" in a else None,
        "problemi": sorted([p.item_id, p.what] for p in v.verify()),
        "has_pin": v.has_pin,
        "stats": v.stats(),
        "kdf": v._keys["kdf"],
        "chiavi_canoniche": canonico(v.keys_path.read_bytes(), indent=2),
    }
    if v.index_path.exists():
        out["indice_canonico"] = canonico(crypto.unseal(v._key("index"), v.index_path.read_bytes(), v._index_aad()), ensure_ascii=False)
    if "pin_prove" in a:
        out["pin"] = [v.unlock_pin(p) for p in a["pin_prove"]]
        out["aperta_dopo_pin"] = v.unlocked
    if a.get("cambia_frase"):
        v.change_passphrase(a["frase"], a["cambia_frase"])
    if a.get("nuova_recupero"):
        out["nuova_recupero"] = v.new_recovery_key()
    if a.get("aggiungi"):
        for x in a["aggiungi"]:
            v.put(x["category"], x["name"], unb64(x["data"]), origin=x.get("origin", "reale"), meta=x.get("meta"))
    v.lock()
    return out


def cmd_registro(a: dict) -> dict:
    """Apre il registro della cassaforte, aggiunge voci (facoltativo), lo verifica e lo legge."""
    v = apri(a)
    log = AuditLog(v)
    for e in a.get("aggiungi", []):
        log.append(e)
    out = {"problemi": log.verify()}
    try:
        out["voci"] = log.read()
    except TypeError as e:  # AuditLog.read() non salta le righe JSON che non sono oggetti
        out["voci"] = None
        out["errore_lettura"] = str(e)
    if a.get("forma"):
        lines = log._lines() if log.path.exists() else []
        out["righe_canoniche"] = all(json.dumps(json.loads(x)) == x for x in lines)
        out["voci_canoniche"] = all(
            canonico(crypto.unseal(log._k_enc, crypto.b64d(json.loads(x)["c"]), log._aad("log", json.loads(x)["seq"])), ensure_ascii=False) for x in lines
        )
        if log.head_path.exists():
            out["testa_canonica"] = canonico(crypto.unseal(log._k_enc, log.head_path.read_bytes(), log._aad("log-head")))
    v.lock()
    return out


def cmd_leggi_backup(a: dict) -> dict:
    try:
        items = read_backup(Path(a["file"]), a["password"])
    except BackupError as e:
        return errore(e)
    out = {"voci": [{**it, "data": b64(it["data"])} for it in items]}
    raw = Path(a["file"]).read_bytes()
    (hlen,) = struct.unpack(">I", raw[len(MAGIC) : len(MAGIC) + 4])
    header = raw[len(MAGIC) + 4 : len(MAGIC) + 4 + hlen]
    h = json.loads(header)
    k = h["kdf"]
    key = crypto.derive(a["password"].encode(), crypto.b64d(k["salt"]), k["n"], k["r"], k["p"])
    payload = zlib.decompress(crypto.unseal(key, raw[len(MAGIC) + 4 + hlen :], header))
    out["intestazione"] = h
    out["intestazione_canonica"] = canonico(header)
    out["contenuto_canonico"] = canonico(payload, ensure_ascii=False)
    return out


def cmd_importa(a: dict) -> dict:
    """Crea una cassaforte nuova e vi importa due volte un backup."""
    v = Vault(Path(a["cartella"]), kdf_n=a.get("n", crypto.KDF_N))
    v.create(a["frase"])
    try:
        primo = import_backup(v, Path(a["file"]), a["password"])
        secondo = import_backup(v, Path(a["file"]), a["password"])
    except BackupError as e:
        return errore(e)
    out = {"primo": list(primo), "secondo": list(secondo), "voci": [voce(v, it) for it in v.items()]}
    v.lock()
    return out


def cmd_esporta(a: dict) -> dict:
    v = apri(a)
    quanti = export_backup(v, Path(a["file"]), a["password"], kdf_n=a.get("n_backup", crypto.KDF_N))
    v.lock()
    return {"quanti": quanti}


COMANDI = {name[4:]: fn for name, fn in globals().items() if name.startswith("cmd_")}

if __name__ == "__main__":
    argomenti = json.loads(sys.stdin.read() or "{}")
    json.dump(COMANDI[sys.argv[1]](argomenti), sys.stdout, ensure_ascii=False)
