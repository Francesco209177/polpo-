// Sito del Polpo: poche righe, nessuna libreria, nessun dato salvato.
(function () {
  "use strict";

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
})();
