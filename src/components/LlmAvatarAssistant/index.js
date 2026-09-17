/**
 * Barrel export for the LlmAvatarAssistant package.
 * Import from here to pull in the component and its helpers:
 *
 *   import { LlmAvatarAssistant, DEFAULT_CONFIG } from './LlmAvatarAssistant';
 *   // or the low-level parts:
 *   import { createLlmClient } from './LlmAvatarAssistant/llmClient.js';
 */
export { default, DEFAULT_CONFIG } from './LlmAvatarAssistant.jsx';
export { default as AvatarCanvas, webglAvailable } from './AvatarCanvas.jsx';
export { createLlmClient, normalizeLlmConfig } from './llmClient.js';
export {
  collectSections,
  findSectionReference,
  scrollToSection,
  slugify,
  slugToTitle,
} from './sectionScanner.js';
export { computeFit, centeredPosition } from './autoFit.js';
export { normalize, stripCodeFence, plainMarkdown } from './utils.js';
