/**
 * autoFit.js
 *
 * Computes how to scale + place an arbitrary loaded model inside a known
 * world-space viewport so it never looks comically huge or tiny. The component
 * chooses a camera whose visible frustum at the model plane is `viewW × viewH`
 * world units; autoFit then scales the model to occupy at most `maxFraction`
 * of that box (fitting both width and height) and recentres it at the origin.
 *
 * Pure math over a THREE.Box3 (or a plain {min,max}) — trivially unit-testable
 * without a GPU.
 *
 * Usage (in AvatarCanvas):
 *   const box = new THREE.Box3().setFromObject(model);
 *   const fit = computeFit(box, { viewW, viewH, maxFraction: 0.8 });
 *   model.scale.setScalar(fit.scale);
 *   model.position.set(centeredPosition(fit).x, .y, .z);
 */

/**
 * @param {{min:{x,y,z}, max:{x,y,z}}|{getSize,getCenter}} box THREE.Box3 or plain
 * @param {{viewW:number, viewH:number, maxFraction?:number}} target
 * @returns {{scale:number, size:{x,y,z}, center:{x,y,z}, aspect:number, modelAspect:number}}
 */
export function computeFit(box, target) {
  const size = readSize(box);
  const center = readCenter(box);
  const { viewW, viewH, maxFraction = 0.8 } = target;

  const targetH = (viewH || 1) * maxFraction;
  const targetW = (viewW || 1) * maxFraction;

  // Fit the model's on-screen width AND height within the box. Depth (z) is
  // not constrained here because a front-facing view only clips on x/y; a deep
  // model would otherwise shrink far below what's needed.
  const scale = Math.min(targetH / (size.y || 1), targetW / (size.x || 1));

  return {
    scale: Math.max(scale, 1e-6),
    size,
    center,
    aspect: viewW / Math.max(viewH, 1e-6),        // screen aspect
    modelAspect: size.y / Math.max(size.x, size.z, 1e-6), // tall vs wide
  };
}

/**
 * World-space position that recentres the scaled model at the origin so it is
 * centred in the view regardless of the model's internal offset.
 * @param {{center:{x,y,z}, scale:number}} fit  result of computeFit()
 * @returns {{x:number, y:number, z:number}}
 */
export function centeredPosition(fit) {
  const c = fit.center || { x: 0, y: 0, z: 0 };
  const s = fit.scale || 1;
  return { x: -c.x * s, y: -c.y * s, z: -c.z * s };
}

/* --------------------------- internals --------------------------- */

// A THREE.Box3 always exposes .min / .max vectors; reading them directly is
// framework-agnostic and avoids depending on the getSize(target)/getCenter
// signatures (which require a real Vector3 target to mutate).
function readSize(box) {
  const mn = box.min;
  const mx = box.max;
  if (mn && mx) return { x: (mx.x - mn.x) || 1, y: (mx.y - mn.y) || 1, z: (mx.z - mn.z) || 1 };
  if (typeof box.getSize === 'function') {
    const v = box.getSize({ x: 0, y: 0, z: 0, set(p, y, z) { this.x = p; this.y = y; this.z = z; return this; } });
    return v;
  }
  return { x: 1, y: 1, z: 1 };
}

function readCenter(box) {
  const mn = box.min;
  const mx = box.max;
  if (mn && mx) return { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 };
  if (typeof box.getCenter === 'function') {
    return box.getCenter({ x: 0, y: 0, z: 0, set(p, y, z) { this.x = p; this.y = y; this.z = z; return this; } });
  }
  return { x: 0, y: 0, z: 0 };
}
