(function () {
  const { API, PRESETS, I18N } = window.TT;
  const S = (window.__tt = {
    API, PRESETS, I18N,
    lang: localStorage.getItem("tt-lang") || "en",
    fromPlace: null,
    toPlace: null,
    timers: { from: null, to: null },
  });
  const $ = (id) => document.getElementById(id);
  S.$ = $;
  S.fromInput = $("from");
  S.toInput = $("to");
  S.fromSuggest = $("from-suggest");
  S.toSuggest = $("to-suggest");
  S.statusEl = $("status");
  S.resultsEl = $("results");
  S.goBtn = $("go");

  S.t = function (key) {
    const pack = S.I18N[S.lang] || S.I18N.en;
    return pack[key];
  };
  S.displayName = function (p) {
    if (!p) return "";
    if (S.lang === "ka" && p.nameKa) return p.nameKa;
    return p.name || "";
  };
  S.applyLang = function () {
    document.documentElement.lang = S.lang;
    $("title").textContent = S.t("title");
    $("subtitle").textContent = S.t("subtitle");
    $("label-from").textContent = S.t("from");
    $("label-to").textContent = S.t("to");
    S.goBtn.textContent = S.t("go");
    $("swap").title = S.t("swap");
    $("swap").setAttribute("aria-label", S.t("swap"));
    $("preset-fs").textContent = S.t("presetFS");
    $("preset-sf").textContent = S.t("presetSF");
    $("footer").innerHTML = S.t("footer");
    $("lang-en").classList.toggle("active", S.lang === "en");
    $("lang-ka").classList.toggle("active", S.lang === "ka");
    if (S.fromPlace) S.fromInput.value = S.displayName(S.fromPlace);
    if (S.toPlace) S.toInput.value = S.displayName(S.toPlace);
  };
  S.formatTime = function (iso) {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat(S.lang === "ka" ? "ka-GE" : "en-GB", {
        timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch (e) { return iso.slice(11, 16); }
  };
  S.formatDuration = function (sec) {
    return Math.round((sec || 0) / 60) + " " + S.t("duration");
  };
  S.transferLabel = function (n) {
    if (!n) return S.t("transfers0");
    if (n === 1) return S.t("transfers1");
    return S.t("transfersN")(n);
  };
  S.modeLabel = function (mode) {
    const m = (mode || "").toUpperCase();
    if (m === "WALK") return S.t("walk");
    if (m === "BUS") return S.t("bus");
    if (m === "SUBWAY" || m === "METRO" || m === "RAIL" || m === "TRAM") return S.t("metro");
    if (m === "GONDOLA" || m === "CABLE_CAR" || m === "FUNICULAR") return S.t("gondola");
    return mode || "?";
  };
  S.modeClass = function (mode) {
    const m = (mode || "WALK").toUpperCase();
    if (["SUBWAY", "METRO", "RAIL", "TRAM"].includes(m)) return "mode-SUBWAY";
    if (["GONDOLA", "CABLE_CAR", "FUNICULAR"].includes(m)) return "mode-GONDOLA";
    if (m === "BUS") return "mode-BUS";
    return "mode-WALK";
  };
  S.preferGeorgia = function (results) {
    const ge = (results || []).filter((r) => r.country === "GE");
    const pool = ge.length ? ge : (results || []);
    return pool.filter((r) => r.type === "STOP").concat(pool.filter((r) => r.type !== "STOP")).slice(0, 8);
  };
  S.areaHint = function (r) {
    const areas = (r.areas || []).map((a) => a.name).filter(Boolean);
    return [r.type, r.country].concat(areas.slice(-2)).filter(Boolean).join(" · ");
  };
  S.apiGet = async function (path) {
    const res = await fetch(S.API + path, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (text ? ": " + text.slice(0, 120) : ""));
    }
    return res.json();
  };
  S.geocode = async function (text) {
    const q = encodeURIComponent(text.trim());
    const data = await S.apiGet("/v1/geocode?text=" + q + "&language=" + S.lang);
    return S.preferGeorgia(Array.isArray(data) ? data : []);
  };
  S.placeFromResult = function (r) {
    return { name: r.name, lat: r.lat, lon: r.lon, id: r.id, type: r.type, country: r.country };
  };
  S.setPlace = function (which, place, inputEl) {
    if (which === "from") {
      S.fromPlace = place;
      S.fromInput.classList.toggle("has-place", !!place);
    } else {
      S.toPlace = place;
      S.toInput.classList.toggle("has-place", !!place);
    }
    if (place && inputEl) inputEl.value = S.displayName(place);
  };
  S.renderSuggest = function (box, items, which, inputEl) {
    box.innerHTML = "";
    if (!items.length) { box.classList.remove("open"); return; }
    items.forEach((r, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "option");
      if (i === 0) btn.classList.add("active");
      btn.innerHTML = '<div class="name"></div><div class="meta"></div>';
      btn.querySelector(".name").textContent = r.name;
      btn.querySelector(".meta").textContent = S.areaHint(r);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        S.setPlace(which, S.placeFromResult(r), inputEl);
        box.classList.remove("open");
      });
      box.appendChild(btn);
    });
    box.classList.add("open");
  };
  S.debounceGeocode = function (which) {
    clearTimeout(S.timers[which]);
    S.timers[which] = setTimeout(async () => {
      const inputEl = which === "from" ? S.fromInput : S.toInput;
      const box = which === "from" ? S.fromSuggest : S.toSuggest;
      const text = inputEl.value.trim();
      S.setPlace(which, null);
      inputEl.classList.remove("has-place");
      if (text.length < 2) { box.classList.remove("open"); return; }
      try {
        S.statusEl.textContent = S.t("searching");
        S.statusEl.classList.remove("error");
        S.renderSuggest(box, await S.geocode(text), which, inputEl);
        S.statusEl.textContent = "";
      } catch (err) {
        S.statusEl.textContent = S.t("error") + " " + err.message;
        S.statusEl.classList.add("error");
        box.classList.remove("open");
      }
    }, 280);
  };
})();
