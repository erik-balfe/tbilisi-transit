(function () {
  const S = window.__tt;
  const $ = S.$;

  function itineraryHasLive(it) {
    return (it.legs || []).some((l) => l.realTime);
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function itinColor(index) {
    const colors = S.ITIN_COLORS || ["#3db8a0", "#5b8def", "#e07a3a"];
    return colors[index % colors.length];
  }
  function routeBadgesHtml(it, color) {
    const parts = [];
    (it.legs || []).forEach((leg) => {
      const mode = (leg.mode || "WALK").toUpperCase();
      if (mode === "WALK") {
        const mins = Math.max(1, Math.round((leg.duration || 0) / 60));
        if (mins >= 2) parts.push('<span class="route-badge walk">' + mins + "′</span>");
        return;
      }
      const route = leg.displayName || leg.routeShortName || leg.routeLongName || S.modeLabel(mode);
      parts.push(
        '<span class="route-badge" style="background:' + color + '">' + escapeHtml(route) + "</span>"
      );
    });
    return parts.join("");
  }
  function renderLegs(it) {
    const legsBox = document.createElement("div");
    legsBox.className = "legs";
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
      legsBox.appendChild(row);
    });
    return legsBox;
  }

  function renderItinerary(it, index, expandDefault) {
    const color = itinColor(index);
    const el = document.createElement("article");
    el.className = "itinerary" + (index === S.selectedItin ? " active" : " dimmed");
    if (expandDefault) el.classList.add("expanded");
    el.dataset.index = String(index);
    el.style.setProperty("--itin-color", color);
    el.setAttribute("role", "button");
    el.tabIndex = 0;

    const live = itineraryHasLive(it);
    const badge = live
      ? '<span class="badge live">' + S.t("live") + "</span>"
      : '<span class="badge sched">' + S.t("scheduled") + "</span>";

    el.innerHTML =
      '<div class="itin-summary">' +
        '<span class="itin-color-dot" aria-hidden="true"></span>' +
        '<div class="itin-summary-main">' +
          '<div class="itin-times"></div>' +
          '<div class="itin-meta"></div>' +
          '<div class="itin-badges"></div>' +
        "</div>" +
        badge +
        '<span class="itin-chevron" aria-hidden="true">▾</span>' +
      "</div>" +
      '<div class="itin-detail"></div>';

    el.querySelector(".itin-times").textContent =
      S.formatTime(it.startTime) + " – " + S.formatTime(it.endTime);
    el.querySelector(".itin-meta").textContent =
      S.formatDuration(it.duration) + " · " + S.transferLabel(it.transfers || 0);
    el.querySelector(".itin-badges").innerHTML = routeBadgesHtml(it, color);
    el.querySelector(".itin-detail").appendChild(renderLegs(it));

    const select = (toggleExpand) => {
      S.selectedItin = index;
      S.resultsEl.querySelectorAll(".itinerary").forEach((n) => {
        const i = Number(n.dataset.index);
        n.classList.toggle("active", i === index);
        n.classList.toggle("dimmed", i !== index);
        if (toggleExpand) {
          if (i === index) n.classList.toggle("expanded");
          else n.classList.remove("expanded");
        } else if (i === index) {
          n.classList.add("expanded");
        }
      });
      if (S.drawAllItineraries) {
        S.drawAllItineraries(S.lastItineraries, index, { fit: true, duration: 500 });
      }
    };

    el.addEventListener("click", (e) => {
      /* Click summary toggles expand when already selected; always selects */
      const wasActive = el.classList.contains("active");
      select(wasActive);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const wasActive = el.classList.contains("active");
        select(wasActive);
      }
    });
    return el;
  }

  async function plan() {
    if (!S.fromPlace || !S.toPlace) {
      S.statusEl.textContent = S.t("pickBoth");
      S.statusEl.classList.add("error");
      if (S.setPanelMode) S.setPanelMode("search");
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
      const path = "/v5/plan?fromPlace=" + encodeURIComponent(from) +
        "&toPlace=" + encodeURIComponent(to) +
        "&arriveBy=false&language=" + S.lang + "&numItineraries=3";
      const data = await S.apiGet(path);
      const list = (data.itineraries || []).slice(0, 3);
      S.lastItineraries = list;
      S.selectedItin = 0;
      if (!list.length) {
        S.statusEl.textContent = S.t("noResults");
        S.resultsEl.innerHTML = '<div class="empty">' + S.t("noResults") + "</div>";
        if (S.setPanelMode) S.setPanelMode("search");
        return;
      }
      const labelFn = S.t("routesFound");
      S.statusEl.textContent = typeof labelFn === "function" ? labelFn(list.length) : list.length + "";
      /* First expanded for detail; all drawn on map in distinct colors */
      list.forEach((it, i) => S.resultsEl.appendChild(renderItinerary(it, i, i === 0)));
      if (S.drawAllItineraries) {
        S.drawAllItineraries(list, 0, { fit: true, fitAll: false });
      }
      /* Shrink form so results + map dominate */
      if (S.setPanelMode) S.setPanelMode("results");
      if (S.setSheet) S.setSheet("mid");
      else if (S.expandPanel) S.expandPanel();
      if (window.matchMedia("(max-width: 799px)").matches) {
        setTimeout(() => {
          const first = S.resultsEl.querySelector(".itinerary");
          if (first) first.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 80);
      }
    } catch (err) {
      S.statusEl.textContent = S.t("error");
      S.statusEl.classList.add("error");
      console.warn(err);
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
    const more = $("more-tools");
    if (more) more.open = false;
    plan();
  }

  function backToSearch() {
    if (S.setPanelMode) S.setPanelMode("search");
    if (S.expandPanel) S.expandPanel();
    S.fromInput.focus();
  }

  S.fromInput.addEventListener("input", () => S.debounceGeocode("from"));
  S.toInput.addEventListener("input", () => S.debounceGeocode("to"));
  S.fromInput.addEventListener("focus", () => {
    if (S.armPinField) S.armPinField("from");
    else {
      S.activePin = "from";
      if (S.updateMapHint) S.updateMapHint();
    }
    if (S.expandPanel) S.expandPanel();
    if (S.fromSuggest.children.length) S.fromSuggest.classList.add("open");
  });
  S.toInput.addEventListener("focus", () => {
    if (S.armPinField) S.armPinField("to");
    else {
      S.activePin = "to";
      if (S.updateMapHint) S.updateMapHint();
    }
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
    if (S.updateTripSummary) S.updateTripSummary();
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
  const editBtn = $("edit-trip");
  const editChip = $("edit-trip-chip");
  if (editBtn) editBtn.addEventListener("click", backToSearch);
  if (editChip) editChip.addEventListener("click", backToSearch);

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
  if (S.fromPlace && S.toPlace) {
    const params = new URLSearchParams(location.search);
    if (params.get("from") && (params.get("to") || params.get("dest") || params.get("destination"))) {
      setTimeout(() => plan(), 250);
    }
  }
})();
