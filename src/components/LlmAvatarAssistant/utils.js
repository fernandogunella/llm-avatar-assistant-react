/**
 * utils.js — tiny shared helpers.
 */

/**
 * Normalise text for robust matching: lowercase, strip diacritics, collapse
 * whitespace. "Café  Grande" -> "cafe grande".
 */
export function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip a markdown-style code fence from a raw string, if present. */
export function stripCodeFence(str) {
  return String(str || '').replace(/^```[a-z]*\n?|```$/g, '').trim();
}

/** Render a lightweight subset of markdown to plain text (no external lib). */
export function plainMarkdown(md) {
  let s = String(md || '');
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/^```[a-z]*\n?|\n?```$/g, '').trim());
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/^\s*[-*]\s+/gm, '');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return s.trim();
}

/**
 * Lightweight display cleaning for the speech bubble: strips markdown
 * emphasis/code/heading/link syntax so the model's raw answer reads cleanly,
 * while preserving words (so section-title detection on the same text still
 * holds). Does NOT trim leading/trailing whitespace per line.
 */
export function displayMarkdown(md) {
  let s = String(md || '');
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/^```[a-z]*\n?|\n?```$/g, '').trim());
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return s;
}
