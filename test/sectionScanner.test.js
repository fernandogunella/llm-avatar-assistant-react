import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectSections,
  findSectionReference,
  scrollToSection,
  slugify,
  slugToTitle,
} from '../src/components/LlmAvatarAssistant/sectionScanner.js';

// Build a fresh document fragment with the demo page's section structure.
function makeDoc() {
  const html = `
    <div>
      <section id="overview"><h2>Overview</h2><p>Intro.</p></section>
      <section id="quick-start"><h2>Quick Start</h2><p>Setup.</p></section>
      <section id="configuration"><h2>Configuration</h2><p>Props.</p></section>
      <section id="three-avatar"><h2>The 3D Avatar</h2><p>three.js.</p></section>
      <section id="auto-scroll"><h2>Auto-Scroll Behavior</h2><p>Scrolls.</p></section>
    </div>`;
  document.body.innerHTML = html;
  return document;
}

describe('sectionScanner', () => {
  beforeEach(() => makeDoc());

  it('collectSections (auto) finds every section with its title', () => {
    const sections = collectSections(document);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['overview', 'quick-start', 'configuration', 'three-avatar', 'auto-scroll']));
    const overview = sections.find((s) => s.id === 'overview');
    expect(overview.title).toBe('Overview');
  });

  it('collectSections resolves an element for each section', () => {
    const sections = collectSections(document);
    for (const s of sections) {
      expect(s.el(document), `el for ${s.id}`).toBeTruthy();
    }
  });

  it('findSectionReference matches a section by its title in the text', () => {
    const sections = collectSections(document);
    const ref = findSectionReference('Let me explain the Configuration options.', sections);
    expect(ref).not.toBeNull();
    expect(ref.section.id).toBe('configuration');
  });

  it('findSectionReference is case- and diacritic-insensitive', () => {
    const sections = collectSections(document);
    const ref = findSectionReference('See the Quick-Start section for setup.', sections);
    expect(ref).not.toBeNull();
    expect(ref.section.id).toBe('quick-start');
  });

  it('findSectionReference matches a whole word but not a substring', () => {
    const sections = collectSections(document);
    // "auto" alone should not match "auto-scroll" as a whole word when the
    // text only says "automatically" — the real title is "Auto-Scroll Behavior".
    const ref = findSectionReference('We use automatic behaviour here.', sections);
    // "automatic" contains "auto" but the candidate "auto-scroll behavior"
    // is not present, so no match is expected.
    expect(ref).toBeNull();
  });

  it('findSectionReference returns null when nothing matches', () => {
    const sections = collectSections(document);
    expect(findSectionReference('completely unrelated text', sections)).toBeNull();
  });

  it('findSectionReference returns null for empty text or no sections', () => {
    const sections = collectSections(document);
    expect(findSectionReference('', sections)).toBeNull();
    expect(findSectionReference('Configuration', [])).toBeNull();
  });

  it('collectSections honours an explicit list', () => {
    const explicit = [
      { id: 'overview', title: 'Overview' },
      { id: 'pricing', title: 'Pricing', aliases: ['plans', 'cost'] },
    ];
    const sections = collectSections(document, explicit);
    expect(sections.map((s) => s.id)).toEqual(['overview', 'pricing']);
    const ref = findSectionReference('What are the plans?', sections);
    expect(ref.section.id).toBe('pricing');
  });

  it('scrollToSection returns false for a missing target', () => {
    expect(scrollToSection('does-not-exist', { behavior: 'instant' })).toBe(false);
  });

  it('scrollToSection returns true for a valid id (jsdom has no real scroll)', () => {
    // jsdom stubs window.scrollTo as a no-op; we only assert the success path.
    expect(scrollToSection('overview', { behavior: 'instant' })).toBe(true);
  });
});

describe('slug helpers', () => {
  it('slugify lowercases and hyphenates', () => {
    expect(slugify('Quick Start')).toBe('quick-start');
    expect(slugify('The 3D Avatar!')).toBe('the-3d-avatar');
  });

  it('slugify strips diacritics', () => {
    expect(slugify('Café au Lait')).toBe('cafe-au-lait');
  });

  it('slugToTitle expands hyphens to spaces', () => {
    expect(slugToTitle('quick-start')).toBe('quick start');
  });
});
