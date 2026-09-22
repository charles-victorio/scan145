import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { injectHtmlFile } from "./domFetch";

// The "seamless DOM-to-3D" laptop intro. See
// /home/charles/.claude/plans/tender-stargazing-hopcroft.md for the full
// derivation — short version:
//
// 1. A plain (never iframe — iframes reload on reparent, plain nodes don't)
//    full-viewport DOM overlay shows the splash, then the laptop's webpage,
//    as completely normal 2D content. The camera never moves during this
//    phase, so whatever it's doing behind the opaque overlay is invisible.
// 2. On "Explore": the object is immediately parented under `rig` at its
//    exact final, permanent transform — the real docked position, rotation,
//    AND scale (contain-fit to the actual screen quad). None of it is ever
//    touched again: the "screen" is a fixed thing in the world from this
//    frame on, exactly like `demos/dom-to-3d.html`'s object sitting inertly
//    at the origin forever. Only the CAMERA'S starting position is solved
//    (same view-fill trig as that demo — distance = height/(2 tan(fov/2)) —
//    just fed the object's real physical world-height instead of a raw CSS
//    pixel height) so that, viewed from there, the object exactly fills the
//    frozen viewport, reproducing the page's current flat-2D look almost
//    exactly. The reparent itself is close to visually invisible.
// 3. Everything after that is pure numeric tweening of the CAMERA ONLY
//    (no more DOM ops, no more object ops) — position lerp + orientation
//    slerp, from "close up, filling the frozen viewport" to "pulled back at
//    the app's normal default view." The object never moves or resizes for
//    the rest of its life; every bit of apparent motion is the camera.
//
// The WebGL canvas sits in front of the CSS3D layer and scene.background is
// opaque — the docked laptop/monitor screens already rely on an invisible
// "occluder" plane punching a matching transparent hole to be visible at
// all. Since the object's whole transform is fixed from frame 1, the
// occluder's is too — set once, alongside the visible object, never updated.

export interface IntroScreenBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  z: number;
  zOffset?: number;
}

export interface InitIntroOptions {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Resolves once the laptop's GLTF has loaded and `rig` is fully built. */
  rigPromise: Promise<THREE.Group>;
  laptopPosition: THREE.Vector3;
  screenBounds: IntroScreenBounds;
  splashUrl?: string;
  laptopPageUrl?: string;
}

// Tunables — tweak freely.
const TWEEN_DURATION_MS = 2000;
const CROSSFADE_MS = 600;
const SPLASH_HOLD_MS = 800; // pause after the splash finishes drawing, before it starts fading away

// The "drag to rotate..." HUD hint sits under the intro's opaque overlay the
// whole time (z-index), so it's invisible no matter when its text gets set —
// these timings only mean anything once finish() below actually reveals it.
const HUD_HINT_DELAY_MS = 500; // wait after the intro finishes, before the hint starts fading in
const HUD_HINT_FADE_MS = 500; // must match #hud's opacity transition duration in index.html
const HUD_HINT_HOLD_MS = 10000; // how long the hint stays visible before fading back out

/** True while the reparent-and-tween sequence is running — main.ts's resize
 * handler checks this to avoid recomputing the frozen viewport mid-flight. */
export let introTransitioning = false;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function makeOccluder(): THREE.Mesh {
  // Unit plane — its .scale is set once (matching the visible object's
  // permanent size) and never touched again.
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0,
      blending: THREE.NoBlending, // writes rgba(0,0,0,0) verbatim -> transparent hole
      side: THREE.DoubleSide,
    }),
  );
}

