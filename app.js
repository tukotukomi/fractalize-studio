(function () {
  // Gives the engine's own internal camera-roll panel (reachable once
  // inside the fractal/visualizer) the same photos this page's own grid
  // shows below -- see window.FRACTALIZE_CATALOG in photo-catalog.js.
  window.FractalizeCore.setPhotoCatalog(window.FRACTALIZE_CATALOG || []);

  // --- Scroll-scrubbed background ---------------------------------------
  // .page-bg-video (see index.html/styles.css) deliberately has no
  // autoplay -- its currentTime is driven directly by scroll position
  // instead, so the fractal advances through frames as the page scrolls
  // down and rewinds as it scrolls back up, rather than animating on its
  // own. rAF-throttled since "scroll" fires far more often than a video
  // frame actually needs picking, and the source is encoded with every
  // frame as a keyframe specifically so each of these currentTime writes
  // seeks instantly instead of visibly stepping back to the nearest one.
  const bgVideo = document.querySelector("[data-page-bg-video]");
  if (bgVideo) {
    let bgScrubScheduled = false;
    function updateBgVideoFrame() {
      bgScrubScheduled = false;
      if (!bgVideo.duration) return;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      bgVideo.currentTime = progress * bgVideo.duration;
    }
    function scheduleBgScrub() {
      if (bgScrubScheduled) return;
      bgScrubScheduled = true;
      requestAnimationFrame(updateBgVideoFrame);
    }
    bgVideo.addEventListener("loadedmetadata", updateBgVideoFrame);
    window.addEventListener("scroll", scheduleBgScrub, { passive: true });
    window.addEventListener("resize", scheduleBgScrub);

    // iOS Safari (and, since Apple requires every iOS browser to use
    // WebKit under the hood, every other iOS browser too) is
    // conservative about ever decoding video that hasn't actually
    // played -- currentTime writes above are silently ignored there
    // until the decode pipeline's been kicked by a real play() call,
    // even with preload="auto" already set and the file fully
    // downloaded. A muted, inline video is allowed to play without a
    // user gesture, so play() immediately followed by pause() once
    // playback actually starts primes that pipeline invisibly -- it's
    // paused again within a frame or two, before a viewer would ever
    // see it move on its own, but WebKit now treats it as seekable.
    bgVideo.play().then(() => bgVideo.pause()).catch(() => {
      // Autoplay blocked outright (rare for a muted video, but possible
      // in some restricted/embedded context) -- scroll-scrub still
      // works via the currentTime writes above once metadata loads
      // regardless; this priming step is purely a best-effort assist
      // for WebKit specifically.
    });
  }

  // --- Sticky nav ------------------------------------------------------
  // Shows "FRACTALIZE STUDIO" in a fixed bar once .hero-logo scrolls out
  // of view, so the page identifies itself again after the full hero
  // (logo + banner + tagline) has scrolled past. threshold: 0 means
  // "visible" is anything still touching the viewport at all -- the bar
  // only appears once the logo is fully gone, not as soon as it starts
  // to leave.
  const stickyNav = document.querySelector("[data-sticky-nav]");
  const heroLogo = document.querySelector(".hero-logo");
  if (stickyNav && heroLogo && "IntersectionObserver" in window) {
    const stickyNavObserver = new IntersectionObserver(
      ([entry]) => {
        stickyNav.classList.toggle("is-visible", !entry.isIntersecting);
      },
      { threshold: 0 }
    );
    stickyNavObserver.observe(heroLogo);
  }

  // --- Live audio setup --------------------------------------------------
  // Same "Live audio input" checkbox + device picker the fractal/
  // visualizer settings panels have, but reachable before ever opening
  // either -- lets a visitor grant mic access and pick their VB-CABLE
  // (or similar) device once, up front, so whichever view they open
  // next is already reactive instead of needing the settings panel
  // mid-experience. wireLiveAudioControls is the exact same function
  // those panels use internally (see fractalize-core.js), just exposed
  // for a host page to call directly against its own markup.
  const liveAudioPanel = document.querySelector(".live-audio-help [data-live-audio-panel]");
  if (liveAudioPanel) window.FractalizeCore.wireLiveAudioControls(liveAudioPanel);

  // --- Curated photo grid -------------------------------------------
  const groupsEl = document.querySelector("[data-catalog-groups]");
  const FRACTAL_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16px" height="16px" fill="#111" fill-rule="evenodd"><path d="M12 3 L21 20 L3 20 Z M7.5 11.5 L16.5 11.5 L12 20 Z"/></svg>';
  const VISUALIZE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#111"><path d="M852-212 732-332l56-56 120 120-56 56ZM708-692l-56-56 120-120 56 56-120 120Zm-456 0L132-812l56-56 120 120-56 56ZM108-212l-56-56 120-120 56 56-120 120Zm246-75 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-361Z"/></svg>';

  (window.FRACTALIZE_CATALOG || []).forEach((group) => {
    const section = document.createElement("div");
    section.className = "catalog-group";
    const heading = document.createElement("h3");
    heading.className = "catalog-group-label";
    heading.textContent = group.label;
    section.appendChild(heading);

    const row = document.createElement("div");
    row.className = "catalog-row";
    group.photos.forEach((photo) => {
      const thumb = document.createElement("div");
      thumb.className = "catalog-thumb";
      thumb.innerHTML =
        '<img src="' + photo.thumbSrc + '" alt="" loading="lazy" decoding="async" width="200" height="200">' +
        '<div class="catalog-thumb-actions">' +
        '<button type="button" class="thumb-action" data-action="fractal" aria-label="Open as fractal">' +
        FRACTAL_ICON +
        "</button>" +
        '<button type="button" class="thumb-action" data-action="visualize" aria-label="Visualize to music">' +
        VISUALIZE_ICON +
        "</button>" +
        "</div>";
      thumb.querySelector('[data-action="fractal"]').addEventListener("click", () => {
        window.FractalizeCore.openFractal(photo.src);
      });
      thumb.querySelector('[data-action="visualize"]').addEventListener("click", () => {
        window.FractalizeCore.openVisualizer(photo.src);
      });
      row.appendChild(thumb);
    });
    section.appendChild(row);
    groupsEl.appendChild(section);
  });

  // --- Persisted uploads (IndexedDB) -------------------------------------
  // An uploaded photo is otherwise session-only: its blob: URL (see the
  // upload flow below) dies the moment this page closes, which is why
  // opening one passes persistQueue:false -- the engine's own queue only
  // ever stores src strings, and a dead blob: URL in it would fail to
  // load on a future visit. Storing the actual File here instead (never
  // the blob: URL itself, which can't survive a reload either way) lets
  // a visitor's own uploads survive across visits on THIS device --
  // nothing leaves the browser, still true to the footer's own claim,
  // just no longer only for the current tab's lifetime. Best-effort, not
  // durable: browsers can evict this under storage pressure or after a
  // period of disuse, and clearing site data wipes it outright --
  // acceptable for a free, no-backend solution, not a promise of
  // permanence, and every call below degrades to "this upload just
  // works for the current session, same as before" if IndexedDB is
  // unavailable or blocked.
  const UPLOADS_DB_NAME = "fractalizeStudioUploads";
  const UPLOADS_STORE = "photos";

  function openUploadsDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(UPLOADS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(UPLOADS_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function saveUploadedPhoto(file) {
    return openUploadsDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const record = {
            id: Date.now() + "-" + Math.random().toString(36).slice(2),
            blob: file,
            name: file.name,
            addedAt: Date.now(),
          };
          const tx = db.transaction(UPLOADS_STORE, "readwrite");
          tx.objectStore(UPLOADS_STORE).add(record);
          tx.oncomplete = () => resolve(record);
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function getAllUploadedPhotos() {
    return openUploadsDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(UPLOADS_STORE, "readonly").objectStore(UPLOADS_STORE).getAll();
          req.onsuccess = () => resolve(req.result.sort((a, b) => b.addedAt - a.addedAt));
          req.onerror = () => reject(req.error);
        })
    );
  }

  function deleteUploadedPhoto(id) {
    return openUploadsDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(UPLOADS_STORE, "readwrite");
          tx.objectStore(UPLOADS_STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  const uploadsSection = document.querySelector("[data-uploads-catalog]");
  const uploadsRow = document.querySelector("[data-uploads-row]");
  const DELETE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#111"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360Z"/></svg>';

  // A record's own blob: URL is created once here and reused for both
  // this thumbnail's <img> and whatever Fractal/Visualize opens -- no
  // reason to mint a second one for the same File.
  function renderUploadThumb(record) {
    const url = URL.createObjectURL(record.blob);
    const thumb = document.createElement("div");
    thumb.className = "catalog-thumb";
    thumb.innerHTML =
      '<img src="' + url + '" alt="" loading="lazy" decoding="async" width="200" height="200">' +
      '<div class="catalog-thumb-actions">' +
      '<button type="button" class="thumb-action" data-action="fractal" aria-label="Open as fractal">' +
      FRACTAL_ICON +
      "</button>" +
      '<button type="button" class="thumb-action" data-action="visualize" aria-label="Visualize to music">' +
      VISUALIZE_ICON +
      "</button>" +
      '<button type="button" class="thumb-action" data-action="delete" aria-label="Delete this upload">' +
      DELETE_ICON +
      "</button>" +
      "</div>";
    thumb.querySelector('[data-action="fractal"]').addEventListener("click", () => {
      window.FractalizeCore.openFractal(url, { persistQueue: false });
    });
    thumb.querySelector('[data-action="visualize"]').addEventListener("click", () => {
      window.FractalizeCore.openVisualizer(url);
    });
    thumb.querySelector('[data-action="delete"]').addEventListener("click", () => {
      deleteUploadedPhoto(record.id).then(() => {
        URL.revokeObjectURL(url);
        thumb.remove();
        if (!uploadsRow.children.length) uploadsSection.hidden = true;
      });
    });
    return thumb;
  }

  if (uploadsSection && uploadsRow) {
    getAllUploadedPhotos()
      .then((records) => {
        if (!records.length) return;
        records.forEach((record) => uploadsRow.appendChild(renderUploadThumb(record)));
        uploadsSection.hidden = false;
      })
      .catch(() => {
        // IndexedDB unavailable/blocked -- new uploads below still work
        // for the current session, just without persistence.
      });
  }

  // --- Upload flow -----------------------------------------------------
  // A blob: URL only lives as long as this page does, so it's opened
  // with persistQueue:false (see fractalize-core's own README) --
  // otherwise it would get written into the engine's persisted
  // camera-roll queue and fail to reload on a future visit.
  const dropzone = document.querySelector("[data-upload-dropzone]");
  const fileInput = document.querySelector("[data-upload-input]");
  const actionsRow = document.querySelector("[data-upload-actions]");
  const previewImg = document.querySelector("[data-upload-preview]");
  let uploadedUrl = null;

  function handleFile(file) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
    uploadedUrl = URL.createObjectURL(file);
    previewImg.src = uploadedUrl;
    actionsRow.hidden = false;

    if (uploadsSection && uploadsRow) {
      saveUploadedPhoto(file)
        .then((record) => {
          uploadsRow.insertBefore(renderUploadThumb(record), uploadsRow.firstChild);
          uploadsSection.hidden = false;
        })
        .catch(() => {
          // Storage unavailable or quota exceeded -- this upload still
          // works for the current session via the preview above, it
          // just won't be there on a future visit.
        });
    }
  }

  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    });
  });
  ["dragleave", "dragend", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  document.querySelector("[data-upload-fractal]").addEventListener("click", () => {
    if (uploadedUrl) window.FractalizeCore.openFractal(uploadedUrl, { persistQueue: false });
  });
  document.querySelector("[data-upload-visualize]").addEventListener("click", () => {
    if (uploadedUrl) window.FractalizeCore.openVisualizer(uploadedUrl);
  });
})();
