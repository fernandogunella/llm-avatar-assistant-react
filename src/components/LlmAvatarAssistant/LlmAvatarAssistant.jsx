/**
 * LlmAvatarAssistant.jsx
 *
 * The floating, configurable component. Three parts, in order:
 *   1. Speech bubble (response) — comic style, scrollable, above the avatar.
 *   2. The 3D avatar (three.js) — spins while a query is running.
 *   3. Question input — below the avatar, per the brief.
 *
 * Everything else is transparent: only these three things show.
 *
 * Config (see DEFAULT_CONFIG) covers the llama.cpp / OpenAI-compatible
 * endpoint, model, key, the default text, the model file URL, the side, and
 * how sections are discovered for auto-scroll.
 */
import React, {
  useState, useRef, useEffect, useMemo, useCallback,
} from 'react';
import AvatarCanvas from './AvatarCanvas.jsx';
import { createLlmClient, normalizeLlmConfig } from './llmClient.js';
import { collectSections, findSectionReference, scrollToSection } from './sectionScanner.js';
import { displayMarkdown } from './utils.js';

/**
 * Isolate the 3D avatar in its own error boundary. three.js can throw during
 * render (e.g. WebGL shader compile in headless or constrained GPUs); without
 * this, the exception would unmount the entire assistant. The boundary renders
 * a lightweight 2D fallback so the chat + auto-scroll keep working.
 */
class AvatarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Intentionally non-throwing; log for debugging only.
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.warn('AvatarCanvas error:', error?.message || error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="lav-avatar-wrap" style={{ width: 180, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem' }} aria-label="avatar fallback" role="img">🤖</div>
        </div>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_CONFIG = {
  baseUrl: '/v1',                  // same-origin dev proxy -> llama.cpp
  apiKey: '',
  model: 'default',
  temperature: 0.7,
  defaultText: 'Hi! I live on this page. Ask me anything about it.',
  modelUrl: 'models/robot.glb',
  side: 'right',                  // right | left
  corner: null,                   // null | 'bottom-left' | 'bottom-right'
  maxBubbleHeight: 240,
  sectionDiscovery: 'auto',       // 'auto' | explicit list of {id,title,aliases[]}
  systemPrompt:
    'You are a friendly assistant embedded in this page. ' +
    'Answer concisely (2–4 sentences). ' +
    'When relevant, mention ONE of the on-page sections by its exact title ' +
    'so the user can be taken there. Do not invent sections.',
  streaming: true,
};

export { DEFAULT_CONFIG };

export default function LlmAvatarAssistant({
  config = {},
  onScrollToSection,      // optional escape hatch: (section) => void
  onSend,                 // optional: (question, response) => void
}) {
  const cfg = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  const [input, setInput] = useState('');
  const [response, setResponse] = useState(cfg.defaultText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modelStatus, setModelStatus] = useState('loading');
  const [matchedSection, setMatchedSection] = useState(null);

  const bubbleRef = useRef(null);
  const inputRef = useRef(null);
  const clientRef = useRef(null);
  const sectionsRef = useRef([]);

  // Build the client once per config change.
  useEffect(() => {
    const res = normalizeLlmConfig(cfg);
    if (!res.ok) {
      setError(res.error);
      clientRef.current = null;
      return;
    }
    clientRef.current = createLlmClient({
      baseUrl: res.value.baseUrl,
      apiKey: res.value.apiKey,
      model: res.value.model,
      timeoutMs: cfg.timeoutMs,
      extra: { temperature: res.value.temperature },
    });
    setError('');
  }, [cfg]);

  // (Re)discover sections on mount and on config change.
  useEffect(() => {
    const list = collectSections(document, cfg.sectionDiscovery === 'auto' ? null : cfg.sectionDiscovery);
    sectionsRef.current = list;
  }, [cfg.sectionDiscovery]);

  // Keep the bubble pinned to the newest text while the model streams.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [response, busy]);

  const handleBubbleScroll = useCallback(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottom.current = atBottom;
  }, []);

  const performScroll = useCallback((section) => {
    setMatchedSection(section);
    const ok = scrollToSection(section.id, { behavior: 'smooth', offset: 64 });
    if (onScrollToSection && ok) onScrollToSection(section);
  }, [onScrollToSection]);

  const ask = useCallback(async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const client = clientRef.current;
    if (!client) {
      setError(client ? error : 'The assistant is not configured. Set a valid base URL.');
      return;
    }

    setError('');
    setBusy(true);
    setMatchedSection(null);
    setResponse('');
    stickToBottom.current = true;

    // Give the model enough context about the page so it can reference
    // sections meaningfully (this is what makes the auto-scroll testable).
    const pageContext = sectionsRef.current
      .map((s) => `- ${s.title} (id: ${s.id})`)
      .join('\n');
    const messages = [
      { role: 'system', content: cfg.systemPrompt + (pageContext ? `\n\nOn-page sections:\n${pageContext}` : '') },
      { role: 'user', content: q },
    ];

    let full = '';
    try {
      if (cfg.streaming) {
        full = await client.chatStream(
          messages,
          (token, cur) => setResponse(cur),
        );
      } else {
        full = await client.chat(messages);
        setResponse(full);
      }
      if (!full) setResponse('(empty response)');

      // Scan the final answer for a section reference and scroll there.
      const ref = findSectionReference(full, sectionsRef.current);
      if (ref) performScroll(ref.section);
      if (onSend) onSend(q, full);
    } catch (err) {
      setResponse(prev => (prev || '') + '');
      setError(err?.message || 'The model request failed.');
    } finally {
      setBusy(false);
    }
  }, [input, busy, cfg, error, performScroll, onSend]);

  const submit = (e) => {
    if (e) e.preventDefault();
    ask();
  };

  const sideClass = cfg.corner
    ? `lav-side--${cfg.corner}`
    : `lav-side--${cfg.side === 'left' ? 'left' : 'right'}`;

  return (
    <div className={`lav-root ${sideClass}`} data-testid="lav-root" role="region" aria-label="AI assistant">
      {/* 1 — Response speech bubble */}
      <div
        ref={bubbleRef}
        className={`lav-bubble ${busy ? 'lav-bubble--typing' : ''}`}
        data-testid="lav-bubble"
        onScroll={handleBubbleScroll}
        style={{ maxHeight: cfg.maxBubbleHeight }}
        aria-live="polite"
      >
        {renderResponse(response, busy, matchedSection, performScroll)}
      </div>

      {/* 2 — 3D avatar (isolated: a WebGL/three.js failure must not take
          down the chat UI — it degrades to a 2D placeholder instead). */}
      <AvatarErrorBoundary>
        <AvatarCanvas
          modelUrl={cfg.modelUrl}
          thinking={busy}
          autoFit={{ maxFraction: 0.8 }}
          onReady={() => setModelStatus('ready')}
          onError={() => setModelStatus('error')}
        />
      </AvatarErrorBoundary>

      {/* 3 — Question input */}
      <form className="lav-input-row" onSubmit={submit}>
        <input
          ref={inputRef}
          className="lav-input"
          data-testid="lav-input"
          value={input}
          placeholder="Ask…"
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          aria-label="Ask the assistant"
        />
        <button className="lav-send" data-testid="lav-send" type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>

      {error && (
        <div className="lav-error" data-testid="lav-error" role="alert">{error}</div>
      )}
    </div>
  );
}

/**
 * Render the response, turning any referenced section title into an inline
 * clickable highlight (so the auto-scroll is visible to the user too).
 * Falls back to plain text with no matched section.
 */
function renderResponse(text, busy, matchedSection, performScroll) {
  const body = busy && !text ? '…' : displayMarkdown(text) || '…';
  if (!matchedSection) {
    return <span data-testid="lav-response-text">{body}</span>;
  }
  // Highlight the first occurrence of the matched section's title/alias.
  const title = matchedSection.title;
  const lower = body.toLowerCase();
  const tLower = (title || '').toLowerCase();
  const at = tLower ? lower.indexOf(tLower) : -1;
  if (at === -1) return <span data-testid="lav-response-text">{body}</span>;
  return (
    <span data-testid="lav-response-text">
      {body.slice(0, at)}
      <span
        className="lav-bubble-section-link"
        data-testid="lav-section-link"
        onClick={() => performScroll(matchedSection)}
        title={`Go to ${title}`}
      >
        {body.slice(at, at + (title || '').length)}
      </span>
      {body.slice(at + (title || '').length)}
    </span>
  );
}
