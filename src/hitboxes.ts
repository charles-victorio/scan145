import * as THREE from "three";

// A small, self-contained click-hitbox system: invisible boxes that fire a
// callback when clicked. Add one per interactive thing in the scene with
// addHitbox(); initHitboxClicks() wires up the raycasting once.
//
// Click-vs-drag discrimination (a pointerdown->pointerup distance threshold)
// is the same trick ~/splat/src/placement.js uses so that dragging to orbit
// the camera never gets misread as a click.

export interface AddHitboxOptions {
  /** Unique-ish label, useful for debugging (logged, not otherwise used). */
  id: string;
  /** Box dimensions [width, height, depth], in the parent's local units. */
  size: [number, number, number];
  /** Local-space offset from the parent. Defaults to the origin. */
  position?: THREE.Vector3 | [number, number, number];
  /** Local-space rotation. Defaults to none. */
  rotation?: THREE.Euler | [number, number, number];
  /** Wireframe color shown when hitbox debug mode is on. */
  debugColor?: number;
  onClick: () => void;
}

const registry: THREE.Mesh[] = []; // raycast targets (the fill mesh of each hitbox)
const visualMeshes: THREE.Mesh[] = []; // fill + wireframe, toggled together by setHitboxDebug
let debugEnabled = false;

const FILL_COLOR = 0x0000ee;
const FILL_OPACITY = 0.1;
const WIRE_OPACITY = 0.75;

/**
 * Adds an invisible (unless debug mode is on) box hitbox as a child of
 * `parent` — parent it under a moving rig (like the laptop's) to have the
 * hitbox follow automatically, or under `scene` for a world-fixed one.
 * Debug appearance is a translucent white fill plus a glowing wireframe
 * outline (fill and wireframe share one BoxGeometry — a normal three.js way
 * to draw both looks off one mesh).
 */
export function addHitbox(parent: THREE.Object3D, opts: AddHitboxOptions): THREE.Object3D {
  const container = new THREE.Group();
  if (opts.position) {
    container.position.copy(
      Array.isArray(opts.position) ? new THREE.Vector3(...opts.position) : opts.position,
    );
  }
  if (opts.rotation) {
    container.rotation.copy(
      Array.isArray(opts.rotation) ? new THREE.Euler(...opts.rotation) : opts.rotation,
    );
  }
  parent.add(container);

  const geometry = new THREE.BoxGeometry(...opts.size);

  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: FILL_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const wire = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: opts.debugColor ?? 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: WIRE_OPACITY,
      blending: THREE.AdditiveBlending, // reads as "glowing" against the dark scene, no bloom pass needed
      depthWrite: false,
    }),
  );
  fill.visible = debugEnabled;
  wire.visible = debugEnabled;
  container.add(fill, wire);

  fill.userData.hitboxId = opts.id;
  fill.userData.onHitboxClick = opts.onClick;

  registry.push(fill);
  visualMeshes.push(fill, wire);
  return container;
}

/** Show/hide the fill+wireframe for every registered hitbox — flip this on while trial-and-error placing new ones. */
export function setHitboxDebug(enabled: boolean): void {
  debugEnabled = enabled;
  for (const mesh of visualMeshes) {
    mesh.visible = enabled;
  }
}

/**
 * Wires up click detection once: raycasts against every registered hitbox
 * on a genuine click (not a drag-to-orbit) and fires its onClick.
 */
export function initHitboxClicks(camera: THREE.Camera, domElement: HTMLElement): void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const DRAG_THRESHOLD_PX = 4;
  let downX = 0;
  let downY = 0;
  let dragging = false;

  domElement.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
    dragging = false;
  });

  domElement.addEventListener("pointermove", (e) => {
    if (e.buttons) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_THRESHOLD_PX) {
        dragging = true;
      }
      return; // mid-drag/orbit: skip the hover check below
    }

    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hovering = raycaster.intersectObjects(registry, false).length > 0;
    domElement.style.cursor = hovering ? "pointer" : "";
  });

  domElement.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || dragging) return;

    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);

    const hit = raycaster.intersectObjects(registry, false)[0];
    if (!hit) return;
    const onHitboxClick = hit.object.userData.onHitboxClick as (() => void) | undefined;
    onHitboxClick?.();
  });
}
