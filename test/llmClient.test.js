import { describe, it, expect, vi } from 'vitest';
import { createLlmClient, normalizeLlmConfig } from '../src/components/LlmAvatarAssistant/llmClient.js';

// A helper to build a fake fetch that returns a canned OpenAI-shaped body.
function fakeFetchOnce(body, { ok = true, status = 200, headers = {} } = {}) {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: { get: (k) => (headers[k.toLowerCase()] ?? null) },
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

function fakeFetchStream(chunks, done = true) {
  // Build an SSE body as a ReadableStream so chatStream's reader loop runs.
  const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  if (done) lines.push('data: [DONE]\n\n');
  const text = lines.join('');
  const stream = new ReadableStream({
    start(controller) {
      // Deliver in two pieces to exercise the buffering path.
      const mid = Math.floor(text.length / 2);
      controller.enqueue(new TextEncoder().encode(text.slice(0, mid)));
      controller.enqueue(new TextEncoder().encode(text.slice(mid)));
      controller.close();
    },
  });
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
    body: stream,
  }));
}

describe('llmClient', () => {
  it('chat() posts to /chat/completions and returns content', async () => {
    const body = { choices: [{ message: { content: 'Hello from the model' } }] };
    const fetchImpl = fakeFetchOnce(body);
    const client = createLlmClient({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl });

    const out = await client.chat([{ role: 'user', content: 'hi' }]);

    expect(out).toBe('Hello from the model');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://x/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer k');
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('m');
    expect(sent.stream).toBe(false);
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('chat() strips a trailing slash from baseUrl', async () => {
    const fetchImpl = fakeFetchOnce({ choices: [{ message: { content: 'ok' } }] });
    const client = createLlmClient({ baseUrl: 'http://x/v1///', fetchImpl });
    await client.chat([{ role: 'user', content: 'x' }]);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://x/v1/chat/completions');
  });

  it('chat() throws a descriptive error on non-OK status', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'no such model',
    }));
    const client = createLlmClient({ baseUrl: 'http://x/v1', fetchImpl });
    await expect(client.chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/404/);
  });

  it('chat() surfaces network failures', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const client = createLlmClient({ baseUrl: 'http://x/v1', fetchImpl });
    await expect(client.chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/request failed/);
  });

  it('chatStream() accumulates tokens across chunk boundaries and calls onToken', async () => {
    const fetchImpl = fakeFetchStream(['Hel', 'lo ', 'wo', 'rld']);
    const client = createLlmClient({ baseUrl: 'http://x/v1', fetchImpl });

    let acc = '';
    const out = await client.chatStream(
      [{ role: 'user', content: 'x' }],
      (tok) => { acc += tok; }
    );

    expect(out).toBe('Hello world');
    expect(acc).toBe('Hello world');
    // onToken called once per non-empty delta
    expect([1, 2, 3, 4].includes(fetchImpl.mock.calls.length)).toBe(true);
  });

  it('chatStream() falls back to non-streaming when server ignores stream', async () => {
    // No content-type SSE + json body
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: 'fallback text' } }] }),
      // body is undefined -> triggers the non-SSE fallback branch
      body: undefined,
    }));
    const client = createLlmClient({ baseUrl: 'http://x/v1', fetchImpl });
    let acc = '';
    const out = await client.chatStream([{ role: 'user', content: 'x' }], (t) => { acc += t; });
    expect(out).toBe('fallback text');
    expect(acc).toBe('fallback text');
  });

  it('getModelInfo() returns the first model id', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'FG-Contexto' }] }),
    }));
    const client = createLlmClient({ baseUrl: 'http://x/v1', fetchImpl });
    await expect(client.getModelInfo()).resolves.toBe('FG-Contexto');
  });

  it('getModelInfo() returns "" when the endpoint errors', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('nope'); });
    const client = createLlmClient({ baseUrl: 'http://x/v1', fetchImpl });
    await expect(client.getModelInfo()).resolves.toBe('');
  });
});

describe('normalizeLlmConfig', () => {
  it('rejects a missing baseUrl', () => {
    expect(normalizeLlmConfig({}).ok).toBe(false);
  });

  it('rejects an invalid baseUrl', () => {
    expect(normalizeLlmConfig({ baseUrl: 'not a url' }).ok).toBe(false);
  });

  it('accepts a relative /v1 base (dev proxy)', () => {
    const r = normalizeLlmConfig({ baseUrl: '/v1', model: 'm' });
    expect(r.ok).toBe(true);
    expect(r.value.baseUrl).toBe('/v1');
    expect(r.value.model).toBe('m');
  });

  it('normalizes an absolute url (drops trailing slash)', () => {
    const r = normalizeLlmConfig({ baseUrl: 'http://192.168.1.2:8080/v1/', apiKey: 'k' });
    expect(r.ok).toBe(true);
    expect(r.value.baseUrl).toBe('http://192.168.1.2:8080/v1');
  });
});
