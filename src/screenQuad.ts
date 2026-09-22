import * as THREE from "three";
import { CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";

// A CSS3D iframe quad + matching WebGL "occluder" plane, both parented
// together so they track whatever `parent` you add them to (e.g. a prop's
// rig, to move/scale with it). See main.ts for how the punch-a-transparent-
// hole trick works — same pattern as ~/splat's web panel.

export interface ScreenQuadOptions {
  /** Local-space bounds of the screen rectangle, in `parent`'s own units. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Local-space Z the (flat, normal-+Z) quad sits at. */
  z: number;
  /** Nudge toward +Z (out of the surface) to avoid z-fighting with the real mesh. Default 0.08. */
  zOffset?: number;
  url: string;
  /** Whether the iframe accepts clicks/drags, or lets them fall through to orbit controls. Default false. */
  interactive?: boolean;
  /** Iframe raster width in CSS px, before being scaled down to the quad's world size. Default 1000. */
  pixelWidth?: number;
}

export interface ScreenQuad {
  css: CSS3DObject;
  occluder: THREE.Mesh;
  iframe: HTMLIFrameElement;
}

export function addScreenQuad(parent: THREE.Object3D, opts: ScreenQuadOptions): ScreenQuad {
  const width = opts.xMax - opts.xMin;
  const height = opts.yMax - opts.yMin;
  const center = new THREE.Vector3(
    (opts.xMin + opts.xMax) / 2,
    (opts.yMin + opts.yMax) / 2,
    opts.z + (opts.zOffset ?? 0.08),
  );

  const iframe = document.createElement("iframe");
  iframe.style.border = "0";
  iframe.style.background = "#fff";
  iframe.src = opts.url;

  // CSS3DObject sizes by raster pixels * object.scale; rasterize at a fixed
  // pixel size, then scale down to the quad's actual (local-unit) size —
  // must match the occluder plane below exactly for the hole to line up.
  const pixelWidth = opts.pixelWidth ?? 1000;
  const pixelHeight = Math.round(pixelWidth * (height / width));
  iframe.style.width = pixelWidth + "px";
  iframe.style.height = pixelHeight + "px";

  const css = new CSS3DObject(iframe);
  // CSS3DObject's own constructor force-sets element.style.pointerEvents to
  // "auto" — so ours has to be applied AFTER construction, or it gets
  // silently overwritten and the iframe stays interactive regardless of
  // what we asked for.
  iframe.style.pointerEvents = opts.interactive ? "auto" : "none";
  css.position.copy(center);
  css.scale.set(width / pixelWidth, height / pixelHeight, 1);
  parent.add(css);

  // WebGL occluder: an invisible-but-depth-writing plane in the exact same
  // spot, punching a transparent hole in the (alpha) WebGL canvas there so
  // the CSS iframe shows through, while still correctly getting hidden by
  // any real geometry that's actually in front of the screen.
  const occluder = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0,
      blending: THREE.NoBlending, // writes rgba(0,0,0,0) verbatim -> transparent hole
      side: THREE.DoubleSide,
    }),
  );
  occluder.position.copy(center);
  parent.add(occluder);

  return { css, occluder, iframe };
}
