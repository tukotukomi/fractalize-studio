// Phone controller for a Fractalize Studio fractal running on another
// device. Connects to the relay Worker (see ../relay/) as the "remote" of
// the room named in the URL hash; the desktop shows the QR code that
// links here and must approve this phone before any command works.
//
// The desktop describes its own controls in every "state" message (sliders
// with their ranges, toggles, timers, queue, current photo), and this page
// just renders that -- so settings added to the desktop panel show up here
// without a change to this file.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const statusEl = $("[data-status]");
  const messageEl = $("[data-message]");
  const tabsEl = $("[data-tabs]");
  const controlsEl = $("[data-controls]");
  const randomizerEl = $("[data-randomizer]");
  const shuffleEl = $("[data-shuffle]");
  const rollEl = $("[data-roll]");
  const panels = { filters: $('[data-panel="filters"]'), roll: $('[data-panel="roll"]') };

  const room = location.hash.replace(/^#/, "");
  const relay = window.FRACTALIZE_RELAY_URL;

  let cid;
  try {
    cid = sessionStorage.getItem("fractalizeRemoteCid");
    if (!cid) {
      cid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem("fractalizeRemoteCid", cid);
    }
  } catch (e) {
    cid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-ok", !!ok);
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = !text;
  }

  function showPanels(connected) {
    tabsEl.hidden = !connected;
    if (!connected) {
      panels.filters.hidden = true;
      panels.roll.hidden = true;
    } else {
      selectTab(currentTab);
    }
  }

  let currentTab = "filters";
  function selectTab(name) {
    currentTab = name;
    panels.filters.hidden = name !== "filters";
    panels.roll.hidden = name !== "roll";
    tabsEl.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
  }
  tabsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) selectTab(b.dataset.tab);
  });

  if (!room || !relay) {
    setStatus("Not connected");
    showMessage(
      !room
        ? "Open this page by scanning the QR code shown in Fractalize Studio on your computer."
        : "This site isn't set up for remote control yet."
    );
    return;
  }

  // --- Connection -------------------------------------------------------
  let ws = null;
  let retry = 0;
  let pingTimer = null;
  let accepted = false;
  let ended = false; // denied / desktop said goodbye -- stop reconnecting

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  const hello = () => send({ t: "hello", cid });

  function connect() {
    if (ended) return;
    setStatus(accepted ? "Reconnecting…" : "Connecting…");
    ws = new WebSocket(relay.replace(/\/$/, "") + "/room/" + room + "?role=remote");
    const socket = ws;
    socket.onopen = () => {
      retry = 0;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket.readyState === 1) socket.send("ping");
      }, 25000);
    };
    socket.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      handle(msg);
    };
    socket.onclose = () => {
      clearInterval(pingTimer);
      if (ws === socket) ws = null;
      if (ended) return;
      showPanels(false);
      setStatus("Reconnecting…");
      setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, retry++)));
    };
    socket.onerror = () => {};
  }

  function handle(msg) {
    if (ended) return; // e.g. the relay's peer-left arriving right after the desktop's goodbye
    if (msg.t === "sys") {
      if (msg.ev === "welcome") {
        if (msg.peer) hello();
        else setStatus("Waiting for your computer…");
      } else if (msg.ev === "peer-joined" && msg.role === "host") hello();
      else if (msg.ev === "peer-left" && msg.role === "host") {
        showPanels(false);
        showMessage("Your computer disconnected. Reconnecting…");
        setStatus("Waiting for your computer…");
      }
    } else if (msg.t === "who") hello();
    else if (msg.t === "accepted") {
      accepted = true;
      showMessage("");
      setStatus("Connected", true);
    } else if (msg.t === "denied") {
      ended = true;
      showPanels(false);
      setStatus("Not connected");
      showMessage("Your computer declined this phone.");
      if (ws) ws.close();
    } else if (msg.t === "bye") {
      ended = true;
      showPanels(false);
      setStatus("Not connected");
      showMessage("The session ended on your computer.");
      if (ws) ws.close();
    } else if (msg.t === "state" && msg.state) {
      accepted = true;
      setStatus("Connected", true);
      showMessage("");
      showPanels(true);
      render(msg.state);
    }
  }

  // --- Commands ---------------------------------------------------------
  // Slider drags send at most ~12 updates a second, plus a final one when
  // the finger lifts, so the desktop and relay only see what matters.
  const pending = {};
  function sendSet(key, value) {
    const p = pending[key] || (pending[key] = { last: 0, timer: null, value });
    p.value = value;
    const now = Date.now();
    const wait = 80 - (now - p.last);
    if (wait <= 0) {
      p.last = now;
      send({ t: "set", key, value });
    } else if (!p.timer) {
      p.timer = setTimeout(() => {
        p.timer = null;
        p.last = Date.now();
        send({ t: "set", key, value: p.value });
      }, wait);
    }
  }

  // --- Rendering --------------------------------------------------------
  let controlsSignature = "";
  const rangeEls = {};
  const toggleEls = {};
  const dragging = {};

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildControls(controls) {
    controlsEl.innerHTML = "";
    Object.keys(rangeEls).forEach((k) => delete rangeEls[k]);
    Object.keys(toggleEls).forEach((k) => delete toggleEls[k]);
    controls.forEach((c, i) => {
      if (c.kind === "divider") {
        // A trailing divider (nothing after it) is just noise here.
        if (i < controls.length - 1) {
          const hr = el("hr", "remote-divider");
          hr.dataset.index = i;
          controlsEl.appendChild(hr);
        }
        return;
      }
      const row = el("div", "remote-row");
      row.dataset.index = i;
      if (c.kind === "range") {
        const head = el("div", "remote-row-label");
        head.appendChild(el("span", "", c.label));
        const val = el("span", "remote-value", c.text);
        head.appendChild(val);
        const input = document.createElement("input");
        input.type = "range";
        input.min = c.min;
        input.max = c.max;
        input.step = c.step;
        input.value = c.value;
        input.addEventListener("input", () => sendSet(c.key, Number(input.value)));
        const start = () => (dragging[c.key] = true);
        const stop = () => {
          dragging[c.key] = false;
          send({ t: "set", key: c.key, value: Number(input.value) });
        };
        input.addEventListener("pointerdown", start);
        input.addEventListener("touchstart", start, { passive: true });
        input.addEventListener("pointerup", stop);
        input.addEventListener("touchend", stop);
        input.addEventListener("change", stop);
        row.appendChild(head);
        row.appendChild(input);
        rangeEls[c.key] = { input, val };
      } else {
        const label = el("label", "remote-toggle");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = c.checked;
        box.addEventListener("change", () => send({ t: "toggle", key: c.key, checked: box.checked }));
        label.appendChild(box);
        label.appendChild(el("span", "", c.label));
        row.appendChild(label);
        toggleEls[c.key] = box;
      }
      if (c.hint) row.appendChild(el("p", "remote-hint", c.hint));
      controlsEl.appendChild(row);
    });
  }

  function applyControlValues(controls) {
    controls.forEach((c) => {
      if (c.kind === "range") {
        const r = rangeEls[c.key];
        if (!r) return;
        if (!dragging[c.key]) r.input.value = c.value;
        r.val.textContent = c.text;
      } else if (c.kind === "toggle") {
        const t = toggleEls[c.key];
        if (t) t.checked = c.checked;
      }
    });
    // Rows the desktop is hiding right now (e.g. the music sliders while
    // live audio is off) are hidden here too.
    Array.prototype.forEach.call(controlsEl.children, (row) => {
      const c = controls[Number(row.dataset.index)];
      row.hidden = !!(c && c.hidden);
    });
  }

  function renderTimer(container, title, toggleKey, cfg, secCmd, withNow) {
    const sig = JSON.stringify([title, cfg.options]);
    if (container.dataset.sig !== sig) {
      container.dataset.sig = sig;
      container.innerHTML = "";
      const head = el("label", "remote-toggle");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => send({ t: "toggle", key: toggleKey, checked: box.checked }));
      head.appendChild(box);
      head.appendChild(el("span", "", title));
      container.appendChild(head);
      const pills = el("div", "remote-pills");
      pills.style.marginTop = "10px";
      cfg.options.forEach((o) => {
        const b = el("button", "remote-pill", o.label);
        b.type = "button";
        b.dataset.sec = o.sec;
        b.addEventListener("click", () => send({ t: secCmd, sec: o.sec }));
        pills.appendChild(b);
      });
      container.appendChild(pills);
      if (withNow) {
        const now = el("button", "remote-action", "RANDOMIZE NOW");
        now.type = "button";
        now.addEventListener("click", () => send({ t: "randomizeNow" }));
        container.appendChild(now);
      }
    }
    container.querySelector("input").checked = !!cfg.enabled;
    container.querySelectorAll(".remote-pill").forEach((b) => b.classList.toggle("is-active", Number(b.dataset.sec) === cfg.sec));
  }

  // Camera roll: built once from this page's own copy of the photo catalog
  // (curated photos only -- a photo uploaded on the desktop isn't
  // available here), then just re-highlighted on each state update.
  const thumbEls = {};
  let rollBuilt = false;
  function buildRoll() {
    rollBuilt = true;
    (window.FRACTALIZE_CATALOG || []).forEach((group) => {
      if (!group.photos || !group.photos.length) return;
      rollEl.appendChild(el("h4", "roll-section-label", group.label));
      const grid = el("div", "roll-grid");
      group.photos.forEach((photo) => {
        const thumb = el("div", "roll-thumb");
        thumb.setAttribute("role", "button");
        thumb.setAttribute("aria-label", "Show this photo");
        const img = document.createElement("img");
        img.src = photo.thumbSrc || photo.src;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        thumb.appendChild(img);
        const q = el("button", "roll-queue", "+");
        q.type = "button";
        q.setAttribute("aria-label", "Add to or remove from queue");
        q.addEventListener("click", (e) => {
          e.stopPropagation();
          send({ t: "queue", src: photo.src });
        });
        thumb.appendChild(q);
        thumb.addEventListener("click", () => send({ t: "play", src: photo.src }));
        grid.appendChild(thumb);
        thumbEls[photo.src] = thumb;
      });
      rollEl.appendChild(grid);
    });
  }

  function render(state) {
    const sig = JSON.stringify(
      state.controls.map((c) => [c.kind, c.key, c.label, c.min, c.max, c.step, c.hint])
    );
    if (sig !== controlsSignature) {
      controlsSignature = sig;
      buildControls(state.controls);
    }
    applyControlValues(state.controls);
    renderTimer(randomizerEl, "Randomizer", "randomizerEnabled", state.randomizer, "randomizerSec", true);
    renderTimer(shuffleEl, "Enable shuffle", "shuffleEnabled", state.shuffle, "shuffleSec", false);
    if (!rollBuilt) buildRoll();
    const queued = {};
    (state.queue || []).forEach((s) => (queued[s] = true));
    Object.keys(thumbEls).forEach((src) => {
      thumbEls[src].classList.toggle("is-queued", !!queued[src]);
      thumbEls[src].classList.toggle("is-playing", src === state.current);
    });
  }

  connect();
})();
