import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LlmAvatarAssistant from '../src/components/LlmAvatarAssistant/LlmAvatarAssistant.jsx';

// Build the demo section structure the assistant scans against.
function mountPage() {
  document.body.innerHTML = `
    <section id="overview"><h2>Overview</h2><p>Intro.</p></section>
    <section id="quick-start"><h2>Quick Start</h2><p>Setup.</p></section>
    <section id="configuration"><h2>Configuration</h2><p>Props.</p></section>`;
}

function fakeChatFetch(assistantText) {
  // Non-streaming success response.
  return vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.stream) {
      // Return SSE so the streaming path runs (the component defaults to stream).
      const chunks = assistantText.match(/.{1,6}/g) || [];
      const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
      lines.push('data: [DONE]\n\n');
      const text = lines.join('');
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(text));
          ctrl.close();
        },
      });
      return {
        ok: true, status: 200, statusText: 'OK',
        headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
        body: stream,
      };
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: assistantText } }] }),
    };
  });
}

describe('LlmAvatarAssistant component', () => {
  beforeEach(() => mountPage());
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders the three parts: bubble, avatar canvas, input', () => {
    render(<LlmAvatarAssistant config={{ defaultText: 'Ready.' }} />);
    expect(screen.getByTestId('lav-bubble')).toBeTruthy();
    expect(screen.getByTestId('lav-input')).toBeTruthy();
    expect(screen.getByTestId('lav-send')).toBeTruthy();
    // The default text shows before any question.
    expect(screen.getByTestId('lav-response-text')).toHaveTextContent('Ready.');
  });

  it('positions on the right by default', () => {
    const { container } = render(<LlmAvatarAssistant />);
    const root = container.querySelector('.lav-root');
    expect(root.className).toMatch(/lav-side--right/);
  });

  it('positions on the left when configured', () => {
    const { container } = render(<LlmAvatarAssistant config={{ side: 'left' }} />);
    const root = container.querySelector('.lav-root');
    expect(root.className).toMatch(/lav-side--left/);
  });

  it('sends a question and shows the streamed response', async () => {
    const onSend = vi.fn();
    vi.stubGlobal('fetch', fakeChatFetch('Here is your answer about the topic.'));

    render(<LlmAvatarAssistant config={{ defaultText: '', model: 'm' }} onSend={onSend} />);

    const user = userEvent.setup();
    await user.type(screen.getByTestId('lav-input'), 'what is this?');
    await user.click(screen.getByTestId('lav-send'));

    await waitFor(() => {
      expect(screen.getByTestId('lav-response-text')).toHaveTextContent('Here is your answer about the topic.');
    }, { timeout: 4000 });

    expect(onSend).toHaveBeenCalled();
    const [q] = onSend.mock.calls[0];
    expect(q).toBe('what is this?');
  });

  it('detects a referenced section and scrolls to it (onScrollToSection)', async () => {
    const onScrollToSection = vi.fn();
    // The model's answer references the "Configuration" section by title.
    vi.stubGlobal('fetch', fakeChatFetch('All the options live in the Configuration section.'));

    render(<LlmAvatarAssistant config={{ defaultText: '' }} onScrollToSection={onScrollToSection} />);

    const user = userEvent.setup();
    await user.type(screen.getByTestId('lav-input'), 'where are the props?');
    await user.click(screen.getByTestId('lav-send'));

    await waitFor(() => {
      expect(onScrollToSection).toHaveBeenCalled();
    }, { timeout: 4000 });

    const section = onScrollToSection.mock.calls[0][0];
    expect(section.id).toBe('configuration');
    expect(section.title).toBe('Configuration');

    // The matched title should also be highlighted in the bubble.
    expect(screen.getByTestId('lav-section-link')).toHaveTextContent('Configuration');
  });

  it('shows an error when the model request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    render(<LlmAvatarAssistant config={{ defaultText: '' }} />);

    const user = userEvent.setup();
    await user.type(screen.getByTestId('lav-input'), 'hello');
    await user.click(screen.getByTestId('lav-send'));

    await waitFor(() => {
      expect(screen.getByTestId('lav-error')).toBeTruthy();
    }, { timeout: 4000 });
  });

  it('shows a config error when baseUrl is missing', async () => {
    render(<LlmAvatarAssistant config={{ baseUrl: '' }} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('lav-input'), 'hello');
    await user.click(screen.getByTestId('lav-send'));
    await waitFor(() => {
      expect(screen.getByTestId('lav-error')).toBeTruthy();
    });
  });
});
