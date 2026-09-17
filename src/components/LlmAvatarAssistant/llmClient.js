/**
 * llmClient.js
 *
 * Minimal, dependency-free client for any OpenAI-compatible chat endpoint —
 * this covers llama.cpp's `llama-server` out of the box.
 *
 * Why a hand-rolled client instead of `openai`/`@openai/openai`?
 *   - Zero added dependency weight for a drop-in component.
 *   - Full control over the request shape (llama.cpp accepts the standard
 *     `chat/completions` route plus a few extra knobs we expose).
 *   - Easy to test: we inject `fetch`, so unit tests never touch the network.
 *
 * Public API:
 *   createLlmClient(config)          -> LlmClient
 *   LlmClient.chat(messages, opts?)  -> Promise<string>   (non-streaming)
 *   LlmClient.chatStream(messages, onToken, opts?) -> Promise<string>
 *   LlmClient.getModelInfo()         -> Promise<string>   (best-effort model id)
 */

const DEFAULT_TIMEOUT_MS = 120_000; // local models can be slow on first token

/**
 * Build an LlmClient.
 *
 * @param {object} config
 * @param {string} config.baseUrl  e.g. "http://192.168.1.2:8080/v1" or "/v1"
 * @param {string} [config.apiKey]
 * @param {string} [config.model]  model id to send in the payload
 * @param {number} [config.timeoutMs]
 * @param {typeof fetch} [fetchImpl] injectable for tests
 * @param {object}   [config.extra] extra body fields merged into requests
 */
export function createLlmClient({
  baseUrl,
  apiKey = '',
  model = 'default',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  extra = {},
}) {
  if (!baseUrl) throw new Error('llmClient: baseUrl is required');

  // Normalise: strip a trailing slash so `${baseUrl}/chat/completions` is
  // always exactly one slash, even when callers pass ".../v1/".
  const base = baseUrl.replace(/\/+$/, '');

  function buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
  }

  function withTimeout(incomingSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('llmClient: timeout')), timeoutMs);
    const onAbort = () => controller.abort();
    if (incomingSignal && typeof incomingSignal.addEventListener === 'function') {
      if (incomingSignal.aborted) controller.abort();
      else incomingSignal.addEventListener('abort', onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        if (incomingSignal && typeof incomingSignal.removeEventListener === 'function') {
          incomingSignal.removeEventListener('abort', onAbort);
        }
      },
    };
  }

  async function request(path, body, { signal } = {}) {
    const t = withTimeout(signal && signal.aborted !== undefined ? signal : null);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ model, ...body, ...extra }),
        signal: t.signal,
      });
    } catch (err) {
      const e = new Error(`llmClient: request failed (${err?.message || 'network'})`);
      e.cause = err;
      throw e;
    } finally {
      t.cleanup();
    }

    if (!res.ok) {
      let detail = '';
      try {
        const txt = await res.text();
        detail = txt.slice(0, 400);
      } catch { /* ignore */ }
      const e = new Error(`llmClient: HTTP ${res.status} ${res.statusText} ${detail}`.trim());
      e.status = res.status;
      throw e;
    }

    return res;
  }

  return {
    /**
     * Non-streaming chat. Returns the assistant message content as a string.
     * @param {Array<{role: string, content: string}>} messages
     */
    async chat(messages, { signal, onToken } = {}) {
      const body = {
        messages,
        stream: false,
        temperature: extra.temperature ?? 0.7,
      };
      const res = await request('/chat/completions', body, { signal });
      const data = await res.json();
      const content =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        '';
      if (typeof content !== 'string') {
        throw new Error('llmClient: unexpected response shape (no content)');
      }
      if (onToken && content) onToken(content);
      return content;
    },

    /**
     * Streaming chat (SSE). Calls `onToken(text)` as tokens arrive and
     * resolves with the full accumulated string. Degrades gracefully: if
     * the server ignores `stream:true` and returns a plain JSON body, we
     * fall back to the non-streaming shape so a misconfigured llama.cpp
     * still works.
     *
     * @param {Array<{role: string, content: string}>} messages
     * @param {(token: string, full: string) => void} onToken
     */
    async chatStream(messages, onToken, { signal } = {}) {
      const body = { messages, stream: true, temperature: extra.temperature ?? 0.7 };
      const res = await request('/chat/completions', body, { signal });
      const ct = res.headers.get('content-type') || '';

      // Non-SSE fallback (server returned a normal JSON completion).
      if (!ct.includes('text/event-stream') && !res.body) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        if (onToken && content) onToken(content);
        return content;
      }
      if (!res.body) {
        throw new Error('llmClient: response had no body for streaming');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let full = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop(); // keep any partial trailing frame

        for (const frame of parts) {
          for (const rawLine of frame.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return full;
            try {
              const obj = JSON.parse(payload);
              const delta = obj?.choices?.[0]?.delta?.content
                ?? obj?.choices?.[0]?.text
                ?? '';
              if (delta) {
                full += delta;
                if (onToken) onToken(delta, full);
              }
            } catch {
              // Ignore malformed frames; llama.cpp occasionally flushes
              // keep-alive comments that are not JSON.
            }
          }
        }
      }
      return full;
    },

    /**
     * Best-effort discovery of the loaded model id. llama.cpp exposes
     * GET /models; some proxies do not. Returns '' when unavailable so
     * callers can fall back to the configured model name.
     */
    async getModelInfo() {
      try {
        const res = await fetchImpl(`${base}/models`, { headers: buildHeaders() });
        if (!res.ok) return '';
        const data = await res.json();
        return data?.data?.[0]?.id ?? '';
      } catch {
        return '';
      }
    },
  };
}

/**
 * Validate + normalise user-facing config before building a client.
 * Kept separate so the component can surface readable errors early.
 *
 * @returns {{ok: boolean, value?: object, error?: string}}
 */
export function normalizeLlmConfig(raw) {
  const cfg = raw || {};
  const baseUrl = (cfg.baseUrl || '').trim();
  if (!baseUrl) return { ok: false, error: 'A base URL is required (e.g. http://192.168.1.2:8080/v1).' };

  // Accepted shapes:
  //   - a relative proxy path starting with "/" (e.g. "/v1"), which the dev
  //     server or host SPA resolves same-origin, or
  //   - an absolute http(s) URL.
  const isRelative = baseUrl.startsWith('/');
  const isAbsolute = /^https?:\/\//i.test(baseUrl);
  if (!isRelative && !isAbsolute) {
    return { ok: false, error: 'The base URL must be a relative path (e.g. /v1) or an absolute http(s) URL.' };
  }

  let finalUrl;
  if (isRelative) {
    finalUrl = baseUrl;
  } else {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      return { ok: false, error: 'The base URL is not a valid URL.' };
    }
    finalUrl = url.origin + url.pathname.replace(/\/$/, '');
  }

  return {
    ok: true,
    value: {
      baseUrl: finalUrl,
      apiKey: String(cfg['apiKey'] || '').trim(),
      model: (cfg.model || 'default').trim(),
      temperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.7,
    },
  };
}
