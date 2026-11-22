// Sito del Polpo: poche righe, nessuna libreria. L'unica cosa che ricorda, e solo in questo browser,
// è la scelta «Ferma le animazioni».
(function () {
  "use strict";
  var root = document.documentElement;

  // Menu su schermi stretti.
  var btn = document.querySelector(".menu-btn");
  var menu = document.getElementById("menu");
  if (btn && menu) {
    var setOpen = function (open) {
      menu.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    btn.addEventListener("click", function () { setOpen(!menu.classList.contains("open")); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("open")) { setOpen(false); btn.focus(); }
    });
  }

  // Sistema operativo: evidenzia il download giusto nella pagina di Polpo Studio.
  var ua = navigator.userAgent || "";
  var os = /Windows/i.test(ua) ? "windows" : /Android|iPhone|iPad/i.test(ua) ? "" : /Mac OS X|Macintosh/i.test(ua) ? "mac" : /Linux|X11/i.test(ua) ? "linux" : "";
  if (os) document.documentElement.setAttribute("data-os", os);

  // Installazione dal browser: serve Web Serial (Chrome o Edge su computer).
  var noSerial = document.querySelectorAll("[data-no-serial]");
  if (noSerial.length && !("serial" in navigator)) {
    noSerial.forEach(function (el) { el.hidden = false; });
  }

  // Pulsanti "Copia".
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var el = document.getElementById(b.getAttribute("data-copy"));
      if (!el || !navigator.clipboard) return;
      navigator.clipboard.writeText(el.textContent.trim()).then(function () {
        var old = b.textContent;
        b.textContent = "Copiato";
        setTimeout(function () { b.textContent = old; }, 1600);
      });
    });
  });

  // ---------------- animazioni ----------------
  var riduci = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var ferme = function () { return riduci || root.classList.contains("fermo"); };

  // Ombra sotto la testata quando la pagina è scorsa.
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("scorsa", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Comparsa mentre si scorre. Si nasconde solo ciò che è ancora sotto lo schermo: quello che si vede
  // all'apertura resta fermo, e senza JavaScript o con le animazioni ferme non si nasconde nulla.
  var observer = null;
  var showAll = function () {
    if (observer) { observer.disconnect(); observer = null; }
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.remove("reveal", "in"); el.style.removeProperty("--i"); });
  };
  if ("IntersectionObserver" in window && !ferme()) {
    observer = new IntersectionObserver(function (entries) {
      var n = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target, i = Math.min(n++, 6);
        observer.unobserve(el);
        el.style.setProperty("--i", i);
        el.classList.add("in");
        setTimeout(function () { el.classList.remove("reveal", "in"); el.style.removeProperty("--i"); }, 1000 + i * 70);
      });
    }, { rootMargin: "0px 0px -7% 0px", threshold: 0.06 });
    var limit = window.innerHeight;
    document.querySelectorAll(
      "main .section-head, main .grid > *, main .split > *, main .steps > li, main .gallery > *, " +
      "main .container > .notice, main .container > figure, main .container > .table-wrap, main .container > details, main .container > .btn-row"
    ).forEach(function (el) {
      if (el.closest(".hero, .page-head, .prose") || el.parentElement.closest(".reveal")) return;
      if (el.getBoundingClientRect().top < limit) return;
      el.classList.add("reveal");
      observer.observe(el);
    });
  }

  // Il dispositivo nella pagina iniziale si inclina appena verso il puntatore (solo con il mouse).
  var art = document.querySelector(".hero-art");
  var tilt = art && art.querySelector("a");
  if (tilt && window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    art.addEventListener("pointermove", function (e) {
      if (ferme()) return;
      var r = art.getBoundingClientRect();
      tilt.style.setProperty("--ry", (((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2) + "deg");
      tilt.style.setProperty("--rx", (((e.clientY - r.top) / r.height - 0.5) * -9).toFixed(2) + "deg");
    });
    art.addEventListener("pointerleave", function () { tilt.style.removeProperty("--rx"); tilt.style.removeProperty("--ry"); });
  }

  // «Ferma le animazioni»: vale per tutto il sito e resta ricordato in questo browser.
  var animBtn = document.querySelector("[data-anim]");
  if (animBtn && !riduci) {
    var paint = function () {
      var off = root.classList.contains("fermo");
      animBtn.textContent = off ? "Riattiva le animazioni" : "Ferma le animazioni";
      animBtn.setAttribute("aria-pressed", off ? "true" : "false");
    };
    animBtn.hidden = false;
    paint();
    animBtn.addEventListener("click", function () {
      var off = root.classList.toggle("fermo");
      try { if (off) localStorage.setItem("polpo-animazioni", "ferme"); else localStorage.removeItem("polpo-animazioni"); } catch (e) { /* senza memoria vale solo per questa pagina */ }
      if (off) { showAll(); if (tilt) { tilt.style.removeProperty("--rx"); tilt.style.removeProperty("--ry"); } }
      paint();
    });
  }
})();
