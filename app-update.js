/*
 * App updates: shows the running version, checks the server for a newer one (start, return to the app, button)
 * and applies it (service worker update + fresh assets, then reload). Works with and without a service worker.
 */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const CUR = window.TT_VERSION || "";
  const CHECK_EVERY_MS = 10 * 60e3;
  const bar = $("update-bar"), btn = $("update-btn"), txt = $("update-text");
  let lastCheck = 0, pending = null, busy = false, touched = false;
  window.addEventListener("pointerdown", () => { touched = true; }, { capture: true, once: true });

  async function remoteVersion() {
    const r = await fetch("./app-version.js?probe=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("version " + r.status);
    const m = /TT_VERSION\s*=\s*"([^"]+)"/.exec(await r.text());
    if (!m) throw new Error("version format");
    return m[1];
  }
  function paintBar() {
    bar.hidden = !pending;
    txt.textContent = busy ? S.t("updating") : S.t("updateReady");
    btn.textContent = S.t("updateReload");
    btn.disabled = busy;
  }
  /** → "current" | "available" | "error" */
  S.checkForUpdate = async function () {
    lastCheck = Date.now();
    try {
      const v = await remoteVersion();
      pending = v && v !== CUR ? v : null;
    } catch (e) { return "error"; }
    paintBar();
    return pending ? "available" : "current";
  };
  S.applyUpdate = async function () {
    if (busy) return;
    busy = true; paintBar();
    try {
      if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          const w = reg.installing || reg.waiting;
          if (w && w.state !== "activated") {
            await new Promise((res) => {
              const t = setTimeout(res, 12000);
              w.addEventListener("statechange", () => { if (w.state === "activated" || w.state === "redundant") { clearTimeout(t); res(); } });
            });
          }
        }
      }
      /* browsers without a service worker: refresh the HTTP cache copies of the shell */
      const urls = ["./"].concat([...document.scripts].map((s) => s.src).filter(Boolean), [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href));
      await Promise.all(urls.map((u) => fetch(u, { cache: "reload" }).catch(() => {})));
    } catch (e) { /* reload anyway */ }
    location.reload();
  };
  btn.addEventListener("click", () => S.applyUpdate());

  /* Settings row (More): version + manual check */
  const label = $("app-version"), check = $("check-update");
  function paintLabel() {
    label.textContent = S.tf("appVersion", CUR);
    check.textContent = S.t("updateCheck");
  }
  check.addEventListener("click", async () => {
    check.disabled = true;
    check.textContent = S.t("updateChecking");
    const r = await S.checkForUpdate();
    check.disabled = false;
    paintLabel();
    if (r === "available") S.applyUpdate();
    else S.toast(S.t(r === "current" ? "updateCurrent" : "updateFailed"), r !== "current");
  });
  const applyLang = S.applyLang;
  S.applyLang = function () { applyLang.apply(this, arguments); paintLabel(); paintBar(); };
  paintLabel();

  /* Start: check once; if a newer version exists and the app was only just opened, apply it right away (once per version) */
  setTimeout(async () => {
    if (!S.online || navigator.onLine === false) return; /* offline: no requests */
    const r = await S.checkForUpdate();
    if (r !== "available") return;
    let tried = null;
    try { tried = sessionStorage.getItem("tt-auto-update"); } catch (e) { /* private mode */ }
    if (!touched && tried !== pending) {
      try { sessionStorage.setItem("tt-auto-update", pending); } catch (e) { /* ignore */ }
      S.applyUpdate();
    }
  }, 1500);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && S.online && navigator.onLine !== false && Date.now() - lastCheck > CHECK_EVERY_MS) S.checkForUpdate();
  });
})();
