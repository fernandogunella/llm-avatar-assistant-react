/**
 * AvatarCanvas.jsx
 *
 * three.js viewport that renders a single GLB model with:
 *   - a transparent background (the page shows through),
 *   - auto-fitting: the model is scaled + recentred on load so it always
 *     fits the fixed viewport, whatever the asset's native size,
 *   - two states: "idle" (gentle bob + slow turn) and "thinking" (the
 *     requested circular spin) — both fall back to a procedural robot if
 *     the GLB fails to load,
 *   - graceful degradation: if WebGL is unavailable it renders a 2D
 *     placeholder so the rest of the component keeps working.
 *
 * The model file is swappable: change the `modelUrl` prop (or drop a new
 * .glb into public/models and point it there). No other code changes are
 * needed — autoFit handles the rest.
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { computeFit, centeredPosition } from './autoFit.js';

/** Is a WebGL context available? (false in jsdom / very old browsers) */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

// World-space viewport: the camera is positioned so that a 3 × 3.75 unit box
// fills the canvas (4:5 aspect, matching the 180×220 CSS box). autoFit sizes
// the model against this box.
const VIEW_W = 3;
const VIEW_H = 3.75;

function buildRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0); // fully transparent
  return renderer;
}

function buildScene() {
  const scene = new THREE.Scene();
  // Soft studio lighting so arbitrary models read well without an HDRI.
  // (No PMREM environment map: it needs a live renderer and is what crashes
  // in headless/constrained WebGL. Plain lights are robust everywhere.)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.5);
  fill.position.set(-3, 1, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(0, -2, -3);
  scene.add(rim);
  return scene;
}

// Position the camera so the frustum at z=0 spans exactly VIEW_W × VIEW_H.
// A fixed distance + FOV gives a stable "portrait" framing regardless of the
// model's size (which autoFit normalises separately).
function buildCamera() {
  const fov = 40; // degrees
  const cam = new THREE.PerspectiveCamera(fov, VIEW_W / VIEW_H, 0.1, 100);
  const dist = VIEW_H / (2 * Math.tan((fov / 2) * Math.PI / 180));
  cam.position.set(0, 0.1, dist);
  cam.lookAt(0, 0, 0);
  return cam;
}

// Apply autoFit to a freshly loaded object: scale to fit the viewport box and
// recenter at the origin. Mutates `obj` in place and returns the fitted group.
function applyAutoFit(obj, { viewW = VIEW_W, viewH = VIEW_H, maxFraction = 0.8 }) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return obj;
  const fit = computeFit(box, { viewW, viewH, maxFraction });
  const pos = centeredPosition(fit);
  obj.scale.setScalar(fit.scale);
  obj.position.set(pos.x, pos.y, pos.z);
  // Re-run after scaling so a nested offset model still lands centred.
  obj.updateWorldMatrix(true, true);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c2 = box2.getCenter(new THREE.Vector3());
  obj.position.x -= c2.x;
  obj.position.y -= c2.y;
  obj.position.z -= c2.z;
  return obj;
}

// Build the built-in thinking animation: the model orbits a circle around the
// Y axis. Implemented on a pivot so any model (not just GLTF clips) animates.
function orbitPivot(obj, pivot) {
  pivot.add(obj);
  return pivot;
}

// Fallback procedural robot used if the GLB fails — keeps the demo functional.
function buildPlaceholderRobot() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7c9bff, metalness: 0.3, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3350, metalness: 0.5, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 8, 16), mat);
  body.position.y = -0.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), dark);
  head.position.y = 0.62;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0x88aaff, emissiveIntensity: 0.8 }));
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.14, 0.66, 0.28);
  eyeR.position.set(0.14, 0.66, 0.28);
  g.add(body, head, eyeL, eyeR);
  return g;
}

export default function AvatarCanvas({
  modelUrl = 'models/robot.glb',
  thinking = false,
  idleSpin = true,
  autoFit = { maxFraction: 0.8 },
  width = 180,
  height = 220,
  onReady,
  onError,
  onThinkingStateChange,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const thinkingRef = useRef(thinking);

  // Keep the thinking flag available to the animation loop without
  // re-creating the renderer on every toggle.
  useEffect(() => {
    thinkingRef.current = thinking;
    if (onThinkingStateChange) onThinkingStateChange(thinking);
  }, [thinking, onThinkingStateChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    if (!webglAvailable()) {
      setStatus('unsupported');
      if (onError) onError(new Error('WebGL not available'));
      return undefined;
    }

    let disposed = false;
    let renderer;
    let raf;
    try {
      renderer = buildRenderer(canvas);
    } catch (err) {
      setStatus('error');
      if (onError) onError(err);
      return undefined;
    }

    const scene = buildScene();
    const camera = buildCamera();
    const pivot = new THREE.Group();
    scene.add(pivot);

    let model = null;
    let mixer = null;
    let clipAction = null;
    const clock = new THREE.Clock();

    const apply = (obj) => {
      // Remove any previous model
      if (model && model.parent) model.parent.remove(model);
      model = obj;
      const fitted = applyAutoFit(model, {
        viewW: VIEW_W,
        viewH: VIEW_H,
        maxFraction: autoFit?.maxFraction ?? 0.8,
      });
      orbitPivot(fitted, pivot);

      // Use the model's own animation clips if it has them (RobotExpressive
      // ships dozens); otherwise we rely on the procedural idle/think motion.
      mixer = new THREE.AnimationMixer(fitted);
      const clips = fitted.animations || [];
      if (clips.length) {
        const idleClip =
          clips.find((c) => /idle/i.test(c.name)) || clips[0];
        clipAction = mixer.clipAction(idleClip);
        clipAction.play();
      }
      setStatus('ready');
      if (onReady) onReady();
    };

    // Load the model; on failure fall back to the placeholder robot.
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) return;
        apply(gltf.scene);
      },
      undefined,
      (err) => {
        if (disposed) return;
        if (onError) onError(err);
        apply(buildPlaceholderRobot());
      }
    );

    function resize() {
      const w = canvas.clientWidth || width;
      const h = canvas.clientHeight || height;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function frame() {
      if (disposed) return;
      const dt = clock.getDelta();
      const t = clock.elapsedTime;
      const isThinking = thinkingRef.current;

      if (mixer) mixer.update(dt);

      if (isThinking) {
        // Circular spin: orbit the whole pivot around Y + a gentle bob.
        pivot.rotation.y = t * 1.6;
        pivot.position.y = Math.sin(t * 3) * 0.05;
      } else if (idleSpin) {
        // Idle: slow turn + breathing bob (model's own clip plays beneath).
        pivot.rotation.y = Math.sin(t * 0.6) * 0.25;
        pivot.position.y = Math.sin(t * 1.5) * 0.03;
      } else {
        pivot.position.y = 0;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    frame();

    stateRef.current = { scene, camera, renderer, pivot };

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (mixer) mixer.stopAllAction();
      if (model) {
        model.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
          }
        });
      }
      renderer.dispose();
      stateRef.current = null;
    };
    // Re-init only when the model URL changes (the whole reason to remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  return (
    <div className="lav-avatar-wrap" style={{ width, height }}>
      <canvas ref={canvasRef} style={{ width, height }} aria-label="3D avatar" />
      {status !== 'ready' && (
        <div className="lav-avatar-status" data-testid="avatar-status">
          {status === 'loading' && '…'}
          {status === 'error' && 'avatar error'}
          {status === 'unsupported' && 'no webgl'}
        </div>
      )}
    </div>
  );
}
