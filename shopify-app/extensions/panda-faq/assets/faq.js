// Panda FAQ block: search, the phone jump menu, the section list highlight,
// and opening the question an incoming link points at.
(function () {
  document.querySelectorAll("[data-pfaq]").forEach(function (root) {
    var search = root.querySelector("[data-pfaq-search]");
    var results = root.querySelector("[data-pfaq-results]");
    var none = root.querySelector("[data-pfaq-none]");
    var sections = root.querySelectorAll("[data-pfaq-sec]");

    // Search filters every question at once; matching answers stay closed
    // until clicked, so the list stays easy to scan.
    if (search) {
      search.addEventListener("input", function () {
        var term = search.value.trim().toLowerCase();
        var hits = 0;
        sections.forEach(function (sec) {
          var secHits = 0;
          sec.querySelectorAll("[data-pfaq-q]").forEach(function (q) {
            var match = !term || q.textContent.toLowerCase().indexOf(term) !== -1;
            q.hidden = !match;
            if (match) secHits++;
          });
          sec.hidden = secHits === 0;
          hits += secHits;
        });
        results.hidden = !term;
        results.textContent = hits + (hits === 1 ? " answer" : " answers") + ' for "' + search.value.trim() + '"';
        if (none) none.hidden = !term || hits > 0;
      });
    }

    // Phone: jump to the chosen section.
    var jump = root.querySelector("[data-pfaq-jump]");
    if (jump) {
      jump.addEventListener("change", function () {
        var target = jump.value && document.getElementById(jump.value);
        if (target) target.scrollIntoView({ behavior: "smooth" });
      });
    }

    // Desktop: highlight the section being read in the section list.
    var links = root.querySelectorAll("[data-pfaq-nav]");
    if (links.length && "IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (a) {
            a.classList.toggle("is-on", a.getAttribute("data-pfaq-nav") === entry.target.id);
          });
        });
      }, { rootMargin: "-20% 0px -70% 0px" });
      sections.forEach(function (sec) { observer.observe(sec); });
    }
  });

  // Links to a question (#hc-<handle>, or the old app's #hc-<handle>-question)
  // open it and bring it into view.
  function openFromHash() {
    var id = decodeURIComponent(location.hash.slice(1)).replace(/-question$/, "");
    if (id.indexOf("hc-") !== 0) return;
    var q = document.getElementById(id);
    if (!q || q.tagName !== "DETAILS") return;
    q.open = true;
    q.scrollIntoView();
  }
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
})();
