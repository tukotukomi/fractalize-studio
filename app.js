(function () {
  // Gives the engine's own internal camera-roll panel (reachable once
  // inside the fractal/visualizer) the same photos this page's own grid
  // shows below -- see window.FRACTALIZE_CATALOG in photo-catalog.js.
  window.FractalizeCore.setPhotoCatalog(window.FRACTALIZE_CATALOG || []);

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
