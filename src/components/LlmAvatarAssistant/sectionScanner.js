/**
 * sectionScanner.js
 *
 * Detects references to on-page sections inside an LLM response and scrolls
 * the host SPA to them. This is pure/DOM-only (no three.js), so it is cheap
 * to unit-test under jsdom.
 *
 * Matching strategy (robust + deterministic, no fuzzy surprises):
 *   1. The host registers its sections via config: either an explicit list of
 *      {id, title, aliases[]} entries, or "auto" — in which case we read every
 *      <section id> / <h2 id> in the document and build entries automatically.
 *   2. A section is "referenced" when the model text contains its id or any of
 *      its titles/aliases, with case-insensitive, diacritic-insensitive, whole
 *      boundary matching (so "Hero" does not match "heroic").
 *   3. We return the FIRST referenced section in scan order; the component
 *      scrolls to it (and can highlight the matched text).
 */

import { normalize } from './utils.js';

/**
 * Build the list of section descriptors to watch for.
 *
 * @param {Document} [doc]
 * @param {Array} [explicit] optional explicit list from config
 * @returns {Array<{id: string, title: string, aliases: string[], el: () => Element|null}>}
 */
export function collectSections(doc = globalThis.document, explicit) {
  if (explicit && Array.isArray(explicit) && explicit.length) {
    return explicit
      .filter((s) => s && (s.id || s.title))
      .map((s) => ({
        id: s.id || slugify(s.title),
        title: s.title || s.id,
        aliases: normalizeAliases(s.aliases),
        el: (d = doc) => findSectionEl(d, s.id, s.title, s.aliases),
      }));
  }

  const out = [];
  const seen = new Set();
  const nodes = doc.querySelectorAll('section[id], h2[id], h3[id]');
  nodes.forEach((node) => {
    const id = node.getAttribute('id');
    if (!id || seen.has(id)) return;
    seen.add(id);

    // The visible title is the nearest heading inside/before the section, or
    // the heading itself when the node is a heading.
    let title = '';
    if (node.matches('h2, h3')) {
      title = node.textContent.trim();
    } else {
      const h = node.querySelector('h1, h2, h3');
      title = h ? h.textContent.trim() : id;
    }

    if (!title) return;
    out.push({
      id,
      title,
      aliases: normalizeAliases([slugToTitle(id)]),
      el: (d = doc) => findSectionEl(d, id, title),
    });
  });
  return out;
}

/**
 * Scan `text` for the first referenced section.
 *
 * @param {string} text
 * @param {Array} sections output of collectSections()
 * @returns {{section, matched, index} | null}
 */
export function findSectionReference(text, sections) {
  if (!text || !Array.isArray(sections) || !sections.length) return null;
  const hay = normalize(text);

  for (const s of sections) {
    const candidates = buildCandidates(s);
    for (const cand of candidates) {
      const idx = indexOfDiacriticInsensitive(hay, cand);
      if (idx !== -1) {
        return { section: s, matched: cand, index: idx };
      }
    }
  }
  return null;
}

/**
 * Scroll the host page to a section. Returns true on success.
 * @param {string|Element} target id or element
 * @param {{behavior?: string, offset?: number, doc?: Document}} opts
 */
export function scrollToSection(target, { behavior = 'smooth', offset = 0, doc = globalThis.document } = {}) {
  const el = typeof target === 'string' ? doc.getElementById(target) : target;
  if (!el) return false;

  const top = getSectionTop(el, offset);
  // window.scrollTo is the reliable cross-scroll-container path.
  const scroller = doc.defaultView || globalThis.window;
  if (scroller && typeof scroller.scrollTo === 'function') {
    try {
      scroller.scrollTo({ top, behavior });
    } catch {
      // Some environments (jsdom) throw "Not implemented"; fall through.
    }
    return true;
  }
  if (doc.documentElement) doc.documentElement.scrollTop = top;
  return true;
}

/* --------------------------- internals --------------------------- */

function getSectionTop(el, offset) {
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0 };
  const win = el.ownerDocument?.defaultView || globalThis.window;
  const scrollY = win?.scrollY ?? win?.pageYOffset ?? 0;
  return Math.max(0, rect.top + scrollY - (offset || 0));
}

function buildCandidates(s) {
  const set = new Set();
  // id (slug) and title (human) are the strongest signals.
  if (s.id) set.add(s.id);
  if (s.title) set.add(s.title);
  (s.aliases || []).forEach((a) => a && set.add(a));
  // Drop candidates that are too short to match reliably (<=2 chars) to avoid
  // accidental whole-word hits.
  return [...set].map(normalize).filter((c) => c.length > 2);
}

function indexOfDiacriticInsensitive(hay, needle) {
  const n = normalize(needle);
  if (!n) return -1;
  const i = hay.indexOf(n);
  if (i === -1) return -1;
  // Whole-boundary check: characters around the match must not be word chars,
  // otherwise "hero" would match inside "heroic".
  const before = hay[i - 1];
  const after = hay[i + n.length];
  const word = /[a-z0-9]/;
  if (before && word.test(before)) return -1;
  if (after && word.test(after)) return -1;
  return i;
}

function findSectionEl(doc, id, title, aliases) {
  if (id && doc.getElementById(id)) return doc.getElementById(id);
  // Fallback: locate by heading text (covers auto sections whose id was
  // generated from the heading).
  const normTitle = normalize(title || '');
  const headings = doc.querySelectorAll('h1, h2, h3, [id]');
  for (const h of headings) {
    const hid = h.getAttribute('id');
    if (hid && (hid === id || hid === title)) return h;
    if (normTitle && normalize(h.textContent || '') === normTitle) return h;
  }
  return null;
}

export function slugify(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugToTitle(slug) {
  return String(slug || '').replace(/[-_]/g, ' ').trim();
}

function normalizeAliases(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(Boolean).map((a) => String(a));
}
