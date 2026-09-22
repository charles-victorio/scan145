import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { addHitbox, initHitboxClicks, setHitboxDebug } from "./hitboxes";
import { addScreenQuad } from "./screenQuad";
import { initHitboxEditor } from "./hitboxEditor";
import { openModal } from "./modal";
import { initIntro, introTransitioning } from "./intro";

// Geometry above y=0 and below z=-3.05 is already stripped out of this file
// (see scripts/trim_height.py and scripts/trim_plane.py) —
// scan1_145.trimmed.glb is kept untouched as the source.
import scanUrl from "../scan1_145.trimmed.glb?url";

// public/lenovo/scene.gltf references scene.bin and textures/*.png by plain
// relative URI, so it's served as-is from Vite's public/ dir (not imported
// as a module) rather than bundled — GLTFLoader resolves those siblings
// against the URL it was given.
const laptopUrl = "/lenovo/scene.gltf";

// Placement for the laptop model — tweak these and reload to move it.
// LAPTOP_SCALE is a multiplier on top of an auto-fit that normalizes the
// model to roughly LAPTOP_TARGET_SIZE meters across its largest dimension
// (the source asset's own units are unknown/arbitrary), so 1 = "auto size".
// Starting guess: room floor is at y=-2.46 (from the scan's own bounds),
// roughly centered in X/Z — this puts the laptop at about desk height.
const LAPTOP_POSITION = new THREE.Vector3(1, -1.2, -0.25);
const LAPTOP_ROTATION_Y = Math.PI * (-1/2);
const LAPTOP_SCALE = 1.25;
const LAPTOP_TARGET_SIZE = 0.33; // meters, roughly a 14" laptop's width

// Screen-quad placement, in the SAME recentered local frame as `laptop`
// above (found by inspecting the mesh directly: the two largest coplanar
// triangles, normal +Z, form the front lid panel — see
// scripts/find_screen_quad.py, which reports the raw panel as
// x:[-7.99,7.99] y:[-3.7,5.45]). Added as a sibling of `laptop` under `rig`,
// so it inherits LAPTOP_POSITION/ROTATION_Y/SCALE automatically and stays
// locked to the model as those are tweaked.
//
// Each edge is independent (not a uniform center+inset) since the bezel
// margin isn't symmetric — e.g. a taller "chin" at the bottom of the lid.
const SCREEN_LOCAL_X_MIN = -7.2;
const SCREEN_LOCAL_X_MAX = 7.2;
const SCREEN_LOCAL_Y_MIN = -3.3;
const SCREEN_LOCAL_Y_MAX = 4.45;
const SCREEN_LOCAL_Z = -5.0;
const SCREEN_Z_OFFSET = 0.08; // nudge toward +Z (out of the lid) to avoid z-fighting with the real mesh surface
// No SCREEN_URL here — the laptop's screen content is no longer a static
// addScreenQuad() iframe. It's the same live DOM element the intro sequence
// flies in from a flat 2D webpage; see src/intro.ts.

// public/monitor/scene.gltf — same public/-served, relative-URI setup as the
// laptop above.
const monitorUrl = "/monitor/scene.gltf";

// Placed close to the laptop but further out in X/Z (further from camera,
// off to the side per the reference photo), angled 45° further round than
// the laptop. Starting guess — tweak and reload.
const MONITOR_POSITION = new THREE.Vector3(1.3, -1.1, 0.2);
const MONITOR_ROTATION_Y = LAPTOP_ROTATION_Y - Math.PI / 4;
const MONITOR_SCALE = 1.25;
const MONITOR_TARGET_SIZE = 0.55; // meters, roughly a 24" monitor's width

// Screen-quad placement for the monitor, in the SAME recentered local frame
// as `monitor` below. Unlike the laptop, the screen is already its own
// separate mesh in this asset (Cube_RenderMonitor_0, normal +Z, flat) — its
// bounds were read directly off that submesh (recentered against the full
// model's bbox center, same as everywhere else here): x:[-887.45,887.45]
// y:[-395.70,626.42].
const MONITOR_SCREEN_LOCAL_X_MIN = -887;
const MONITOR_SCREEN_LOCAL_X_MAX = 887;
const MONITOR_SCREEN_LOCAL_Y_MIN = -396;
const MONITOR_SCREEN_LOCAL_Y_MAX = 626;
const MONITOR_SCREEN_LOCAL_Z = 118;
const MONITOR_SCREEN_URL = "/screens/monitor.html";

// Set true + reload to see wireframe outlines for every addHitbox() box —
// handy while trial-and-error placing a new one, off for the real thing.
const HITBOXES_DEBUG = true;

// Set true + reload to drag a placeholder box under the laptop's rig and
// print an addHitbox() snippet for it (G/R/S to switch modes, P to print —
// see src/hitboxEditor.ts). Off by default: no cost when not actively
// placing a new hitbox.
const HITBOX_EDITOR = false;

const hud = document.getElementById("hud")!;

