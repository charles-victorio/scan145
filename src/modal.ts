import "animate.css";

// A minimal "piece of paper" modal: openModal(url) loads a standalone HTML
// file into an overlay panel, playing public/paper.mp3 on open and close.
// Content files are plain, self-contained HTML/CSS for now (see
// public/notes/example.html for the expected look — black background,
// white text, Iosevka, no markdown step yet) — a markdown->HTML build can
// slot in later without this changing, since openModal only ever takes a URL.

const ENTER_CLASS = "animate__fadeInUpBig";
const EXIT_CLASS = "animate__hinge";

// animate.css's own speed knob: every animation's duration is
// `var(--animate-duration)` (animate__hinge specifically is that times 2,
// per its own rule in node_modules/animate.css/animate.css) — so this one
// constant scales both the enter and exit animations together.
const ANIMATE_DURATION = "0.45s";
// animate__hinge runs at 2x ANIMATE_DURATION; +500ms buffer as a safety net
// in case animationend never fires for some reason.
const EXIT_FALLBACK_MS = parseFloat(ANIMATE_DURATION) * 1000 * 2 + 500;

let overlay: HTMLDivElement | undefined;
let panel: HTMLDivElement | undefined;
let iframe: HTMLIFrameElement | undefined;
let paperSound: HTMLAudioElement | undefined;
let exitFallbackTimer: ReturnType<typeof setTimeout> | undefined;

function ensureModal(): { overlay: HTMLDivElement; panel: HTMLDivElement; iframe: HTMLIFrameElement } {
  if (overlay && panel && iframe) return { overlay, panel, iframe };

  overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.7)",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "1000",
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "relative",
    width: "min(700px, 90vw)",
    height: "min(800px, 85vh)",
    background: "#000",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
  });
  panel.style.setProperty("--animate-duration", ANIMATE_DURATION);

  iframe = document.createElement("iframe");
  Object.assign(iframe.style, { width: "100%", height: "100%", border: "0" });

  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close");
  Object.assign(closeButton.style, {
    position: "absolute",
    top: "0.75rem",
    right: "0.75rem",
    zIndex: "1",
    background: "none",
    border: "none",
    color: "#fff",
    fontSize: "1.5rem",
    lineHeight: "1",
    cursor: "pointer",
    padding: "0.25rem 0.5rem",
  });
  closeButton.addEventListener("click", closeModal);

  panel.append(iframe, closeButton);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  return { overlay, panel, iframe };
}

function playPaperSound(): void {
  if (!paperSound) paperSound = new Audio("/paper.mp3");
  paperSound.currentTime = 0;
  // Browsers can block autoplay outside a user gesture; open/close are
  // always called from one in practice (a hitbox or button click), so this
  // is just a guard.
  paperSound.play().catch(() => {});
}

export function openModal(url: string): void {
  const { overlay: el, panel: p, iframe: frame } = ensureModal();
  clearTimeout(exitFallbackTimer);

  frame.src = url;
  el.style.display = "flex";
  p.className = `animate__animated ${ENTER_CLASS}`;

  playPaperSound();
}

export function closeModal(): void {
  if (!overlay || !panel || !iframe || overlay.style.display === "none") return;

  playPaperSound();
  panel.className = `animate__animated ${EXIT_CLASS}`;

  const finish = () => {
    clearTimeout(exitFallbackTimer);
    if (overlay) overlay.style.display = "none";
    if (iframe) iframe.src = "about:blank";
    if (panel) panel.className = "";
  };
  panel.addEventListener("animationend", finish, { once: true });
  exitFallbackTimer = setTimeout(finish, EXIT_FALLBACK_MS);
}
