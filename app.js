(function () {
  // Gives the engine's own internal camera-roll grid (reachable once
  // inside the fractal) and its own "Your Uploads" section (reachable
  // once inside the visualizer) the same photos this page's own grids
  // show below -- both the curated catalog (window.FRACTALIZE_CATALOG)
  // AND, once loaded, this visitor's own persisted uploads (see the
  // "Persisted uploads" section further down), as a second "Your
  // Uploads" group, so an uploaded photo can be queued/shuffled/shown
  // from inside either overlay the exact same way a curated one can.
  // Always unshifted first, even with zero uploads yet -- mirrors this
  // page's own persistent .uploads-catalog section (see index.html),
  // and both of fractalize-core's own "Your Uploads" spots treat
  // whichever group is first as the one to add its own "+" tile to
  // (see setUploadHandler's own comment there), so this group's
  // position here is exactly what keeps that lined up. Called again
  // every time the uploads list changes (new upload, delete) --
  // setPhotoCatalog itself invalidates both overlays' own "build once"
  // caches when that happens, so the next time either is opened
  // reflects the change rather than a stale snapshot from the first
  // open.
  let uploadedPhotoRecords = []; // [{id, url}], kept in sync with IndexedDB below
  function rebuildFullCatalog() {
    const groups = (window.FRACTALIZE_CATALOG || []).slice();
    groups.unshift({
      label: "Your Uploads",
      photos: uploadedPhotoRecords.map((r) => ({ src: r.url, thumbSrc: r.url })),
    });
    window.FractalizeCore.setPhotoCatalog(groups);
  }
  rebuildFullCatalog();

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

  // --- "Start fractalizing" panel -------------------------------------
  // The page's own live-audio entry point (see index.html) -- resolve
  // live audio first, then reveal a "PICK YOUR IMAGE" step rather than
  // landing straight on a random photo. Its panel is wired via the
  // exact same wireLiveAudioControls the fractal/visualizer's own
  // settings panels use internally (same shared microphone stream), and
  // syncLiveAudioPanel on open reflects an already-granted stream from
  // one of THOSE immediately, rather than only after this one's own
  // button is clicked. Inline disclosure, not a popup -- .hero-cta just toggles
  // it open/closed in place (clicking it again, or the panel's own
  // "Use Without Live Audio" button, is how it closes -- no separate
  // close control).
  const startBtn = document.querySelector("[data-start-fractalizing]");
  const startPanel = document.querySelector("[data-start-panel]");
  const startFractalizingHeader = document.querySelector("[data-start-fractalizing-header]");
  const startFractalizingStep = document.querySelector("[data-start-fractalizing-step]");
  const pickImageBtn = document.querySelector("[data-pick-image]");
  const pickImageStep = document.querySelector("[data-pick-image-step]");
  const pickImageRow = document.querySelector("[data-pick-image-row]");
  const pickImageMarker = document.querySelector("[data-pick-image-marker]");
  const liveAudioConfirm = document.querySelector("[data-live-audio-confirm]");
  const liveAudioConfirmLabel = document.querySelector("[data-live-audio-confirm-label]");
  const photoCollection = document.querySelector("[data-photo-collection]");
  const stepConnector = document.querySelector("[data-step-connector]");
  const stickyAudioBanner = document.querySelector("[data-sticky-audio-banner]");

  // ➁ has two forms shown at different points (see index.html/app.js
  // below) -- the full "➁ Pick your image" line before "Use Live Audio
  // Input" is clicked, then just the marker alongside PICK YOUR IMAGE
  // after. Whichever is actually visible right now is what the step
  // connector should point at.
  function currentStep2El() {
    if (pickImageStep && !pickImageStep.hidden) return pickImageStep;
    if (pickImageMarker && pickImageRow && !pickImageRow.hidden) return pickImageMarker;
    return null;
  }

  // Dotted line "denoting progress" between the ➀/➁ step lines -- both
  // shown together as soon as .start-panel opens (see openStartPanel
  // below), so this is too. No shared positioned ancestor spans both --
  // ➀ lives in .hero, ➁ in main, with .start-panel (open or closed, and
  // while open, whatever height its own content currently has) sitting
  // between them -- so this measures each line's own
  // getBoundingClientRect() directly and positions/sizes
  // .step-connector in document coordinates instead of relying on CSS
  // alone. Runs from ➀'s own bottom edge to ➁'s own top edge, not the
  // full height of either line.
  function updateStepConnector() {
    if (!stepConnector || !startFractalizingStep) return;
    const to = currentStep2El();
    if (startFractalizingStep.hidden || !to) {
      stepConnector.hidden = true;
      return;
    }
    const from = startFractalizingStep.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const top = from.bottom + window.scrollY;
    const bottom = toRect.top + window.scrollY;
    stepConnector.style.top = top + "px";
    stepConnector.style.height = Math.max(0, bottom - top) + "px";
    // Centered under each line's own left edge's midpoint isn't the
    // goal here -- horizontally this just needs to line up with both
    // (they share one, see .hero's own max-width comment above), with
    // a small gutter so it reads as "alongside" the text, not through it.
    stepConnector.style.left = from.left + window.scrollX - 16 + "px";
    stepConnector.hidden = false;
  }
  window.addEventListener("resize", updateStepConnector);

  if (startBtn && startPanel) {
    const startPanelLiveAudioBtn = document.querySelector("[data-start-panel-live-audio-btn]");
    const startPanelStopBtn = document.querySelector("[data-start-panel-stop]");
    const startPanelSkipBtn = document.querySelector("[data-start-panel-skip]");
    const startPanelCheckbox = startPanel.querySelector('[data-toggle="liveAudio"]');
    const startPanelLiveAudioPanel = startPanel.querySelector("[data-live-audio-panel]");

    window.FractalizeCore.wireLiveAudioControls(startPanelLiveAudioPanel);
    // Live audio here is page-level, persistent state -- this page's own
    // "Live Audio In Use" button/banner reflect it independent of
    // whether the fractal or visualizer happens to be open right now,
    // unlike tuckermills.com's embedded instance (never calls this),
    // where closing either view is normally also the end of that visit
    // to a photo. A visitor here is far more likely to close one photo's
    // fractal only to immediately reopen a different one from this same
    // page -- without this, that would silently re-prompt for
    // permission (or at minimum re-request the device) every single
    // time.
    window.FractalizeCore.setKeepLiveAudioOnClose(true);

    // liveaudiostatechange fires whenever this panel's own live-audio
    // state becomes definitively known -- true once enable actually
    // succeeds, false on denial/disconnect/explicit uncheck/any other
    // panel's own stop (see fractalize-core.js), so this reflects the
    // real, granted browser permission state, not just "was clicked".
    // Drives the button's two-stage label/color: "Use Live Audio
    // Input" (not yet active, clicking requests it) vs "Live Audio In
    // Use" in the positive-state color, #eee8ae (already active,
    // clicking proceeds -- see .start-panel-live-audio-btn.is-active
    // in styles.css).
    let liveAudioActive = false;
    startPanelLiveAudioPanel.addEventListener("liveaudiostatechange", (e) => {
      liveAudioActive = e.detail.active;
      startPanelLiveAudioBtn.textContent = liveAudioActive ? "Live Audio In Use" : "Use Live Audio Input";
      startPanelLiveAudioBtn.classList.toggle("is-active", liveAudioActive);
      // Only worth showing once there's actually a stream running to
      // stop -- same condition .fractal-controls-audio-device itself
      // reveals on (fractalize-core.js's own doing, not this listener),
      // so the two show/hide together.
      if (startPanelStopBtn) startPanelStopBtn.hidden = !liveAudioActive;
      // Granting live audio reveals the panel's own device-picker/
      // waveform row, changing .start-panel's height -- and so ➁'s own
      // position, since it sits right after the panel. Deferred a frame
      // so that reflow settles before re-measuring.
      requestAnimationFrame(updateStepConnector);
      updateStickyAudioBanner();
    });

    // Unchecking the real checkbox (rather than calling some bespoke
    // "stop" of this button's own) routes through the exact same
    // disableLiveAudio path fractalize-core.js already uses for a
    // device disconnect or another panel's own stop -- stops the
    // actual stream, and (via that function's own
    // liveaudiostatechange dispatch) fires the listener right above,
    // which is what actually reverts this button's text/color and
    // hides this one again. Nothing else in this flow needs resetting:
    // ➁ becoming reachable was always tied to clicking "Use Live Audio
    // Input" itself, not to audio actually staying active (a visitor
    // can already reach it via "Use Without Live Audio"), so stopping
    // here doesn't take that back.
    if (startPanelStopBtn) {
      startPanelStopBtn.addEventListener("click", () => {
        startPanelCheckbox.checked = false;
        startPanelCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    // --- Sticky live-audio banner ---------------------------------------
    // A positive-state strip along .sticky-nav's own bottom edge (see its
    // own comment in index.html/styles.css), shown only once BOTH: the
    // confirm button above has scrolled fully out of view, AND live audio
    // is actually active -- neither on its own is enough (scrolled past
    // it before ever granting audio, or granted but still looking at the
    // button itself, shouldn't show this). Depends on two independent
    // signals that change at different times -- scroll position (this
    // observer) and liveAudioActive (the listener above) -- so both call
    // the same recompute rather than either one owning the toggle
    // directly.
    let scrolledPastLiveAudioConfirm = false;
    function updateStickyAudioBanner() {
      if (!stickyAudioBanner) return;
      stickyAudioBanner.classList.toggle("is-visible", scrolledPastLiveAudioConfirm && liveAudioActive);
    }
    if (stickyAudioBanner && liveAudioConfirm && "IntersectionObserver" in window) {
      const stickyAudioBannerObserver = new IntersectionObserver(
        ([entry]) => {
          // "Scrolled past" specifically means the button left via the
          // TOP (the visitor scrolled down beyond it) -- isIntersecting
          // alone doesn't distinguish that from "hasn't been scrolled to
          // yet" (also false), which would show this before the button
          // was ever seen. height > 0 additionally guards against a
          // display:none button (hidden before PICK YOUR IMAGE, or again
          // after a full reset) reporting an empty, all-zero rect of its
          // own -- bottom <= 0 would otherwise be trivially true then,
          // wrongly reading as "scrolled past" a button that was never
          // actually on screen to begin with.
          scrolledPastLiveAudioConfirm =
            !entry.isIntersecting &&
            entry.boundingClientRect.height > 0 &&
            entry.boundingClientRect.bottom <= 0;
          updateStickyAudioBanner();
        },
        { threshold: 0 }
      );
      stickyAudioBannerObserver.observe(liveAudioConfirm);
    }

    function launchRandomFractal() {
      const pool = [];
      (window.FRACTALIZE_CATALOG || []).forEach((group) => {
        group.photos.forEach((photo) => pool.push(photo));
      });
      if (!pool.length) return;
      const photo = pool[Math.floor(Math.random() * pool.length)];
      window.FractalizeCore.openFractal(photo.src);
    }

    function openStartPanel() {
      startPanel.hidden = false;
      startBtn.setAttribute("aria-expanded", "true");
      // The button that was just clicked is gone now, replaced by a
      // header naming what's open in its place -- see the comment
      // above [data-start-fractalizing] in index.html.
      startBtn.hidden = true;
      if (startFractalizingHeader) startFractalizingHeader.hidden = false;
      if (startFractalizingStep) {
        startFractalizingStep.hidden = false;
        // Step 1 is the one actually in progress now -- see
        // .start-fractalizing-step.is-current in styles.css.
        startFractalizingStep.classList.add("is-current");
      }
      // ➁'s own label shows right alongside ➀ from here too -- see the
      // comment above [data-pick-image-step] in index.html -- with the
      // connector between them following in the same tick below.
      if (pickImageStep) pickImageStep.hidden = false;
      window.FractalizeCore.syncLiveAudioPanel(startPanelLiveAudioPanel);
      // Deferred a frame so the reflow from the hidden/shown swap above
      // settles first -- scrolling on the same tick can run against a
      // layout the browser hasn't finished recomputing yet, and on iOS
      // Safari specifically, its dynamic address bar resizing the
      // viewport mid-scroll only makes that worse. block:'start' (not
      // the panel's own old 'nearest') is deliberate here: the header
      // is the new thing to focus on -- unlike scrolling the panel
      // itself while the CTA above it was still visible, there's no
      // longer anything above worth not scrolling past, especially on
      // mobile where the header can otherwise land under the sticky
      // nav or off the top of a short viewport entirely.
      requestAnimationFrame(() => {
        updateStepConnector();
        (startFractalizingHeader || startPanel).scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    // keepProgress: true from the PICK YOUR IMAGE path below -- ➀/➁ and
    // the header need to stay put there (not reset like every other
    // close path), since they're this flow's permanent progress trail
    // once reached, not just this one open/close cycle's own state.
    function closeStartPanel(keepProgress) {
      startBtn.setAttribute("aria-expanded", "false");
      if (keepProgress) {
        // Hides the panel entirely, same as every other close path --
        // but [data-live-audio-confirm] takes its place right there
        // instead of nothing, a standalone duplicate of the panel's own
        // live-audio button (copied over once here, not kept
        // live-synced afterward -- see its own comment in index.html).
        // Sets the label span's own text, not the button's textContent
        // directly -- the button also has a waveform canvas sibling
        // now (see index.html), which textContent would silently wipe.
        startPanel.hidden = true;
        if (liveAudioConfirm) {
          if (liveAudioConfirmLabel) liveAudioConfirmLabel.textContent = startPanelLiveAudioBtn.textContent;
          liveAudioConfirm.classList.toggle("is-active", liveAudioActive);
          liveAudioConfirm.hidden = false;
        }
        // Its own IntersectionObserver should already catch this button
        // newly appearing in the layout, but a deferred explicit call
        // here (same reflow-settling reasoning as updateStepConnector's
        // own deferred calls elsewhere) keeps the sticky banner from
        // ever lagging a frame behind if a visitor is already scrolled
        // past where this button lands the instant it shows up.
        requestAnimationFrame(updateStickyAudioBanner);
        return;
      }
      startPanel.hidden = true;
      startBtn.hidden = false;
      if (liveAudioConfirm) {
        liveAudioConfirm.hidden = true;
        liveAudioConfirm.classList.remove("is-active");
      }
      // Same reasoning as the keepProgress branch above, in reverse --
      // this button just disappeared.
      requestAnimationFrame(updateStickyAudioBanner);
      if (startFractalizingHeader) startFractalizingHeader.hidden = true;
      if (startFractalizingStep) {
        startFractalizingStep.hidden = true;
        startFractalizingStep.classList.remove("is-current", "is-complete");
      }
      if (pickImageStep) pickImageStep.hidden = true;
      if (pickImageRow) pickImageRow.hidden = true;
      if (pickImageMarker) {
        pickImageMarker.classList.remove("is-current");
        // Undoes the PICK YOUR IMAGE click handler's own swap (see
        // below) -- back to the bare, aria-hidden marker for the next
        // time this flow is reopened.
        pickImageMarker.textContent = "➁";
        pickImageMarker.setAttribute("aria-hidden", "true");
      }
      if (pickImageBtn) pickImageBtn.classList.remove("is-done");
      if (stepConnector) stepConnector.hidden = true;
    }

    startBtn.addEventListener("click", () => {
      if (startPanel.hidden) openStartPanel();
      else closeStartPanel();
    });

    startPanelLiveAudioBtn.addEventListener("click", () => {
      // Reveals the real next step right on this click -- whether it's
      // requesting permission for the first time or, once already
      // granted, proceeding -- rather than waiting for a grant to
      // actually land first. "Use Without Live Audio" stays put, just
      // restyled down to a link (same click behavior) now that it
      // reads as a lesser, skip-this-step option next to it rather than
      // an equal choice. Neither of these resets when the panel
      // closes -- once reached, this counts as session progress, same
      // as .photo-collection itself never re-hiding once shown.
      startPanelSkipBtn.classList.add("is-link");
      // ➁'s own preview line simplifies to just the marker now that
      // PICK YOUR IMAGE (the row it shares with) is what actually names
      // this step -- see .pick-image-row's own comment in index.html.
      // ➀ stays "in progress" (.is-current, see styles.css) through
      // this and the live-audio grant itself -- it only hands off once
      // PICK YOUR IMAGE is actually clicked (see that handler below),
      // not just once this step's row becomes reachable.
      if (pickImageStep) pickImageStep.hidden = true;
      if (pickImageRow) pickImageRow.hidden = false;
      requestAnimationFrame(updateStepConnector);
      if (liveAudioActive) return;
      // Drives the same hidden checkbox wireLiveAudioControls is
      // listening on above -- if the visitor still needs to grant
      // permission, this is what triggers that browser dialog.
      startPanelCheckbox.checked = true;
      startPanelCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    });

    startPanelSkipBtn.addEventListener("click", () => {
      closeStartPanel();
      launchRandomFractal();
    });

    if (pickImageBtn && photoCollection) {
      pickImageBtn.addEventListener("click", () => {
        photoCollection.hidden = false;
        closeStartPanel(true);
        // Its own job done -- the marker next to it (already showing,
        // see the live-audio click handler above) stays behind as this
        // step's permanent record. .is-done, not hidden: keeps the
        // row's own height (see .pick-image-row's own comment) so the
        // marker doesn't jump once the button disappears.
        pickImageBtn.classList.add("is-done");
        // ➀ hands "in progress" off to ➁ right here -- not any earlier
        // in this flow (see the live-audio click handler above) -- now
        // that a photo is actually being picked. is-complete (not just
        // losing is-current) marks it done, in the same positive-state
        // color the live-audio buttons use.
        if (startFractalizingStep) {
          startFractalizingStep.classList.remove("is-current");
          startFractalizingStep.classList.add("is-complete");
        }
        if (pickImageMarker) {
          pickImageMarker.classList.add("is-current");
          // Was just a bare "➁" alongside the button (aria-hidden,
          // since the button's own label already read as this step's
          // real content) -- now the button's gone (.is-done below),
          // so this needs its own full text, same as ➀'s permanent
          // record above.
          pickImageMarker.textContent = "➁ Pick an image";
          pickImageMarker.removeAttribute("aria-hidden");
        }
        // Deferred a frame for the same reason openStartPanel's own
        // scroll is -- lets the reflow from unhiding/hiding settle
        // first (the step-connector needs that same settled layout to
        // measure against -- .start-panel just hid, replaced by
        // [data-live-audio-confirm] right underneath, which moves ➁ up,
        // so this re-measure matters here specifically). Scrolls back
        // up to ➀'s own line -- that standalone confirmation button is
        // the thing to actually confirm here, not the collection
        // further down (already revealed, just not what's brought into
        // view).
        requestAnimationFrame(() => {
          updateStepConnector();
          if (startFractalizingStep) {
            startFractalizingStep.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });
    }

    // Lets a visitor back into step 1 (e.g. to switch microphones)
    // without losing step 2's own progress -- exactly reverses
    // PICK YOUR IMAGE's own effects above: the confirm button that
    // replaced .start-panel hides again in favor of the real thing,
    // .photo-collection closes, and ➀/➁'s own markers swap back to
    // "step 1 in progress" (PICK YOUR IMAGE itself re-earns .is-done
    // once clicked again, same forward handler as before -- nothing
    // here is a one-way trip).
    if (liveAudioConfirm && startPanel) {
      liveAudioConfirm.addEventListener("click", () => {
        liveAudioConfirm.hidden = true;
        if (photoCollection) photoCollection.hidden = true;
        startPanel.hidden = false;
        // Reflects the actual, still-granted stream's current device
        // selection -- same call openStartPanel makes for the same
        // reason, just reopening here instead of opening for the first
        // time.
        window.FractalizeCore.syncLiveAudioPanel(startPanelLiveAudioPanel);
        if (pickImageBtn) pickImageBtn.classList.remove("is-done");
        if (startFractalizingStep) {
          startFractalizingStep.classList.remove("is-complete");
          startFractalizingStep.classList.add("is-current");
        }
        if (pickImageMarker) {
          pickImageMarker.classList.remove("is-current");
          pickImageMarker.textContent = "➁";
          pickImageMarker.setAttribute("aria-hidden", "true");
        }
        requestAnimationFrame(() => {
          updateStepConnector();
          if (startFractalizingStep) {
            startFractalizingStep.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });
    }
  }

  // --- Photo collections: card grid, cross-fading into one at a time ----
  // Landing spot once PICK YOUR IMAGE reveals .photo-collection -- with
  // six collections' worth of photos, showing every one's own full row of
  // thumbs at once (the old layout) made this section far too long to be
  // a reasonable first thing to land on. A card (cover photo, name,
  // description) per collection instead; clicking one cross-fades the
  // card grid out and its own full thumbnail grid in (see
  // .collection-slider-panel's own comment in styles.css for how -- a
  // horizontal slide shipped first, but reads jumpy once its own height
  // animation is added to the mix, since the two panels are rarely the
  // same height). See index.html's own comment for why "Your Uploads"
  // and a curated collection are handled by two separate sections within
  // the second panel rather than one shared, rebuilt-every-time
  // template.
  const collectionSlider = document.querySelector("[data-collection-slider]");
  const cardsPanel = document.querySelector("[data-cards-panel]");
  const expandedPanel = document.querySelector("[data-expanded-panel]");
  const collectionCardsEl = document.querySelector("[data-collection-cards]");
  const catalogBackBtn = document.querySelector("[data-catalog-back]");
  const uploadsSection = document.querySelector("[data-uploads-catalog]");
  const uploadsRow = document.querySelector("[data-uploads-row]");
  const curatedExpandedSection = document.querySelector("[data-curated-expanded]");
  const curatedExpandedHeading = document.querySelector("[data-curated-expanded-heading]");
  const curatedExpandedRow = document.querySelector("[data-curated-expanded-row]");
  // The uploads row's first, permanent child (see index.html) -- new
  // thumbs are always inserted right after it, never before, so it stays
  // the first tile no matter how many uploads pile up around it.
  const addTile = uploadsRow ? uploadsRow.querySelector(".catalog-add-thumb") : null;

  const FRACTAL_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16px" height="16px" fill="#111" fill-rule="evenodd"><path d="M12 3 L21 20 L3 20 Z M7.5 11.5 L16.5 11.5 L12 20 Z"/></svg>';
  const VISUALIZE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#111"><path d="M852-212 732-332l56-56 120 120-56 56ZM708-692l-56-56 120-120 56 56-120 120Zm-456 0L132-812l56-56 120 120-56 56ZM108-212l-56-56 120-120 56 56-120 120Zm246-75 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-361Z"/></svg>';

  // A plain thumb, no delete action -- only an upload (its own
  // renderUploadThumb below) can ever be removed. Shared by every
  // curated collection's own expanded row, rebuilt fresh each time one
  // is opened.
  function renderCuratedThumb(photo) {
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
    return thumb;
  }

  // A card's own cover: the collection's own first photo, or -- only
  // reachable for Your Uploads before anything's been added yet -- the
  // same "+" invitation .catalog-add-thumb itself uses, so an empty
  // uploads collection still reads as "add something here" rather than
  // a broken image.
  function collectionCoverHtml(coverSrc) {
    if (coverSrc) {
      return '<img src="' + coverSrc + '" alt="" loading="lazy" decoding="async">';
    }
    return '<span class="collection-card-cover-empty" aria-hidden="true">+</span>';
  }

  function collectionCardHtml(coverSrc, name, description) {
    return (
      '<div class="collection-card-cover' + (coverSrc ? "" : " is-empty") + '">' +
      collectionCoverHtml(coverSrc) +
      "</div>" +
      '<h3 class="collection-card-name">' + name + "</h3>" +
      '<p class="collection-card-description">' + description + "</p>"
    );
  }

  // Rebuilt from scratch every time -- called on load, and again
  // whenever the uploads list changes (mirrors rebuildFullCatalog's own
  // call sites below), so Your Uploads' own cover/photo always reflects
  // what's actually saved rather than a stale snapshot from an earlier
  // render.
  function renderCollectionCards() {
    if (!collectionCardsEl) return;
    collectionCardsEl.innerHTML = "";

    const uploadsCard = document.createElement("button");
    uploadsCard.type = "button";
    uploadsCard.className = "collection-card";
    uploadsCard.innerHTML = collectionCardHtml(
      uploadedPhotoRecords.length ? uploadedPhotoRecords[0].url : null,
      "Your Uploads",
      "Your own uploads never leave your browser."
    );
    uploadsCard.addEventListener("click", openUploadsCollection);
    collectionCardsEl.appendChild(uploadsCard);

    (window.FRACTALIZE_CATALOG || []).forEach((group) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "collection-card";
      card.innerHTML = collectionCardHtml(
        group.photos.length ? group.photos[0].thumbSrc : null,
        group.label,
        "Tuko's Photography"
      );
      card.addEventListener("click", () => openCuratedCollection(group));
      collectionCardsEl.appendChild(card);
    });
  }

  // Cross-fades from whichever panel is currently .is-active to `panel`
  // -- see .collection-slider-panel's own comment in styles.css for why
  // that class alone (promoting `panel` to position:relative, demoting
  // the other back to position:absolute) is enough: only the actually-
  // in-flow panel contributes to the slider's own height, so it's
  // already correct with no JS measuring involved, and the position
  // swap lands instantly (not something CSS can transition) right as
  // the opacity fade starts.
  function showPanel(panel) {
    if (!collectionSlider || !cardsPanel || !expandedPanel || !panel) return;
    cardsPanel.classList.toggle("is-active", panel === cardsPanel);
    expandedPanel.classList.toggle("is-active", panel === expandedPanel);
    requestAnimationFrame(() => collectionSlider.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function openUploadsCollection() {
    if (uploadsSection) uploadsSection.hidden = false;
    if (curatedExpandedSection) curatedExpandedSection.hidden = true;
    showPanel(expandedPanel);
  }

  function openCuratedCollection(group) {
    if (!curatedExpandedSection || !curatedExpandedRow) return;
    if (uploadsSection) uploadsSection.hidden = true;
    curatedExpandedSection.hidden = false;
    curatedExpandedHeading.textContent = group.label;
    curatedExpandedRow.innerHTML = "";
    group.photos.forEach((photo) => curatedExpandedRow.appendChild(renderCuratedThumb(photo)));
    showPanel(expandedPanel);
  }

  if (catalogBackBtn && collectionSlider && cardsPanel && expandedPanel) {
    catalogBackBtn.addEventListener("click", () => {
      // A new/deleted upload while inside that collection changes its
      // own card -- refresh so it's not still showing a stale cover
      // once back at the grid.
      renderCollectionCards();
      showPanel(cardsPanel);
    });
  }

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
        const idx = uploadedPhotoRecords.findIndex((r) => r.id === record.id);
        if (idx !== -1) uploadedPhotoRecords.splice(idx, 1);
        rebuildFullCatalog();
        // The deleted photo might have been the card's own cover --
        // only actually visible once back at the card grid (this thumb
        // lives in the expanded uploads view), but cheap enough to just
        // always refresh rather than track whether it mattered here.
        renderCollectionCards();
      });
    });
    uploadedPhotoRecords.push({ id: record.id, url: url });
    return thumb;
  }

  if (uploadsSection && uploadsRow) {
    getAllUploadedPhotos()
      .then((records) => {
        records.forEach((record) => uploadsRow.appendChild(renderUploadThumb(record)));
        if (records.length) {
          rebuildFullCatalog();
          // Replaces the placeholder "+" cover the initial render below
          // shipped with (uploads hadn't loaded yet at that point) with
          // the real first photo.
          renderCollectionCards();
        }
      })
      .catch(() => {
        // IndexedDB unavailable/blocked -- new uploads below still work
        // for the current session, just without persistence.
      });
  }

  // Saves any number of image files to IndexedDB and adds a thumb for
  // each, right after the row's permanent add-tile -- shared by every
  // upload entry point on this page (the add-tile's own file input, and
  // the "+" tile inside the fractal/visualizer, wired below). Each save
  // is independent, so completion order (and so thumb order among a
  // batch) isn't guaranteed to match selection order -- not worth
  // sequencing for what's a cosmetic detail.
  function saveFilesToUploads(fileList) {
    if (!uploadsSection || !uploadsRow || !addTile) return;
    const files = Array.prototype.filter.call(fileList || [], (f) => f && f.type.indexOf("image/") === 0);
    files.forEach((file) => {
      saveUploadedPhoto(file)
        .then((record) => {
          uploadsRow.insertBefore(renderUploadThumb(record), addTile.nextSibling);
          rebuildFullCatalog();
          renderCollectionCards();
        })
        .catch(() => {
          // Storage unavailable or quota exceeded -- this upload just
          // won't be there on a future visit.
        });
    });
  }

  // The add-tile's own hidden file input (see index.html) -- a <label>
  // wraps it, so clicking the tile already opens the picker with no JS
  // needed for that part; this just handles the file(s) once chosen.
  const uploadsAddInput = document.querySelector("[data-uploads-add-input]");
  if (uploadsAddInput) {
    uploadsAddInput.addEventListener("change", () => {
      saveFilesToUploads(uploadsAddInput.files);
      uploadsAddInput.value = ""; // lets the same file(s) be re-selected later
    });
  }

  // Same "+" add-photos tile, now also inside the fractal's own camera-
  // roll grid and the visualizer's settings panel -- opting in here
  // means a photo picked from either lands in "Your Uploads" exactly
  // like one added from this page directly (same save path, same
  // catalog refresh). Set once at load, well before a visitor could
  // ever open either overlay.
  window.FractalizeCore.setUploadHandler(saveFilesToUploads);

  // Initial card grid render -- uploads haven't loaded from IndexedDB
  // yet at this point (that's async, see above), so Your Uploads' own
  // card starts with the placeholder "+" cover; the load-success handler
  // above re-renders once the real photos (if any) are in.
  renderCollectionCards();
})();
