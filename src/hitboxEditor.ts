import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Dev-only tool for finding addHitbox() numbers by eye instead of guessing
// blind: drag a placeholder box into place, then hit P to dump a ready-to-
// paste snippet to the console. Not wired into the app unless you call
// initHitboxEditor() — see HITBOX_EDITOR in main.ts.
//
// The placeholder is a child of `parent` (e.g. a prop's `rig`), so
// TransformControls' position/rotation/scale — which it always edits in the
// object's own local space — line up exactly with what addHitbox(parent, {..})
// expects. No unit conversion between what you see dragged and what you paste.
//
// Keys: G translate, R rotate, S scale (scale.xyz *is* the size array, since
// the placeholder starts as a unit box). P prints the current snippet.

export function initHitboxEditor(
  camera: THREE.Camera,
  domElement: HTMLElement,
  orbitControls: OrbitControls,
  scene: THREE.Scene,
  parent: THREE.Object3D,
): void {
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xff8800,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  parent.add(placeholder);

  const transformControls = new TransformControls(camera, domElement);
  transformControls.attach(placeholder);
  scene.add(transformControls.getHelper());

  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;
  });

  window.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) return;
    switch (e.key.toLowerCase()) {
      case "g":
        transformControls.setMode("translate");
        break;
      case "r":
        transformControls.setMode("rotate");
        break;
      case "s":
        transformControls.setMode("scale");
        break;
      case "p":
        printSnippet(placeholder);
        break;
    }
  });

  console.log(
    "[hitboxEditor] G translate · R rotate · S scale · P print addHitbox() snippet",
  );
}

function printSnippet(mesh: THREE.Mesh): void {
  const p = mesh.position;
  const r = mesh.rotation;
  const s = mesh.scale;
  const n = (v: number) => Math.round(v * 1000) / 1000;
  console.log(
    `addHitbox(rig, {\n` +
      `  id: "TODO",\n` +
      `  size: [${n(s.x)}, ${n(s.y)}, ${n(s.z)}],\n` +
      `  position: [${n(p.x)}, ${n(p.y)}, ${n(p.z)}],\n` +
      `  rotation: [${n(r.x)}, ${n(r.y)}, ${n(r.z)}],\n` +
      `  onClick: () => console.log("clicked: TODO"),\n` +
      `});`,
  );
}
