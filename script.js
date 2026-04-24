(function () {
  "use strict";

  const TRAIL_COUNT = 10;
  const HEAD_LERP = 0.42;
  const TRAIL_LERP_BASE = 0.36;
  const TRAIL_LERP_STEP = 0.022;
  const TRAIL_LERP_MIN = 0.09;
  const VOLUME_FADE_MS = 900;

  const BIO_PHRASES = [
    "Owner of multi.net.",
    "Working on nation.",
    "Links below — say hi.",
  ];

  const video = document.getElementById("bg-video");
  const enterOverlay = document.getElementById("enter-overlay");
  const bioLine = document.getElementById("bio-line");
  const bioSr = document.getElementById("bio-sr");
  const cursorRoot = document.getElementById("cursor-root");
  const cursorHead = document.getElementById("cursor-head");
  const glassCard = document.getElementById("glass-card");
  const cardStage = document.getElementById("card-stage");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  const BAR_COUNT = 7;
  let audioBarLevelOverride = null;

  const TILT_MAX_X = 12;
  const TILT_MAX_Y = 14;
  const TILT_LERP = 0.14;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let currentTiltX = 0;
  let currentTiltY = 0;
  let tiltPointerOver = false;

  let mouseX = -100;
  let mouseY = -100;
  let headX = -100;
  let headY = -100;
  const trailX = new Float32Array(TRAIL_COUNT);
  const trailY = new Float32Array(TRAIL_COUNT);
  for (let i = 0; i < TRAIL_COUNT; i++) {
    trailX[i] = -100;
    trailY[i] = -100;
  }

  const trailEls = [];
  let rafId = 0;

  let audioEntered = false;
  let volumeFade = null;

  let typePhraseIndex = 0;
  let typeCharIndex = 0;
  let typeDeleting = false;
  let typewriterTimer = 0;

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function setVolumeFade(targetVolume) {
    const now = performance.now();
    const startVol = video.volume;
    volumeFade = {
      from: startVol,
      to: clamp(targetVolume, 0, 1),
      start: now,
      duration: VOLUME_FADE_MS,
    };
  }

  function initAudioBars() {
    const root = document.getElementById("audio-bars");
    if (!root) return;
    root.innerHTML = "";
    for (let i = 0; i < BAR_COUNT; i++) {
      const b = document.createElement("span");
      b.className = "audio-bars__bar";
      root.appendChild(b);
    }
  }

  function updateAudioBars(now) {
    const root = document.getElementById("audio-bars");
    if (!root) return;
    const bars = root.querySelectorAll(".audio-bars__bar");
    if (!bars.length) return;
    if (prefersReducedMotion) {
      for (let i = 0; i < bars.length; i++) {
        bars[i].style.transform = "scaleY(0.45)";
      }
      return;
    }
    const t = now * 0.001;
    for (let i = 0; i < bars.length; i++) {
      let s;
      if (audioBarLevelOverride && i < audioBarLevelOverride.length) {
        s = clamp(Number(audioBarLevelOverride[i]), 0.12, 1);
      } else {
        s =
          0.35 +
          0.65 *
            (0.5 +
              0.5 *
                Math.sin(t * 2.2 + i * 0.7) *
                Math.cos(t * 1.3 + i * 0.4));
      }
      bars[i].style.transform = "scaleY(" + clamp(s, 0.15, 1) + ")";
    }
  }

  function stopTypewriter() {
    if (typewriterTimer) {
      clearTimeout(typewriterTimer);
      typewriterTimer = 0;
    }
  }

  function scheduleTypewriter(delay) {
    stopTypewriter();
    typewriterTimer = window.setTimeout(tickTypewriter, delay);
  }

  function tickTypewriter() {
    const phrase = BIO_PHRASES[typePhraseIndex % BIO_PHRASES.length];
    if (!typeDeleting) {
      if (typeCharIndex < phrase.length) {
        typeCharIndex += 1;
        const slice = phrase.slice(0, typeCharIndex);
        bioLine.textContent = slice;
        bioSr.textContent = slice;
        scheduleTypewriter(42 + Math.random() * 28);
      } else {
        scheduleTypewriter(1800);
        typeDeleting = true;
      }
    } else {
      if (typeCharIndex > 0) {
        typeCharIndex -= 1;
        const slice = phrase.slice(0, typeCharIndex);
        bioLine.textContent = slice;
        bioSr.textContent = slice;
        scheduleTypewriter(28);
      } else {
        typeDeleting = false;
        typePhraseIndex += 1;
        scheduleTypewriter(500);
      }
    }
  }

  function startTypewriter() {
    stopTypewriter();
    typePhraseIndex = 0;
    typeCharIndex = 0;
    typeDeleting = false;
    bioLine.textContent = "";
    bioSr.textContent = "";
    tickTypewriter();
  }

  function createTrailDots() {
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const dot = document.createElement("div");
      dot.className = "cursor-trail-dot";
      const scale = 1 - (i / TRAIL_COUNT) * 0.45;
      const s = 6 * scale;
      dot.style.width = `${s}px`;
      dot.style.height = `${s}px`;
      dot.style.margin = `${-s / 2}px 0 0 ${-s / 2}px`;
      dot.style.opacity = String(0.55 - i * 0.035);
      cursorRoot.appendChild(dot);
      trailEls.push(dot);
    }
  }

  function pointerInCard(clientX, clientY) {
    if (!glassCard) return false;
    const r = glassCard.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function updateTiltTargets(clientX, clientY) {
    if (!glassCard || prefersReducedMotion || !finePointer) return;
    if (!pointerInCard(clientX, clientY)) {
      tiltPointerOver = false;
      targetTiltX = 0;
      targetTiltY = 0;
      return;
    }
    tiltPointerOver = true;
    const r = glassCard.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * 2 - 1;
    const py = ((clientY - r.top) / r.height) * 2 - 1;
    targetTiltY = -px * TILT_MAX_Y;
    targetTiltX = -py * TILT_MAX_X;
    const sx = ((clientX - r.left) / r.width) * 100;
    const sy = ((clientY - r.top) / r.height) * 100;
    glassCard.style.setProperty("--spot-x", sx + "%");
    glassCard.style.setProperty("--spot-y", sy + "%");
  }

  function resetCardTilt() {
    tiltPointerOver = false;
    targetTiltX = 0;
    targetTiltY = 0;
  }

  function applyCardTiltFrame() {
    if (!glassCard || prefersReducedMotion || !finePointer) return;
    currentTiltX += (targetTiltX - currentTiltX) * TILT_LERP;
    currentTiltY += (targetTiltY - currentTiltY) * TILT_LERP;
    const ax = Math.abs(currentTiltX);
    const ay = Math.abs(currentTiltY);
    if (!tiltPointerOver && ax < 0.05 && ay < 0.05) {
      currentTiltX = 0;
      currentTiltY = 0;
    }
    glassCard.style.setProperty("--tilt-x", currentTiltX.toFixed(3) + "deg");
    glassCard.style.setProperty("--tilt-y", currentTiltY.toFixed(3) + "deg");
    const mag = Math.min(1, Math.hypot(currentTiltX / TILT_MAX_X, currentTiltY / TILT_MAX_Y));
    glassCard.style.setProperty("--lift", (8 * mag).toFixed(2) + "px");
    const isTilting = tiltPointerOver || ax > 0.4 || ay > 0.4;
    glassCard.classList.toggle("is-tilting", isTilting);
  }

  function updateCursorPositions() {
    headX += (mouseX - headX) * HEAD_LERP;
    headY += (mouseY - headY) * HEAD_LERP;
    cursorHead.style.transform = `translate3d(${headX}px, ${headY}px, 0)`;

    let px = headX;
    let py = headY;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const factor = clamp(TRAIL_LERP_BASE - i * TRAIL_LERP_STEP, TRAIL_LERP_MIN, TRAIL_LERP_BASE);
      trailX[i] += (px - trailX[i]) * factor;
      trailY[i] += (py - trailY[i]) * factor;
      trailEls[i].style.transform = `translate3d(${trailX[i]}px, ${trailY[i]}px, 0)`;
      px = trailX[i];
      py = trailY[i];
    }
  }

  function tick(now) {
    if (volumeFade) {
      const t = clamp((now - volumeFade.start) / volumeFade.duration, 0, 1);
      const e = easeOutQuad(t);
      video.volume = volumeFade.from + (volumeFade.to - volumeFade.from) * e;
      if (t >= 1) {
        video.volume = volumeFade.to;
        volumeFade = null;
      }
    }

    if (document.body.classList.contains("is-custom-cursor")) {
      updateCursorPositions();
    }

    applyCardTiltFrame();
    updateAudioBars(now);

    rafId = requestAnimationFrame(tick);
  }

  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updateTiltTargets(e.clientX, e.clientY);
  }

  function onEnter() {
    if (audioEntered) return;
    audioEntered = true;
    enterOverlay.classList.add("is-hidden");
    enterOverlay.setAttribute("aria-hidden", "true");
    video.muted = false;
    setVolumeFade(1);
  }

  function initFinePointerUi() {
    if (!finePointer) return;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    if (!prefersReducedMotion && cursorRoot && cursorHead) {
      createTrailDots();
      document.body.classList.add("is-custom-cursor");
    }
    if (cardStage) {
      cardStage.addEventListener("pointerleave", resetCardTilt);
    }
    window.addEventListener("blur", resetCardTilt);
  }

  function initVideo() {
    if (!video) return;
    video.volume = 0;
    const tryPlay = function () {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    };
    tryPlay();
    video.addEventListener(
      "canplay",
      function () {
        tryPlay();
      },
      { once: true }
    );
  }

  enterOverlay.addEventListener("click", onEnter);
  enterOverlay.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onEnter();
      }
    }
  );
  initVideo();
  initAudioBars();
  initFinePointerUi();
  startTypewriter();
  if (enterOverlay) {
    enterOverlay.focus({ preventScroll: true });
  }

  window.halzzAudioBars = {
    setLevels: function (arrayLike) {
      audioBarLevelOverride = arrayLike;
    },
    useProcedural: function () {
      audioBarLevelOverride = null;
    },
  };

  rafId = requestAnimationFrame(tick);
})();
