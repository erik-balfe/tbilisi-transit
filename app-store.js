/*
 * Data + cache layer (no data ships with the code).
 *  - Timetable data (stops, lines index, per-line files) is published separately by the
 *    `data` GitHub Action to ./data/ as content-hashed files + manifest.json.
 *  - IndexedDB "tt" keeps: data (key → {hash, body}), meta (manifest, lastCheck), api (url → {at, body}).
 *  - Start: render from IndexedDB; background sync (on start, at most daily, and when back online)
 *    fetches the manifest, diffs hashes and downloads only changed files.
 *  - API responses: per-endpoint TTL + stale fallback (works offline with last known data).
 */
(function () {
  const DATA_BASE = "data/";
  const DAY_MS = 24 * 3600e3;

  /* —— localStorage helpers (shared) —— */
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota / private mode */ } },
  };

  /* —— tiny IndexedDB wrapper —— */
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error("no IndexedDB"));
        const rq = indexedDB.open("tt", 1);
        rq.onupgradeneeded = () => {
          const d = rq.result;
          ["data", "meta", "api"].forEach((n) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
        };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const os = t.objectStore(store);
      let out;
      const rq = fn(os);
      if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => reject(t.error);
    }));
  }
  const idb = {
    get: (s, k) => tx(s, "readonly", (os) => os.get(k)).catch(() => undefined),
    put: (s, k, v) => tx(s, "readwrite", (os) => os.put(v, k)).catch(() => undefined),
    del: (s, k) => tx(s, "readwrite", (os) => os.delete(k)).catch(() => undefined),
    keys: (s) => tx(s, "readonly", (os) => os.getAllKeys()).catch(() => []),
  };

  /* —— events —— */
  const listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, arg) { (listeners[ev] || []).forEach((fn) => { try { fn(arg); } catch (e) { console.warn(e); } }); }

  /* —— network helpers —— */
  async function fetchJSON(url, opts) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), (opts && opts.timeout) || 20000);
    try {
      const res = await fetch(url, Object.assign({ signal: ctl.signal, headers: { Accept: "application/json" } }, opts && opts.init));
      if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
      return await res.json();
    } finally { clearTimeout(to); }
  }
  /** Download with byte progress (falls back to plain json when streams are unavailable) */
  async function fetchWithProgress(url, onBytes) {
    const res = await fetch(url);
    if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
    if (!res.body || !res.body.getReader || !onBytes) return res.json();
    const rd = res.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      chunks.push(value); n += value.length; onBytes(n);
    }
    const buf = new Uint8Array(n);
    let o = 0;
    chunks.forEach((c) => { buf.set(c, o); o += c.length; });
    return JSON.parse(new TextDecoder().decode(buf));
  }
  const fetchManifest = () => fetchJSON(DATA_BASE + "manifest.json?t=" + Date.now(), { timeout: 15000, init: { cache: "no-store" } });

  /* —— timetable data —— */
  let active = null; /* manifest that matches the data in memory */
  let essentialsP = null;

  async function readEssentials() {
    const m = await idb.get("meta", "manifest");
    if (!m || !m.files) return null;
    const [s, l] = await Promise.all([idb.get("data", "stops"), idb.get("data", "lines")]);
    if (!s || !l || s.hash !== m.files.stops.hash || l.hash !== m.files.lines.hash) return null;
    return { manifest: m, stops: s.body, lines: l.body };
  }
  async function downloadEssentials(m, onProgress) {
    const fs = [m.files.stops, m.files.lines];
    const total = fs.reduce((a, f) => a + (f.size || 0), 0) || 1;
    const got = [0, 0];
    const report = () => onProgress && onProgress(Math.min(1, (got[0] + got[1]) / total));
    report();
    const [stops, lines] = await Promise.all(fs.map((f, i) =>
      fetchWithProgress(DATA_BASE + f.path, (n) => { got[i] = n; report(); })));
    await idb.put("data", "stops", { hash: m.files.stops.hash, body: stops });
    await idb.put("data", "lines", { hash: m.files.lines.hash, body: lines });
    await idb.put("meta", "manifest", m);
    return { manifest: m, stops, lines };
  }
  /** Stops + lines index: from IndexedDB, or (first run) downloaded with progress. Never rejects: null = unavailable. */
  function essentials() {
    if (!essentialsP) {
      essentialsP = (async () => {
        const have = await readEssentials();
        if (have) { active = have.manifest; return have; }
        emit("progress", { phase: "start", p: 0 });
        try {
          const m = await fetchManifest();
          const got = await downloadEssentials(m, (p) => emit("progress", { phase: "download", p }));
          active = m;
          ls.set("tt-data-check", Date.now());
          emit("progress", { phase: "done", p: 1 });
          setTimeout(() => emit("updated", got), 0); /* late listeners (retry after offline start) */
          if (offlineAll()) setTimeout(() => downloadAllLines(), 3000);
          return got;
        } catch (e) {
          emit("progress", { phase: "error", error: e });
          essentialsP = null; /* retry later (e.g. when back online) */
          return null;
        }
      })();
    }
    return essentialsP;
  }

  /** One line file (lazy; cached in IndexedDB by hash) */
  async function getLine(key) {
    if (!active) await essentials();
    const f = active && active.files["line:" + key];
    if (!f) throw new Error("unknown line " + key);
    const rec = await idb.get("data", "line:" + key);
    if (rec && rec.hash === f.hash) return rec.body;
    try {
      const body = await fetchJSON(DATA_BASE + f.path, { timeout: 15000 });
      await idb.put("data", "line:" + key, { hash: f.hash, body });
      return body;
    } catch (e) {
      if (rec) return rec.body; /* older version beats nothing */
      if (e.status === 404) sync({ force: true }); /* our manifest is outdated */
      throw e;
    }
  }

  function offlineAll() { return !!ls.get("tt-offline-all", false); }
  let allRunning = null;
  /** Download every line file that is missing/outdated. onProgress(done, total). */
  function downloadAllLines(onProgress) {
    if (allRunning) return allRunning;
    allRunning = (async () => {
      if (!active) await essentials();
      if (!active) return false;
      const want = Object.keys(active.files).filter((k) => k.startsWith("line:"));
      const keys = new Set(await idb.keys("data"));
      let done = 0;
      const todo = [];
      for (const k of want) {
        if (keys.has(k)) {
          const rec = await idb.get("data", k);
          if (rec && rec.hash === active.files[k].hash) { done++; continue; }
        }
        todo.push(k);
      }
      emit("lines-progress", { done, total: want.length });
      if (onProgress) onProgress(done, want.length);
      for (const k of todo) { /* sequential: polite + low memory */
        if (navigator.onLine === false) break;
        try {
          const f = active.files[k];
          const body = await fetchJSON(DATA_BASE + f.path, { timeout: 20000 });
          await idb.put("data", k, { hash: f.hash, body });
          done++;
        } catch (e) { if (e.status !== 404) break; }
        emit("lines-progress", { done, total: want.length });
        if (onProgress) onProgress(done, want.length);
      }
      return done === want.length;
    })().finally(() => { allRunning = null; });
    return allRunning;
  }
  async function linesStored() {
    if (!active) return { done: 0, total: 0 };
    const want = Object.keys(active.files).filter((k) => k.startsWith("line:"));
    const keys = new Set(await idb.keys("data"));
    return { done: want.filter((k) => keys.has(k)).length, total: want.length };
  }
  function setOfflineAll(v) {
    ls.set("tt-offline-all", !!v);
    if (v) return downloadAllLines();
    return Promise.resolve();
  }

  /* —— background sync —— */
  let syncing = null;
  function sync(opts) {
    const force = opts && opts.force;
    if (syncing) return syncing;
    if (navigator.onLine === false) return Promise.resolve(false);
    if (!force && Date.now() - ls.get("tt-data-check", 0) < DAY_MS) return Promise.resolve(false);
    syncing = (async () => {
      const have = await essentials();
      if (!have) return false; /* first-run download failed; essentials() retries */
      let m;
      try { m = await fetchManifest(); } catch (e) { return false; }
      ls.set("tt-data-check", Date.now());
      if (active && m.version === active.version) return false;
      const sameStops = active && active.files.stops.hash === m.files.stops.hash;
      const sameLines = active && active.files.lines.hash === m.files.lines.hash;
      let fresh;
      try {
        fresh = {
          stops: sameStops ? have.stops : await fetchJSON(DATA_BASE + m.files.stops.path),
          lines: sameLines ? have.lines : await fetchJSON(DATA_BASE + m.files.lines.path),
        };
      } catch (e) { return false; }
      await idb.put("data", "stops", { hash: m.files.stops.hash, body: fresh.stops });
      await idb.put("data", "lines", { hash: m.files.lines.hash, body: fresh.lines });
      /* drop line files that are gone or changed (re-fetched lazily, or below when offline-all is on) */
      for (const k of await idb.keys("data")) {
        if (!k.startsWith("line:")) continue;
        const f = m.files[k];
        const rec = f && await idb.get("data", k);
        if (!f || !rec || rec.hash !== f.hash) await idb.del("data", k);
      }
      await idb.put("meta", "manifest", m);
      active = m;
      essentialsP = Promise.resolve({ manifest: m, stops: fresh.stops, lines: fresh.lines });
      emit("updated", { manifest: m, stops: fresh.stops, lines: fresh.lines });
      if (offlineAll()) downloadAllLines();
      return true;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  /* —— API cache (per-endpoint TTL, stale fallback) —— */
  let apiWrites = 0;
  /**
   * cached(url, {ttl, swr, timeout}) → {body, at, stale, cached}
   *  fresh (age < ttl)        → cache, no request
   *  swr  (age < swr)         → cache now, revalidate in background
   *  otherwise                → network; on failure the last cached copy (stale: true)
   */
  async function cached(url, opts) {
    const o = opts || {};
    const rec = await idb.get("api", url);
    const age = rec ? Date.now() - rec.at : Infinity;
    const net = () => fetchJSON(url, { timeout: o.timeout }).then((body) => {
      const r = { at: Date.now(), body };
      idb.put("api", url, r);
      if (++apiWrites % 50 === 0) pruneApi();
      return r;
    });
    if (rec && age < (o.ttl || 0)) return { body: rec.body, at: rec.at, stale: false, cached: true };
    if (rec && o.swr && age < o.swr && navigator.onLine !== false) {
      net().catch(() => {});
      return { body: rec.body, at: rec.at, stale: false, cached: true };
    }
    try {
      const r = await net();
      return { body: r.body, at: r.at, stale: false, cached: false };
    } catch (e) {
      if (rec && (!o.maxStale || age < o.maxStale)) return { body: rec.body, at: rec.at, stale: true, cached: true, error: e };
      throw e;
    }
  }
  async function pruneApi() {
    const keys = await idb.keys("api");
    if (keys.length < 400) return;
    const recs = await Promise.all(keys.map((k) => idb.get("api", k).then((r) => [k, r ? r.at : 0])));
    recs.sort((a, b) => a[1] - b[1]);
    for (const [k] of recs.slice(0, recs.length - 300)) await idb.del("api", k);
  }

  /* —— feed expiry —— */
  function expiry() {
    if (!active || !active.feed_end) return null;
    const end = Date.parse(active.feed_end + "T23:59:59+04:00");
    const days = Math.floor((end - Date.now()) / DAY_MS);
    return { feedEnd: active.feed_end, days, expired: days < 0, soon: days >= 0 && days <= 5 };
  }

  window.addEventListener("online", () => { if (!active) essentials(); sync({ force: true }); });

  window.TTStore = {
    ls, idb, on, essentials, getLine, sync, cached, expiry, fetchJSON,
    offlineAll, setOfflineAll, downloadAllLines, linesStored,
    manifest: () => active,
  };
})();