export function initIntro(opts: InitIntroOptions): void {
  const { camera, controls, rigPromise, laptopPosition, screenBounds } = opts;
  const splashUrl = opts.splashUrl ?? "/splash.html";
  const laptopPageUrl = opts.laptopPageUrl ?? "/screens/laptop.html";

  controls.enabled = false;

  const overlay = document.createElement("div");
  overlay.className = "content-root";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2000",
  });
  document.body.appendChild(overlay);

  // Two stacked layers, rather than one container whose content gets
  // replaced in place — the laptop page is fetched, parsed, and laid out
  // in the background the whole time the splash is playing, and sits fully
  // opaque and static underneath from the start (no fade-in of its own).
  // The splash sits on top (opaque white, painted later in document order
  // so it wins the stacking order at the same z-index) and is the only
  // thing that animates: it fades OUT, uncovering the already-settled
  // laptop page rather than crossfading into it.
  const laptopLayer = document.createElement("div");
  laptopLayer.className = "content-root";
  Object.assign(laptopLayer.style, {
    position: "absolute",
    inset: "0",
  });
  overlay.appendChild(laptopLayer);

  const splashLayer = document.createElement("div");
  splashLayer.className = "content-root";
  Object.assign(splashLayer.style, {
    position: "absolute",
    inset: "0",
    opacity: "1",
    transition: `opacity ${CROSSFADE_MS}ms ease`,
  });
  overlay.appendChild(splashLayer);

  const splashDone = new Promise<void>((resolve) => {
    window.addEventListener("splash:done", () => resolve(), { once: true });
  });

  Promise.all([injectHtmlFile(splashUrl, splashLayer), injectHtmlFile(laptopPageUrl, laptopLayer), rigPromise])
    .then(([, , rig]) => splashDone.then(() => rig))
    .then(
      (rig) =>
        new Promise<THREE.Group>((resolve) => {
          window.setTimeout(() => resolve(rig), SPLASH_HOLD_MS);
        }),
    )
    .then((rig) => {
      splashLayer.style.opacity = "0";

      // Wait for the fade-out to actually finish before tearing the splash
      // down — transitionend is the real signal, the timeout is just a
      // safety net (same pattern as splash.html's own announceDone()).
      // transitionend BUBBLES, so this must check target/propertyName —
      // splash.html's own glasses shapes finish their own transform/opacity
      // transitions at nearly the same moment splash:done fires, and an
      // unfiltered listener here catches one of THOSE instead, firing well
      // before this element's real opacity fade is anywhere close to done.
      return new Promise<THREE.Group>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(rig);
        };
        // NOT { once: true } — that would discard the listener on the
        // first bubbled event regardless of whether it actually matched
        // (see comment above), silently missing splashLayer's own opacity
        // transitionend if some child's transition happens to end first.
        // `done` above already guards against acting on more than one.
        splashLayer.addEventListener("transitionend", (e) => {
          if (e.target === splashLayer && e.propertyName === "opacity") finish();
        });
        window.setTimeout(finish, CROSSFADE_MS + 200);
      });
    })
    .then((rig) => {
      splashLayer.remove();
      laptopLayer.addEventListener("click", (e) => {
        const target = e.target as Element | null;
        if (!target?.closest("#explore-btn")) return;
        e.preventDefault();
        runTransition(rig);
      });
    });

  function runTransition(rig: THREE.Group): void {
    introTransitioning = true;

    const rect = overlay.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;

    // The camera has not moved since page load (nothing has been interactive
    // yet — the overlay has covered the whole screen this whole time), so
    // its current position/orientation are exactly the app's deterministic
    // default pose. Capture both before touching the camera at all.
    const camera_t1 = camera.position.clone();
    const Qcam1 = camera.quaternion.clone();

    // The real docked transform — this is where the object lives from frame
    // 1 onward, permanently, for the rest of the app's life.
    rig.updateMatrixWorld(true);
    const s = rig.scale.x; // uniform, set via setScalar when the rig was built
    const width_t1_local = screenBounds.xMax - screenBounds.xMin;
    const height_t1_local = screenBounds.yMax - screenBounds.yMin;
    const center_local = new THREE.Vector3(
      (screenBounds.xMin + screenBounds.xMax) / 2,
      (screenBounds.yMin + screenBounds.yMax) / 2,
      screenBounds.z + (screenBounds.zOffset ?? 0.08),
    );
    const dockedWorldPos = center_local.clone().applyMatrix4(rig.matrixWorld);
    const normalWorld = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();

    // The object's one true, permanent size — contain-fit to the real
    // screen quad so it never stretches (may leave a sliver of the laptop's
    // own lid material showing at the bezel edge if the frozen viewport's
    // aspect doesn't match the physical screen's). This is set once, below,
    // and is never touched again for the rest of the object's life —
    // exactly like demos/dom-to-3d.html's cssObject, just sized to the
    // laptop's real screen instead of scale 1. Uniform scale can't distort
    // aspect, so the object's world footprint is always vw:vh regardless of
    // which axis the min() picks.
    const scaleWorld = Math.min(
      (width_t1_local * s) / vw,
      (height_t1_local * s) / vh,
    );
    const scaleLocal = scaleWorld / s;

    // Solve the ONE free variable — how far back the camera must start —
    // so this fixed-size, fixed-position object exactly fills the frozen
    // viewport right now. Same identity as demos/dom-to-3d.html
    // (distance = height/(2 tan(fov/2))), just fed the object's real
    // physical world-height (vh frozen px * world-meters-per-px) instead of
    // a raw CSS pixel height — because unlike that demo, this object's
    // in-world size isn't a free 1:1 px choice, it's dictated by the real
    // screen geometry.
    const worldHeightAtStart = vh * scaleWorld;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const cameraStartDistance = worldHeightAtStart / (2 * Math.tan(fovRad / 2));
    const cameraStartPos = dockedWorldPos.clone().addScaledVector(normalWorld, cameraStartDistance);

    camera.position.copy(cameraStartPos);
    camera.lookAt(dockedWorldPos); // real camera — local -Z toward target, as expected
    const Qcam0 = camera.quaternion.clone();

    // Freeze `overlay`'s box to explicit pixel dimensions BEFORE wrapping it.
    // CSS3DObject's constructor force-sets position:absolute on the element
    // and moves it into the CSS3DRenderer's own internal transform DOM
    // structure — `overlay`'s current `position:fixed; inset:0` (which
    // means "100% of the viewport" only while fixed) would otherwise resolve
    // against that new, differently-sized container instead, silently
    // changing the element's real rendered size the instant it's reparented
    // — which is exactly the "jump" this whole reparent is supposed to not
    // have. vw/vh were captured above, before this mutation.
    overlay.style.width = `${vw}px`;
    overlay.style.height = `${vh}px`;

    // The one reparent, straight into `rig` at its exact final transform —
    // position, rotation, AND scale, set here, once, never touched again.
    // cameraStartPos/Qcam0 were solved so this frame reproduces `overlay`'s
    // current flat-2D appearance almost exactly.
    const cssObject = new CSS3DObject(overlay);
    cssObject.position.copy(center_local);
    cssObject.quaternion.identity();
    cssObject.scale.setScalar(scaleLocal);
    rig.add(cssObject);

    const occluder = makeOccluder();
    occluder.position.copy(center_local);
    occluder.quaternion.identity();
    occluder.scale.set(vw * scaleLocal, vh * scaleLocal, 1);
    rig.add(occluder);

    // From here on, only the camera moves — the object above is never
    // read or written again.
    const start = performance.now();
    function step(now: number): void {
      const raw = Math.min(1, (now - start) / TWEEN_DURATION_MS);
      const t = easeInOutCubic(raw);

      camera.position.lerpVectors(cameraStartPos, camera_t1, t);
      camera.quaternion.copy(Qcam0).slerp(Qcam1, t);

      if (raw < 1) {
        requestAnimationFrame(step);
      } else {
        finish();
      }
    }
    requestAnimationFrame(step);

    function finish(): void {
      overlay.style.zIndex = "";
      controls.target.copy(laptopPosition);
      controls.enabled = true;
      controls.update();
      introTransitioning = false;

      // "drag to rotate..." hint: fade in, hold, fade out. Only meaningful
      // from here on — it's been sitting under the opaque overlay this
      // whole time, so there's nothing to see before now regardless of
      // when its text got set elsewhere.
      const hud = document.getElementById("hud");
      if (hud) {
        hud.style.transition = `opacity ${HUD_HINT_FADE_MS}ms ease`;
        window.setTimeout(() => {
          hud.style.opacity = "1";
          window.setTimeout(() => {
            hud.style.opacity = "0";
          }, HUD_HINT_HOLD_MS);
        }, HUD_HINT_DELAY_MS);
      }
    }
  }
}
