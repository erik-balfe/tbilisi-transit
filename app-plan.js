(function () {
  const S = window.__tt;
  const $ = S.$;

  function itineraryHasLive(it) {
    return (it.legs || []).some((l) => l.realTime);
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function renderItinerary(it, index) {
    const el = document.createElement("article");
    el.className = "itinerary" + (index === 0 ? " active" : "");
    el.dataset.index = String(index);
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    const live = itineraryHasLive(it);
    const badge = live
      ? '<span class="badge live">' + S.t("live") + "</span>"
      : '<span class="badge sched">' + S.t("scheduled") + "</span>";
    el.innerHTML =
      '<div class="itin-head"><div><div class="itin-times"></div><div class="itin-meta"></div></div>' +
      badge + '</div><div class="legs"></div>';
    el.querySelector(".itin-times").textContent = S.formatTime(it.startTime) + " – " + S.formatTime(it.endTime);
    el.querySelector(".itin-meta").textContent = S.formatDuration(it.duration) + " · " + S.transferLabel(it.transfers || 0);
    const legsBox = el.querySelector(".legs");
    (it.legs || []).forEach((leg) => {
      const row = document.createElement("div");
      row.className = "leg";
      const mode = (leg.mode || "WALK").toUpperCase();
      const route = leg.displayName || leg.routeShortName || leg.routeLongName || "";
      const fromName = (leg.from && leg.from.name) || "";
      const toName = (leg.to && leg.to.name) || "";
      let pillInner = S.modeLabel(mode);
      if (mode !== "WALK" && route) {
        pillInner = '<span class="route-num">' + escapeHtml(route) + "</span> " + S.modeLabel(mode);
      }
      row.innerHTML =
        '<div class="leg-time"><strong></strong><span></span></div>' +
        '<div class="leg-detail"><div class="mode-pill ' + S.modeClass(mode) + '">' + pillInner +
        '</div><div class="from"></div><div class="to"></div></div>';
      row.querySelector(".leg-time strong").textContent = S.formatTime(leg.startTime);
      row.querySelector(".leg-time span").textContent = S.formatDuration(leg.duration);
      row.querySelector(".from").textContent = fromName === "START" ? "…" : fromName;
      const toLine = (toName === "END" ? "…" : toName) +
        (leg.realTime ? " · " + S.t("live") : mode !== "WALK" ? " · " + S.t("scheduled") : "");
      row.querySelector(".to").textContent = S.t("toStop") + " " + toLine;
      if (leg.realTime) {
        const liveBadge = document.createElement("span");
        liveBadge.className = "badge live";
        liveBadge.style.marginLeft = "0.35rem";
        liveBadge.textContent = S.t("live");
        row.querySelector(".mode-pill").appendChild(liveBadge);
      }
      legsBox.appendChild(row);
    });
    const select = () => {
      S.resultsEl.querySelectorAll(".itinerary").forEach((n) => n.classList.remove("active"));
      el.classList.add("active");
      if (S.drawItineraryRoute) S.drawItineraryRoute(it);
    };
    el.addEventListener("click", select);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
    return el;
  }
  async function plan() {
    if (!S.fromPlace || !S.toPlace) {
      S.statusEl.textContent = S.t("pickBoth");
      S.statusEl.classList.add("error");
      if (S.expandPanel) S.expandPanel();
      return;
    }
    S.goBtn.disabled = true;
    S.statusEl.classList.remove("error");
    S.statusEl.textContent = S.t("planning");
    S.resultsEl.innerHTML = "";
    S.fromSuggest.classList.remove("open");
    S.toSuggest.classList.remove("open");
    if (S.clearRoute) S.clearRoute();
    try {
      const from = S.fromPlace.lat + "," + S.fromPlace.lon;
      const to = S.toPlace.lat + "," + S.toPlace.lon;
      /* Transitous/MOTIS returns legGeometry.points (encoded polyline) by default */
      const path = "/v5/plan?fromPlace=" + encodeURIComponent(from) +
        "&toPlace=" + encodeURIComponent(to) +
        "&arriveBy=false&language=" + S.lang + "&numItineraries=3";
      const data = await S.apiGet(path);
      const list = (data.itineraries || []).slice(0, 3);
      S.lastItineraries = list;
      if (!list.length) {
        S.statusEl.textContent = S.t("noResults");
        S.resultsEl.innerHTML = '<div class="empty">' + S.t("noResults") + "</div>";
        return;
      }
      S.statusEl.textContent = list.length + " · " + S.displayName(S.fromPlace) + " → " + S.displayName(S.toPlace);
      list.forEach((it, i) => S.resultsEl.appendChild(renderItinerary(it, i)));
      if (S.drawItineraryRoute) S.drawItineraryRoute(list[0]);
      if (S.expandPanel) S.expandPanel();
      /* On mobile, briefly show results then user can collapse for map */
      if (window.matchMedia("(max-width: 799px)").matches) {
        setTimeout(() => {
          const first = S.resultsEl.querySelector(".itinerary");
          if (first) first.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 80);
      }
    } catch (err) {
      S.statusEl.textContent = S.t("error") + " " + err.message;
      S.statusEl.classList.add("error");
    } finally {
      S.goBtn.disabled = false;
    }
  }
  S.plan = plan;

  function applyPreset(a, b) {
    S.setPlace("from", Object.assign({}, S.PRESETS[a]), S.fromInput);
    S.setPlace("to", Object.assign({}, S.PRESETS[b]), S.toInput);
    S.fromSuggest.classList.remove("open");
    S.toSuggest.classList.remove("open");
    plan();
  }

  S.fromInput.addEventListener("input", () => S.debounceGeocode("from"));
  S.toInput.addEventListener("input", () => S.debounceGeocode("to"));
  S.fromInput.addEventListener("focus", () => {
    S.activePin = "from";
    if (S.updateMapHint) S.updateMapHint();
    if (S.expandPanel) S.expandPanel();
    if (S.fromSuggest.children.length) S.fromSuggest.classList.add("open");
  });
  S.toInput.addEventListener("focus", () => {
    S.activePin = "to";
    if (S.updateMapHint) S.updateMapHint();
    if (S.expandPanel) S.expandPanel();
    if (S.toSuggest.children.length) S.toSuggest.classList.add("open");
  });
  document.addEventListener("click", (e) => {
    if (!$("from-field").contains(e.target)) S.fromSuggest.classList.remove("open");
    if (!$("to-field").contains(e.target)) S.toSuggest.classList.remove("open");
  });
  $("swap").addEventListener("click", () => {
    const fp = S.fromPlace, tp = S.toPlace, fv = S.fromInput.value, tv = S.toInput.value;
    S.fromPlace = tp; S.toPlace = fp;
    S.fromInput.value = tv; S.toInput.value = fv;
    S.fromInput.classList.toggle("has-place", !!S.fromPlace);
    S.toInput.classList.toggle("has-place", !!S.toPlace);
    if (S.clearRoute) S.clearRoute();
    if (S.syncMapMarkers) S.syncMapMarkers();
  });
  S.goBtn.addEventListener("click", plan);
  $("preset-fs").addEventListener("click", () => applyPreset("freedom", "station"));
  $("preset-sf").addEventListener("click", () => applyPreset("station", "freedom"));
  $("lang-en").addEventListener("click", () => {
    S.lang = "en"; localStorage.setItem("tt-lang", S.lang); S.applyLang();
  });
  $("lang-ka").addEventListener("click", () => {
    S.lang = "ka"; localStorage.setItem("tt-lang", S.lang); S.applyLang();
  });
  $("use-as-from").addEventListener("click", () => S.consumePaste("from"));
  $("use-as-to").addEventListener("click", () => S.consumePaste("to"));
  S.pasteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      S.consumePaste(S.activePin === "from" ? "from" : "to");
    }
  });
  S.fromInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = S.fromSuggest.querySelector("button");
      if (first && S.fromSuggest.classList.contains("open")) first.dispatchEvent(new Event("mousedown"));
      else plan();
    }
  });
  S.toInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = S.toSuggest.querySelector("button");
      if (first && S.toSuggest.classList.contains("open")) first.dispatchEvent(new Event("mousedown"));
      else plan();
    }
  });

  S.applyLang();
  if (S.consumeQueryAndShare) S.consumeQueryAndShare();
})();
