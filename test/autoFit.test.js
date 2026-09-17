import { describe, it, expect } from 'vitest';
import { computeFit, centeredPosition } from '../src/components/LlmAvatarAssistant/autoFit.js';
import { normalize, stripCodeFence, plainMarkdown } from '../src/components/LlmAvatarAssistant/utils.js';

// A THREE.Box3-like object with getSize/getCenter, or a plain min/max pair.
function boxFrom(min, max) {
  return { min, max };
}

describe('autoFit.computeFit', () => {
  it('scales a unit cube to fill maxFraction of the binding dimension', () => {
    const box = boxFrom({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const fit = computeFit(box, { viewW: 3, viewH: 3.75, maxFraction: 0.8 });
    // Portrait box: targetW = 3*0.8 = 2.4 < targetH = 3.0 -> width binds.
    expect(fit.scale).toBeCloseTo(2.4, 5);
    expect(fit.size.y).toBeCloseTo(1, 5);
  });

  it('a very large model scales down (never huge)', () => {
    const box = boxFrom({ x: 0, y: 0, z: 0 }, { x: 500, y: 500, z: 500 });
    const fit = computeFit(box, { viewW: 3, viewH: 3.75, maxFraction: 0.8 });
    expect(fit.scale).toBeCloseTo(2.4 / 500, 5);
    expect(fit.scale).toBeLessThan(0.01);
  });

  it('a very small model scales up (never tiny)', () => {
    const box = boxFrom({ x: 0, y: 0, z: 0 }, { x: 0.01, y: 0.01, z: 0.01 });
    const fit = computeFit(box, { viewW: 3, viewH: 3.75, maxFraction: 0.8 });
    expect(fit.scale).toBeCloseTo(2.4 / 0.01, 5);
    expect(fit.scale).toBeGreaterThan(100);
  });

  it('a wide model is constrained by width, not height', () => {
    // width 10, height 1 -> width would be the limiting dimension.
    const box = boxFrom({ x: 0, y: 0, z: 0 }, { x: 10, y: 1, z: 1 });
    const fit = computeFit(box, { viewW: 3, viewH: 3.75, maxFraction: 0.8 });
    // targetW = 3*0.8 = 2.4; scale = 2.4 / 10 = 0.24 (width-limited)
    expect(fit.scale).toBeCloseTo(0.24, 5);
  });

  it('reads size/center from a Box3-like getSize/getCenter object', () => {
    const fakeBox = {
      getSize: () => ({ x: 2, y: 4, z: 2 }),
      getCenter: () => ({ x: 1, y: 2, z: 0 }),
    };
    const fit = computeFit(fakeBox, { viewW: 4, viewH: 4, maxFraction: 1 });
    // height 4 -> scale = 4/4 = 1 (height-limited, since targetW=4/2=... )
    // targetH = 4, size.y = 4 -> 1. targetW = 4, size.x = 2 -> 2. min = 1.
    expect(fit.scale).toBeCloseTo(1, 5);
    expect(fit.center.y).toBeCloseTo(2, 5);
  });

  it('centeredPosition recentres an offset model at the origin', () => {
    // A model whose centre is at (2,3,0) scaled by 0.5 should be moved to
    // (-1, -1.5, 0) so it lands centred.
    const fit = { scale: 0.5, center: { x: 2, y: 3, z: 0 } };
    const pos = centeredPosition(fit);
    expect(pos.x).toBeCloseTo(-1, 5);
    expect(pos.y).toBeCloseTo(-1.5, 5);
    expect(pos.z).toBeCloseTo(0, 5);
  });
});

describe('utils', () => {
  it('normalize lowercases, strips diacritics, collapses spaces', () => {
    expect(normalize('  Café  AU  Lait ')).toBe('cafe au lait');
  });

  it('stripCodeFence removes fences', () => {
    expect(stripCodeFence('```js\nconst a=1;\n```')).toBe('const a=1;');
  });

  it('plainMarkdown strips basic formatting', () => {
    expect(plainMarkdown('**bold** and `code`')).toBe('bold and code');
    // The heading marker is removed; the line break is preserved.
    expect(plainMarkdown('## Heading\ntext')).toBe('Heading\ntext');
    expect(plainMarkdown('## Heading text')).toBe('Heading text');
  });
});