// --- renderer ----------------------------------------------------------------
// alpha:true + a transparent clear lets the CSS3D layer (holding the screen
// iframe) show through a hole punched in the WebGL canvas at the screen's
// location; index.html's <body> is already solid black, so the overall look
// stays a black background everywhere else.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
const appEl = document.getElementById("app")!;

// CSS3D layer sits BEHIND the (now-transparent) WebGL canvas. Both layers,
// and the screen iframe itself, are pointer-transparent, so orbit-drag
// always falls through to #app — the screen displays but isn't interactive.
const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
Object.assign(cssRenderer.domElement.style, {
  position: "absolute",
  inset: "0",
  zIndex: "0",
  pointerEvents: "none",
});
Object.assign(renderer.domElement.style, {
  position: "absolute",
  inset: "0",
  zIndex: "1",
  pointerEvents: "none",
});
appEl.appendChild(cssRenderer.domElement);
appEl.appendChild(renderer.domElement);

// --- scene / camera ------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// glTF's PBR materials default to metallic unless the exporter says otherwise,
// and metallic surfaces only reflect environment light — with no environment
// map they read near-black no matter how bright the direct lights are. An IBL
// environment (background stays plain black; only .environment is set) fixes
// that without needing per-material metalness overrides.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  1000,
);
camera.position.set(0, 1, 3);

// scene.add(new THREE.AxesHelper(5));


// Direct light on top of the IBL environment, for a bit of shading direction.
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 5, 2);
scene.add(sun);

// --- orbit controls --------------------------------------------------------
// Listens on #app, not the canvas: the canvas is pointer-events:none now (so
// clicks can fall through to the screen iframe), so events must be picked up
// one level up on the container instead.
const controls = new OrbitControls(camera, appEl);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

// --- hitboxes ----------------------------------------------------------------
// See src/hitboxes.ts. Uses the same domElement as OrbitControls above —
// a click-vs-drag distance check keeps orbit-dragging from misfiring one.
initHitboxClicks(camera, appEl);
setHitboxDebug(HITBOXES_DEBUG);

// Orbit around the laptop, not the room. LAPTOP_POSITION is a plain constant
// (not behind the laptop's own async load), so this can be set up front
// instead of racing the two GLTFLoader.load calls below to see which finishes
// last and gets to set the camera target.
const LAPTOP_REAL_SIZE = LAPTOP_TARGET_SIZE * LAPTOP_SCALE;
controls.target.copy(LAPTOP_POSITION);
controls.minDistance = LAPTOP_REAL_SIZE * 0.6;
controls.maxDistance = 15; // generous enough to still pull back and see the room
const cameraStartOffset = new THREE.Vector3(0, LAPTOP_REAL_SIZE * 0.6, LAPTOP_REAL_SIZE * 1.6);
cameraStartOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2); // orbit the starting view -90° around Y
camera.position.copy(LAPTOP_POSITION).add(cameraStartOffset);
controls.update();

// --- load the scan -----------------------------------------------------------
const loader = new GLTFLoader();
loader.load(
  scanUrl,
  (gltf: GLTF) => {
    const model = gltf.scene;

    // Backface culling: force single-sided rendering. Photogrammetry meshes
    // sometimes come through as DoubleSide (or with flipped normals in
    // places) — FrontSide is the three.js default, set explicitly here so a
    // future material swap can't silently lose it.
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          mat.side = THREE.FrontSide;
        }
      }
    });

    scene.add(model);

    // Grow the far plane to fit the room (camera orbits the laptop, set up
    // above, but should still be able to pull back and see the whole room).
    const box = new THREE.Box3().setFromObject(model);
    const diag = box.getSize(new THREE.Vector3()).length();
    camera.near = Math.max(diag / 1000, 0.001);
    camera.far = diag * 20;
    camera.updateProjectionMatrix();

    window.__t.model = model;
    window.__t.box = box;

    hud.textContent =
      "drag to rotate, scroll to zoom, right-drag to pan";
  },
  undefined,
  (err: unknown) => {
    console.error("Failed to load scan1_145.trimmed.glb", err);
    hud.textContent = "failed to load scan1_145.trimmed.glb — see console";
  },
);

