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
