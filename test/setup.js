import '@testing-library/jest-dom/vitest';

// jsdom does not implement several browser APIs that three.js or our
// component touch. Keep this list minimal and only shim what we actually
// need so we don't hide real bugs.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverShim;
}

// three.js uses WebGL in the browser; under jsdom we never instantiate
// a real renderer in unit tests (AvatarCanvas guards on renderer
// availability), so no WebGL shim is needed here.