// --- load the laptop prop -----------------------------------------------------
// Wrapped in a promise so the intro sequence (src/intro.ts) can await `rig`
// without racing this callback — the laptop's screen is no longer a static
// addScreenQuad() iframe; it's the SAME live DOM element the intro flies in
// from a flat 2D webpage, docked here once the intro's tween finishes.
const laptopReady = new Promise<THREE.Group>((resolve, reject) => {
  loader.load(
    laptopUrl,
    (gltf: GLTF) => {
      const laptop = gltf.scene;
      laptop.updateMatrixWorld(true);

      // Recenter: shift so the model's own bounding-box center sits at its
      // local origin, so LAPTOP_POSITION below is intuitively "where the
      // laptop's centroid ends up", not wherever the source asset's pivot was.
      const box = new THREE.Box3().setFromObject(laptop);
      const center = box.getCenter(new THREE.Vector3());
      laptop.position.sub(center);

      const size = box.getSize(new THREE.Vector3());
      const autoScale = LAPTOP_TARGET_SIZE / Math.max(size.x, size.y, size.z);

      const rig = new THREE.Group();
      rig.add(laptop);
      rig.position.copy(LAPTOP_POSITION);
      rig.rotation.y = LAPTOP_ROTATION_Y;
      rig.scale.setScalar(autoScale * LAPTOP_SCALE);
      scene.add(rig);

      // --- example hitbox ------------------------------------------------------
      // DEMO ONLY — replace with real hitboxes as you need them. Parented to
      // `rig`, so this box tracks the laptop's own position/rotation/scale;
      // parent under `scene` instead for something fixed in room space. Set
      // HITBOXES_DEBUG = true above to see this outlined while you place it.
      addHitbox(rig, {
        id: "artwork",
        size: [16.801, 16.342, 3.293],
        position: [-3.434, 28.094, -22.289],
        rotation: [0, 0, 0],
        onClick: () => window.open("https://scribbles.charlesv.xyz/mask_pov/", "_blank", "noopener,noreferrer"),
      });
      addHitbox(rig, {
        id: "crBox",
        size: [24.483, 29.836, 25.641],
        position: [-35.89, -23.189, 20.147],
        rotation: [0, 0, 0],
        onClick: () => window.open("https://engineering.ucdavis.edu/news/science-action-how-build-corsi-rosenthal-box", "_blank", "noopener,noreferrer"),
      });
      addHitbox(rig, {
        id: "blackboard",
        size: [5.42, 58.73, 75.77],
        position: [159.43, 15.106, 35.197],
        rotation: [0, 0, 0],
        onClick: () => openModal("/notes/example.html"),
      });

      if (HITBOX_EDITOR) initHitboxEditor(camera, appEl, controls, scene, rig);

      window.__t.laptop = laptop;
      window.__t.laptopRig = rig;

      resolve(rig);
    },
    undefined,
    (err: unknown) => {
      console.error("Failed to load lenovo/scene.gltf", err);
      reject(err instanceof Error ? err : new Error(String(err)));
    },
  );
});

initIntro({
  camera,
  controls,
  rigPromise: laptopReady,
  laptopPosition: LAPTOP_POSITION,
  screenBounds: {
    xMin: SCREEN_LOCAL_X_MIN,
    xMax: SCREEN_LOCAL_X_MAX,
    yMin: SCREEN_LOCAL_Y_MIN,
    yMax: SCREEN_LOCAL_Y_MAX,
    z: SCREEN_LOCAL_Z,
    zOffset: SCREEN_Z_OFFSET,
  },
});

// --- load the monitor prop ----------------------------------------------------
loader.load(
  monitorUrl,
  (gltf: GLTF) => {
    const monitor = gltf.scene;
    monitor.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(monitor);
    const center = box.getCenter(new THREE.Vector3());
    monitor.position.sub(center);

    const size = box.getSize(new THREE.Vector3());
    const autoScale = MONITOR_TARGET_SIZE / Math.max(size.x, size.y, size.z);

    const rig = new THREE.Group();
    rig.add(monitor);
    rig.position.copy(MONITOR_POSITION);
    rig.rotation.y = MONITOR_ROTATION_Y;
    rig.scale.setScalar(autoScale * MONITOR_SCALE);
    scene.add(rig);

    const monitorScreen = addScreenQuad(rig, {
      xMin: MONITOR_SCREEN_LOCAL_X_MIN,
      xMax: MONITOR_SCREEN_LOCAL_X_MAX,
      yMin: MONITOR_SCREEN_LOCAL_Y_MIN,
      yMax: MONITOR_SCREEN_LOCAL_Y_MAX,
      z: MONITOR_SCREEN_LOCAL_Z,
      url: MONITOR_SCREEN_URL,
    });

    window.__t.monitor = monitor;
    window.__t.monitorRig = rig;
    window.__t.monitorScreen = monitorScreen;
  },
  undefined,
  (err: unknown) => {
    console.error("Failed to load monitor/scene.gltf", err);
  },
);

declare global {
  interface Window {
    __t: Record<string, unknown>;
  }
}
window.__t = { THREE, scene, camera, controls, renderer, openModal };

// --- resize + render loop ---------------------------------------------------
window.addEventListener("resize", () => {
  // The intro's reparent-and-tween math freezes the viewport size at the
  // moment "Explore" is clicked (see src/intro.ts) — recomputing aspect/size
  // mid-flight would invalidate that frozen math, so skip resize handling
  // for the ~2s the transition is running.
  if (introTransitioning) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  // OrbitControls.update() recomputes its internal spherical radius from
  // camera.position every call and clamps it to [minDistance, maxDistance]
  // — unconditionally, regardless of controls.enabled (that flag only gates
  // pointer/wheel input handling). The intro's close-up starting camera
  // pose is well under minDistance (sized for the laptop's real, tiny
  // screen filling the viewport, not for room-viewing), so leaving this
  // unguarded fights the intro's manual camera positioning every frame —
  // clamping it back out before intro.ts's own tween ever gets to render
  // its intended pose.
  if (!introTransitioning) controls.update();
  renderer.render(scene, camera);
  cssRenderer.render(scene, camera);
});
