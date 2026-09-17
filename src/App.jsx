import React, { useState } from 'react';
import LlmAvatarAssistant from './components/LlmAvatarAssistant/LlmAvatarAssistant.jsx';

/**
 * Demo host: a small "portfolio / docs" SPA for the assistant itself.
 * Every <section id> is a target the assistant can scroll to. The titles are
 * deliberately distinctive ("Overview", "Quick Start", …) so the model can be
 * asked to reference one and the auto-scroll is easy to verify in tests.
 *
 * The assistant is configured to talk to the local llama.cpp router through
 * the dev proxy (baseUrl "/v1" -> http://192.168.1.2:8080). Override with
 * VITE_LLM_PROXY_TARGET in .env.local, or point cfg.baseUrl at any
 * OpenAI-compatible URL.
 */

const CONFIG = {
  baseUrl: '/v1',
  apiKey: '', // dev: the Vite proxy injects the real key server-side
  model: (typeof __VITE_LLM_MODEL__ !== 'undefined' ? __VITE_LLM_MODEL__ : 'default'),
  defaultText:
    'I am floating here on the right. Ask me anything about this page — e.g. "what can I do with the assistant?" and I will point you to the right section.',
  modelUrl: 'models/robot.glb',
  side: 'right',
  streaming: true,
  systemPrompt:
    'You are a friendly, concise assistant embedded in the demo page for the ' +
    'LlmAvatarAssistant component. Keep answers to 2–4 sentences. ' +
    'IMPORTANT: when a question matches the topic of one of the on-page ' +
    'sections, explicitly name that section in your answer using its exact ' +
    'title (for example "Overview" or "Quick Start") so the page can scroll to it. ' +
    'Do not invent sections that are not in the list.',
};

const SECTIONS = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <p>
        LlmAvatarAssistant is a drop-in React component that floats a 3D avatar
        on top of any single-page app. It asks a llama.cpp (or any
        OpenAI-compatible) model a question, shows the answer in a comic-style
        speech bubble, spins the avatar while "thinking", and — when the answer
        mentions a section of the page — scrolls the page to that section
        automatically.
      </p>
    ),
  },
  {
    id: 'features',
    title: 'Features',
    body: (
      <ul>
        <li>Transparent background — only the model, input and bubble show.</li>
        <li>Configurable endpoint: URL, API key, model, temperature.</li>
        <li>Swappable 3D model loaded from a file (GLB), auto-fit to size.</li>
        <li>Idle + "thinking" (circular spin) animations.</li>
        <li>Streaming responses with a scrollable speech bubble.</li>
        <li>Automatic section detection &amp; smooth scroll in the host SPA.</li>
      </ul>
    ),
  },
  {
    id: 'quick-start',
    title: 'Quick Start',
    body: (
      <>
        <p>Drop it into any React app:</p>
        <pre>{`import LlmAvatarAssistant from 'LlmAvatarAssistant';

<LlmAvatarAssistant
  config={{
    baseUrl: 'http://192.168.1.2:8080/v1',
    apiKey: 'your-key',
    model: 'your-model-id',
    defaultText: 'Hi! Ask me about this page.',
    modelUrl: '/models/robot.glb',
    side: 'right',
  }}
/>`}</pre>
      </>
    ),
  },
  {
    id: 'configuration',
    title: 'Configuration',
    body: (
      <>
        <p>Every prop can be overridden via <code>config</code>:</p>
        <table>
          <thead>
            <tr><th>Key</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>baseUrl</code></td><td>OpenAI-compatible endpoint (llama.cpp <code>/v1</code>).</td></tr>
            <tr><td><code>apiKey</code></td><td>Bearer token; empty when the server is unsecured.</td></tr>
            <tr><td><code>model</code></td><td>Model id sent in the payload.</td></tr>
            <tr><td><code>defaultText</code></td><td>Text shown before the first question.</td></tr>
            <tr><td><code>modelUrl</code></td><td>Path to the GLB avatar file.</td></tr>
            <tr><td><code>side</code></td><td><code>left</code> or <code>right</code>.</td></tr>
            <tr><td><code>sectionDiscovery</code></td><td><code>auto</code> or an explicit section list.</td></tr>
            <tr><td><code>systemPrompt</code></td><td>Persona + instructions to the model.</td></tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'three-avatar',
    title: 'The 3D Avatar',
    body: (
      <p>
        The avatar is rendered with three.js. On load the model is measured
        (bounding box) and scaled to fit the fixed viewport, so any GLB — big,
        small, offset — looks proportionate. While a query is running the whole
        model orbits a circle; at rest it idles. If the file fails to load, a
        built-in placeholder robot keeps the component functional.
      </p>
    ),
  },
  {
    id: 'auto-scroll',
    title: 'Auto-Scroll Behavior',
    body: (
      <p>
        After each answer the component scans it for the title (or alias) of an
        on-page section. On a match it smoothly scrolls the host page to that
        section and highlights the matched text in the bubble. Sections are
        discovered automatically from <code>&lt;section id&gt;</code> /{' '}
        <code>&lt;h2 id&gt;</code>, or supplied explicitly.
      </p>
    ),
  },
  {
    id: 'testing',
    title: 'Testing',
    body: (
      <p>
        The component ships with unit tests (Vitest) covering the LLM client,
        section scanner and auto-fit math, plus end-to-end tests (Playwright)
        that run the real component against a live llama.cpp router and assert
        that an answer referencing a section scrolls the page.
      </p>
    ),
  },
  {
    id: 'license',
    title: 'License',
    body: (
      <p>
        Released under the MIT License. The bundled 3D model is three.js
        <em>RobotExpressive</em> (public domain / CC0), so the project is fully
        free to use and redistribute.
      </p>
    ),
  },
];

export default function App() {
  const [side, setSide] = useState('right');

  return (
    <div className="demo">
      <header>
        <h1>LlmAvatarAssistant</h1>
        <p className="lead">
          A floating 3D LLM avatar for React — this page doubles as its live
          demo and documentation.
        </p>
        <nav className="nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>{s.title}</a>
          ))}
        </nav>
        <nav className="nav" aria-label="Assistant side">
          <span>Assistant on the:</span>
          <a href="#" onClick={(e) => { e.preventDefault(); setSide('right'); }}>right</a>
          <a href="#" onClick={(e) => { e.preventDefault(); setSide('left'); }}>left</a>
        </nav>
      </header>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.title}</h2>
          {s.body}
        </section>
      ))}

      <LlmAvatarAssistant
        key={side}
        config={{ ...CONFIG, side }}
        onSend={() => { /* demo hook */ }}
      />
    </div>
  );
}
