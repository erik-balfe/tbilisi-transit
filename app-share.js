(function () {
  const S = window.__tt;

  function parseLatLonPair(a, b) {
    const lat = parseFloat(a);
    const lon = parseFloat(b);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  /** Extract first lat,lon from free text / URLs */
  S.parseLocationText = function (raw) {
    if (!raw) return null;
    let text = String(raw).trim();

    /* geo:lat,lon or geo:lat,lon?q= */
    let m = text.match(/geo:(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (m) return parseLatLonPair(m[1], m[2]);

    /* Google Maps @lat,lon or /maps/place/.../@lat,lon */
    m = text.match(/@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) return parseLatLonPair(m[1], m[2]);

    /* Google Maps ?q=lat,lon or &q=lat,lon */
    m = text.match(/[?&](?:q|query|ll|destination|daddr|saddr)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (m) return parseLatLonPair(m[1], m[2]);

    /* Google Maps /dir/lat,lon/lat,lon */
    m = text.match(/\/dir\/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      return { from: parseLatLonPair(m[1], m[2]), to: parseLatLonPair(m[3], m[4]), pair: true };
    }

    /* OSM /#map=zoom/lat/lon */
    m = text.match(/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    if (m) return parseLatLonPair(m[1], m[2]);

    /* OSM ?mlat= &mlon= */
    m = text.match(/[?&]mlat=(-?\d+(?:\.\d+)?).*?[?&]mlon=(-?\d+(?:\.\d+)?)/i);
    if (m) return parseLatLonPair(m[1], m[2]);
    m = text.match(/[?&]mlon=(-?\d+(?:\.\d+)?).*?[?&]mlat=(-?\d+(?:\.\d+)?)/i);
    if (m) return parseLatLonPair(m[2], m[1]);

    /* apple maps / maps.apple.com?ll=lat,lon */
    m = text.match(/[?&]ll=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (m) return parseLatLonPair(m[1], m[2]);

    /* plain lat,lon */
    m = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return parseLatLonPair(m[1], m[2]);

    /* loose lat,lon somewhere in text */
    m = text.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);
    if (m) return parseLatLonPair(m[1], m[2]);

    return null;
  };

  function parseCoordParam(val) {
    if (!val) return null;
    const m = String(val).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return parseLatLonPair(m[1], m[2]);
  }

  S.applyParsedLocation = function (which, parsed, name) {
    if (!parsed) return false;
    if (parsed.pair) {
      let ok = true;
      if (parsed.from) ok = S.dropPin("from", parsed.from.lat, parsed.from.lon) && ok;
      if (parsed.to) ok = S.dropPin("to", parsed.to.lat, parsed.to.lon) && ok;
      return ok;
    }
    if (!S.dropPin) {
      if (!S.inTbilisi(parsed.lat, parsed.lon)) {
        S.statusEl.textContent = S.t("outsideCity");
        S.statusEl.classList.add("error");
        return false;
      }
      const input = which === "from" ? S.fromInput : S.toInput;
      S.setPlace(which, S.placeFromLatLon(parsed.lat, parsed.lon, name), input);
      return true;
    }
    return S.dropPin(which, parsed.lat, parsed.lon, name);
  };

  S.consumePaste = function (which) {
    const text = (S.pasteInput && S.pasteInput.value) || "";
    if (!text.trim()) {
      S.statusEl.textContent = S.t("pasteEmpty");
      S.statusEl.classList.add("error");
      return;
    }
    const parsed = S.parseLocationText(text);
    if (!parsed) {
      S.statusEl.textContent = S.t("pasteBad");
      S.statusEl.classList.add("error");
      return;
    }
    if (S.applyParsedLocation(which, parsed)) {
      S.statusEl.classList.remove("error");
    }
  };

  S.consumeQueryAndShare = function () {
    const params = new URLSearchParams(location.search);
    let acted = false;

    const fromP = parseCoordParam(params.get("from"));
    const toP = parseCoordParam(params.get("to") || params.get("dest") || params.get("destination"));
    const geoP = parseCoordParam(params.get("geo") || params.get("ll"));

    if (fromP) acted = S.applyParsedLocation("from", fromP) || acted;
    if (toP) acted = S.applyParsedLocation("to", toP) || acted;
    if (geoP && !toP && !fromP) {
      /* Single geo → destination by default */
      acted = S.applyParsedLocation("to", geoP) || acted;
    }

    /* PWA share_target GET params */
    const sharedBits = [params.get("url"), params.get("text"), params.get("title")]
      .filter(Boolean)
      .join("\n");
    if (sharedBits) {
      const parsed = S.parseLocationText(sharedBits);
      if (parsed) {
        const which = toP || geoP ? "from" : "to";
        if (S.applyParsedLocation(which, parsed)) {
          acted = true;
          S.statusEl.textContent = S.t("sharedIn");
          S.statusEl.classList.remove("error");
        }
      } else if (S.pasteInput) {
        S.pasteInput.value = sharedBits.split("\n").filter(Boolean)[0] || sharedBits;
      }
    }

    /* Hash geo: or coords */
    if (location.hash) {
      const parsed = S.parseLocationText(decodeURIComponent(location.hash.replace(/^#/, "")));
      if (parsed) acted = S.applyParsedLocation("to", parsed) || acted;
    }

    if (acted) {
      /* Clean share noise from URL without reload */
      try {
        const clean = new URL(location.href);
        ["title", "text", "url"].forEach((k) => clean.searchParams.delete(k));
        history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
      } catch (e) { /* ignore */ }
    }
    return acted;
  };
})();
