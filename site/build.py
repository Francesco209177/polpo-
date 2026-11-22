#!/usr/bin/env python3
"""Assembla il sito del Polpo in una cartella pronta per GitHub Pages.

    python site/build.py --out _site --check

* applica il modello ``templates/base.html`` alle pagine in ``pages/``;
* copia il simulatore (senza caratteri da siti esterni) e gli aggiunge la barra del sito;
* copia il firmware da ``polpo/release``, ne calcola l'impronta e genera il manifest per ESP Web Tools;
* crea lo zip dei file per la microSD;
* converte i manuali Markdown in pagine;
* con ``--check`` fa fallire la build se trova link rotti o risorse caricate da siti esterni.

Unica dipendenza: il pacchetto ``markdown``.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
import shutil
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent

# Valori predefiniti per le build locali; la pubblicazione li passa da GitHub (--repo, --site-url),
# così il sito segue da solo il nome del repository.
DEFAULT_REPO = "Francesco209177/polpo"
DEFAULT_SITE_URL = "https://francesco209177.github.io/polpo/"

EWT_ENTRY = "vendor/esp-web-tools/install-button.js"
EWT_SHA256 = "HoBbJeJR8uEdDiFzNOaViwBdMXvm6FpeuX34ozlonVo="  # base64, come lo pubblica unpkg

NAV = [
    ("simulatore", "Simulatore"),
    ("installa", "Installa"),
    ("studio", "Polpo Studio"),
    ("componenti", "Componenti"),
    ("documentazione", "Documentazione"),
]

# (file Markdown, nome della pagina, titolo breve, descrizione per l'elenco)
DOCS = [
    ("polpo/docs/MANUALE.md", "manuale-polpo", "Manuale del Polpo", "Installazione, tasti, tutte le app del firmware, microSD, problemi frequenti."),
    ("studio/docs/MANUALE_STUDIO.md", "manuale-studio", "Manuale di Polpo Studio", "Installare il programma, collegare il Polpo, i moduli, la modalità laboratorio."),
    ("studio/docs/SICUREZZA.md", "sicurezza", "Sicurezza", "Cassaforte cifrata, PIN, registro attività, backup, cosa è escluso per scelta."),
    ("studio/docs/HARDWARE_ESTERNO.md", "hardware-esterno", "Hardware esterno", "Moduli Grove, lettori per PC, driver delle schede, permessi su Linux."),
    ("studio/docs/PROTOCOLLO_POLPO_LINK.md", "protocollo-polpo-link", "Protocollo Polpo Link", "Come si parlano Polpo e PC via USB: messaggi, comandi, errori."),
    ("studio/docs/ARCHITETTURA.md", "architettura", "Architettura di Polpo Studio", "Com'è organizzato il codice e come viene verificato."),
    ("studio/bridge/LEGGIMI.md", "polpo-bridge", "Polpo Bridge", "Lo sketch per Arduino ed ESP32: come caricarlo e collegare un lettore iButton."),
]


class BuildError(Exception):
    pass


# ---------------- utilità ----------------

_VAR = re.compile(r"\{\{\s*([a-z0-9_]+)\s*\}\}")


def render(text: str, ctx: dict[str, str], where: str) -> str:
    def sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in ctx:
            raise BuildError(f"{where}: variabile sconosciuta {{{{{key}}}}}")
        return ctx[key]

    return _VAR.sub(sub, text)


def front_matter(text: str, where: str) -> tuple[dict[str, str], str]:
    m = re.match(r"\s*<!--\n(.*?)\n-->\n?", text, re.S)
    if not m:
        raise BuildError(f"{where}: manca il blocco iniziale <!-- titolo, descrizione -->")
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    for need in ("title", "description"):
        if not meta.get(need):
            raise BuildError(f"{where}: manca «{need}»")
    return meta, text[m.end() :]


def human_size(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB".replace(".", ",") if n >= 1024 * 1024 else f"{n / 1024:.0f} KB"


def read_version(path: Path, pattern: str) -> str:
    m = re.search(pattern, path.read_text(encoding="utf-8"))
    if not m:
        raise BuildError(f"versione non trovata in {path}")
    return m.group(1)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


# ---------------- contesto ----------------


def base_context(repo: str, site_url: str) -> dict[str, str]:
    repo_url = f"https://github.com/{repo}"
    dl = f"{repo_url}/releases/latest/download"
    fw_version = read_version(ROOT / "polpo/scripts/version.py", r'VERSION = "([^"]+)"')
    studio_version = read_version(ROOT / "studio/polpo_studio/__init__.py", r'__version__ = "([^"]+)"')
    fw = ROOT / "polpo/release" / f"polpo-cardputer-{fw_version}.bin"
    if not fw.is_file():
        raise BuildError(f"firmware non trovato: {fw}")
    data = fw.read_bytes()
    return {
        "site_url": site_url,
        "site_path": urlsplit(site_url).path or "/",
        "repo": repo,
        "repo_url": repo_url,
        "issues_url": f"{repo_url}/issues",
        "releases_url": f"{repo_url}/releases/latest",
        "blob_url": f"{repo_url}/blob/main",
        "dl_win_setup": f"{dl}/PolpoStudio-Windows-setup.exe",
        "dl_win_zip": f"{dl}/PolpoStudio-windows-x64.zip",
        "dl_linux": f"{dl}/PolpoStudio-linux-x64.tar.gz",
        "dl_sums": f"{dl}/SHA256SUMS.txt",
        "fw_version": fw_version,
        "studio_version": studio_version,
        "fw_file": fw.name,
        "fw_size": human_size(len(data)),
        "fw_bytes": str(len(data)),
        "fw_sha256": hashlib.sha256(data).hexdigest(),
    }


def page_context(ctx: dict[str, str], *, root: str, path: str, meta: dict[str, str]) -> dict[str, str]:
    c = dict(ctx)
    c.update(
        root=root,
        title=html.escape(meta["title"]),
        description=html.escape(meta["description"], quote=True),
        canonical=ctx["site_url"] + path,
        og_image=ctx["site_url"] + "assets/img/og.png",
        body_class=meta.get("class", ""),
    )
    current = meta.get("nav", "")
    for key, _ in NAV:
        c[f"cur_{key}"] = ' aria-current="page"' if key == current else ""
    return c


# ---------------- pagine ----------------


def build_pages(out: Path, ctx: dict[str, str], template: str) -> list[str]:
    made = []
    for src in sorted((SITE / "pages").glob("*.html")):
        meta, body = front_matter(src.read_text(encoding="utf-8"), src.name)
        name = src.stem
        if name in ("index", "404"):
            rel, root = f"{name}.html", ""
        else:
            rel, root = f"{name}/index.html", "../"
        path = "" if name == "index" else ("404.html" if name == "404" else f"{name}/")
        if name == "404":
            root = ctx["site_path"]  # la pagina 404 viene servita da qualsiasi indirizzo: percorsi dalla radice
        c = page_context(ctx, root=root, path=path, meta=meta)
        c["content"] = render(body, c, src.name)
        write(out / rel, render(template, c, "base.html"))
        if name != "404":
            made.append(path)
    return made


# ---------------- simulatore ----------------

SITEBAR_CSS = """
.psb{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;max-width:1180px;margin:0 auto 14px;padding:0;font:600 14px/1.4 "Segoe UI",system-ui,sans-serif}
.psb a{color:inherit;text-decoration:none;padding:6px 2px;border-radius:6px}
.psb a:hover,.psb a:focus-visible{text-decoration:underline}
.psb .psb-home{display:inline-flex;align-items:center;gap:8px;font-size:16px;margin-right:auto}
.psb img{width:28px;height:28px}
.psb [aria-current=page]{color:var(--accent)}
"""


def build_simulator(out: Path, ctx: dict[str, str]) -> str:
    src = (ROOT / "polpo/simulator/index.html").read_text(encoding="utf-8")
    kept, removed = [], 0
    for line in src.splitlines(keepends=True):
        if "fonts.googleapis.com" in line or "fonts.gstatic.com" in line or 'name="claude:' in line:
            removed += 1
            continue
        kept.append(line)
    if removed < 3:
        raise BuildError("simulatore: non trovo più i collegamenti ai caratteri esterni da togliere (è cambiato?)")
    text = "".join(kept)
    links = "".join(
        '<a href="../{}/"{}>{}</a>'.format(key, ' aria-current="page"' if key == "simulatore" else "", label)
        for key, label in NAV
    )
    bar = (
        '<nav class="psb" aria-label="Sito del Polpo">'
        '<a class="psb-home" href="../"><img src="../assets/img/polpo.svg" alt="">Polpo</a>'
        f"{links}</nav>\n"
    )
    head = (
        '<meta name="description" content="Prova il firmware del Polpo nel browser: menu, telecomandi, radio, NFC. Tutto simulato, nessun acquisto.">\n'
        f'<link rel="canonical" href="{ctx["site_url"]}simulatore/">\n'
        '<link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml">\n'
        f'<meta property="og:title" content="Simulatore Polpo">\n<meta property="og:image" content="{ctx["site_url"]}assets/img/og.png">\n'
        f"<style>{SITEBAR_CSS}</style>\n"
    )
    if "</head>" not in text or "<body>" not in text:
        raise BuildError("simulatore: struttura della pagina inattesa")
    text = text.replace("</head>", head + "</head>", 1).replace("<body>", "<body>\n" + bar, 1)
    write(out / "simulatore/index.html", text)
    return "simulatore/"


# ---------------- firmware e microSD ----------------


def build_install_files(out: Path, ctx: dict[str, str]) -> None:
    dest = out / "installa"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "polpo/release" / ctx["fw_file"], dest / ctx["fw_file"])
    manifest = {
        "name": "Polpo",
        "version": ctx["fw_version"],
        "new_install_prompt_erase": True,
        "builds": [{"chipFamily": "ESP32-S3", "parts": [{"path": ctx["fw_file"], "offset": 0}]}],
    }
    write(dest / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    sd = ROOT / "polpo/sd_template"
    with zipfile.ZipFile(dest / "sd-polpo.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(sd.rglob("*")):
            if p.is_file() and p.name != ".gitkeep":
                z.write(p, p.relative_to(sd).as_posix())
            elif p.is_dir() and not any(x.name != ".gitkeep" for x in p.iterdir()):
                z.writestr(p.relative_to(sd).as_posix() + "/", "")  # cartelle vuote (nfc, logs, rf433)


# ---------------- manuali ----------------


def build_docs(out: Path, ctx: dict[str, str], template: str) -> list[str]:
    try:
        import markdown
    except ImportError as e:
        raise BuildError("serve il pacchetto «markdown»: pip install markdown") from e

    by_source = {(ROOT / src).resolve(): slug for src, slug, _title, _desc in DOCS}
    made = []
    for src_rel, slug, title, desc in DOCS:
        src = ROOT / src_rel
        text = src.read_text(encoding="utf-8")
        md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"], output_format="html5")
        body = md.convert(text)

        def fix(m: re.Match, src: Path = src) -> str:
            url = m.group(2)
            parts = urlsplit(url)
            if parts.scheme or url.startswith(("#", "mailto:")):
                return m.group(0)
            target = (src.parent / unquote(parts.path)).resolve()
            frag = f"#{parts.fragment}" if parts.fragment else ""
            if target in by_source:
                new = f"{by_source[target]}.html{frag}"
            else:
                try:
                    rel = target.relative_to(ROOT).as_posix()
                except ValueError:
                    raise BuildError(f"{src_rel}: link fuori dal progetto: {url}") from None
                if not target.exists():
                    raise BuildError(f"{src_rel}: link a un file che non esiste: {url}")
                kind = "tree" if target.is_dir() else "blob"
                new = f"{ctx['repo_url']}/{kind}/main/{rel}{frag}"
            return f'{m.group(1)}"{html.escape(new, quote=True)}"'

        body = re.sub(r'(<a\s+href=)"([^"]*)"', fix, body)
        body = body.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
        content = (
            '<article class="prose container">\n'
            '<p class="crumbs"><a href="./">Documentazione</a> › ' + html.escape(title) + "</p>\n"
            f"{body}\n"
            f'<p class="doc-source">Questa pagina è generata da <a href="{ctx["blob_url"]}/{src_rel}"><code>{src_rel}</code></a>.</p>\n'
            "</article>\n"
        )
        c = page_context(ctx, root="../", path=f"documentazione/{slug}.html", meta={"title": title, "description": desc, "nav": "documentazione"})
        c["content"] = content
        write(out / "documentazione" / f"{slug}.html", render(template, c, "base.html"))
        made.append(f"documentazione/{slug}.html")
    return made


def docs_cards() -> str:
    return "\n".join(
        f'<a class="card card-link" href="{slug}.html"><h3>{html.escape(title)}</h3><p>{html.escape(desc)}</p></a>'
        for _src, slug, title, desc in DOCS
    )


# ---------------- controlli ----------------


class _Links(HTMLParser):
    RESOURCE = {("script", "src"), ("img", "src"), ("iframe", "src"), ("source", "src"), ("source", "srcset"), ("link", "href"), ("video", "src"), ("audio", "src")}

    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str, bool]] = []  # (tag, url, è una risorsa caricata)
        self.ids: set[str] = set()
        self.imgs_without_alt = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if tag == "img" and "alt" not in a:
            self.imgs_without_alt += 1
        for name in ("href", "src", "manifest", "srcset"):
            url = a.get(name)
            if not url:
                continue
            is_res = (tag, name) in self.RESOURCE or name == "manifest"
            if tag == "link" and a.get("rel") in ("canonical",):
                is_res = False
            for u in (x.strip().split(" ")[0] for x in url.split(",")) if name == "srcset" else [url]:
                self.links.append((tag, u, is_res))


def check(out: Path, site_url: str) -> list[str]:
    problems: list[str] = []
    site_path = urlsplit(site_url).path or "/"
    pages = sorted(out.rglob("*.html"))
    parsed: dict[Path, _Links] = {}
    for p in pages:
        parser = _Links()
        parser.feed(p.read_text(encoding="utf-8"))
        parsed[p] = parser
    for p, parser in parsed.items():
        rel = p.relative_to(out).as_posix()
        if parser.imgs_without_alt:
            problems.append(f"{rel}: {parser.imgs_without_alt} immagini senza testo alternativo")
        for tag, url, is_res in parser.links:
            parts = urlsplit(url)
            if parts.scheme in ("http", "https") or url.startswith("//"):
                if is_res:
                    problems.append(f"{rel}: risorsa caricata da un sito esterno: {url}")
                continue
            if parts.scheme in ("mailto", "data"):
                continue
            path = unquote(parts.path)
            if not path:
                target = p
            else:
                if path.startswith("/"):  # percorso dalla radice del dominio (pagina 404)
                    if not path.startswith(site_path):
                        problems.append(f"{rel}: percorso fuori dal sito: {url}")
                        continue
                    target = out / path[len(site_path) :]
                else:
                    target = p.parent / path
                target = target.resolve()
                if target.is_dir():
                    target = target / "index.html"
            if not target.exists():
                problems.append(f"{rel}: link rotto <{tag}> {url}")
            elif parts.fragment and target in parsed and parts.fragment not in parsed[target].ids:
                problems.append(f"{rel}: àncora inesistente {url}")
    for css in out.rglob("*.css"):
        if re.search(r"url\(\s*['\"]?(https?:)?//|@import", css.read_text(encoding="utf-8")):
            problems.append(f"{css.relative_to(out)}: carica risorse esterne")
    entry = out / EWT_ENTRY
    if not entry.exists() or base64.b64encode(hashlib.sha256(entry.read_bytes()).digest()).decode() != EWT_SHA256:
        problems.append("ESP Web Tools: file mancante o diverso dalla versione verificata")
    manifest = json.loads((out / "installa/manifest.json").read_text(encoding="utf-8"))
    for build in manifest["builds"]:
        for part in build["parts"]:
            if not (out / "installa" / part["path"]).is_file():
                problems.append(f"manifest: manca {part['path']}")
    return problems


# ---------------- principale ----------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Assembla il sito del Polpo.")
    ap.add_argument("--out", default=str(SITE / "_site"), help="cartella di uscita (viene svuotata)")
    ap.add_argument("--repo", default=DEFAULT_REPO, help="utente/repository su GitHub")
    ap.add_argument("--site-url", default=DEFAULT_SITE_URL, help="indirizzo pubblico del sito")
    ap.add_argument("--check", action="store_true", help="controlla link e risorse; esce con errore se trova problemi")
    args = ap.parse_args(argv)
    out = Path(args.out).resolve()
    site_url = args.site_url.rstrip("/") + "/"
    try:
        if out in (ROOT, SITE) or ROOT.is_relative_to(out) or (out.exists() and not out.is_dir()):
            raise BuildError(f"cartella di uscita non valida: {out}")
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        ctx = base_context(args.repo, site_url)
        ctx["docs_cards"] = docs_cards()
        template = (SITE / "templates/base.html").read_text(encoding="utf-8")
        shutil.copytree(SITE / "assets", out / "assets")
        shutil.copytree(SITE / "vendor", out / "vendor", ignore=shutil.ignore_patterns("*.md"))
        urls = build_pages(out, ctx, template)
        urls.append(build_simulator(out, ctx))
        build_install_files(out, ctx)
        urls += build_docs(out, ctx, template)
        write(out / "sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f"  <url><loc>{site_url}{u}</loc></url>\n" for u in sorted(set(urls))) + "</urlset>\n")
        write(out / "robots.txt", f"User-agent: *\nAllow: /\nSitemap: {site_url}sitemap.xml\n")
        write(out / ".nojekyll", "")
    except BuildError as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1
    print(f"Sito creato in {out} ({sum(1 for _ in out.rglob('*.html'))} pagine) per {site_url}")
    if args.check:
        problems = check(out, site_url)
        for p in problems:
            print(f"  PROBLEMA: {p}", file=sys.stderr)
        if problems:
            return 1
        print("Controlli superati: nessun link rotto, nessuna risorsa esterna.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
