/* Runtime timetable data UI: first-run progress, feed-expiry warning, "keep all lines offline", background sync */
(function () {
  const S = window.__tt;
  const store = S.store;
  const $ = S.$;
  const pill = $("data-pill");
  const box = $("offline-all");
  let progress = null; /* null | number 0..100 | "error" */
  let flash = null;

  function paint() {
    let text = "", warn = false;
    const ex = store.expiry();
    if (typeof progress === "number") text = S.tf("dataLoading", progress);
    else if (progress === "error" && !(S.stops || []).length) { text = S.t("dataFailed"); warn = true; }
    else if (flash) text = flash;
    else if (ex && ex.expired) { text = S.tf("dataExpired", ex.feedEnd); warn = true; }
    else if (ex && ex.soon) { text = S.tf("dataExpiring", Math.max(1, ex.days)); warn = true; }
    pill.hidden = !text;
    pill.textContent = text;
    pill.classList.toggle("warn", warn);
    $("label-offline-all").textContent = S.t("offlineAll");
    box.checked = store.offlineAll();
    const m = store.manifest();
    if (m) store.linesStored().then((c) => {
      $("data-info").textContent = S.tf("dataInfo", m.version.slice(0, 7), m.feed_end, c.done, c.total);
    });
  }
  store.on("progress", (e) => {
    progress = e.phase === "done" ? null : e.phase === "error" ? "error" : Math.round((e.p || 0) * 100);
    paint();
  });
  store.on("updated", () => { progress = null; paint(); });
  store.on("lines-progress", () => paint());
  box.addEventListener("change", () => { store.setOfflineAll(box.checked); paint(); });

  const applyLang = S.applyLang;
  S.applyLang = function () { applyLang.apply(this, arguments); paint(); };

  /* Boot: data from IndexedDB first (instant), then a polite background check (≤ daily; on reconnect via app-store) */
  store.essentials().then((e) => {
    paint();
    if (!e) return;
    setTimeout(() => store.sync().then((changed) => {
      if (!changed) return;
      flash = S.t("dataUpdated"); paint();
      setTimeout(() => { flash = null; paint(); }, 4000);
    }), 2500);
    if (store.offlineAll()) setTimeout(() => store.downloadAllLines(), 8000);
  });
  paint();
})();
