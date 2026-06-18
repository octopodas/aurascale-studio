# AI Image Chat Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-pane AI chat that generates a new image from a prompt or edits the open image, shipping with Nano Banana (Gemini) behind a one-file provider seam.

**Architecture:** A server-side module (`ai-providers.js`) holds a provider registry; each provider is an adapter `(prompt, imageB64|null, model) => {dataB64, mimeType}`. Two Vite dev-server middleware routes expose `listProviders()` and `generate()`. A client chat pane (`src/chat.js` + markup/CSS) posts prompts and loads each result as the new working image (chainable into upscale/crop/filters/save).

**Tech Stack:** Vanilla JS, Vite dev-server middleware (Node), `fetch` to the Google Generative Language REST API, Vitest + jsdom.

## Global Constraints

- No new npm dependencies — use native `fetch` (Node 18+ global). Verified working.
- API keys stay server-side; never sent to the browser. Resolution order: `NANOBANANA_API_KEY` → `GEMINI_API_KEY` → `GOOGLE_API_KEY` from `process.env`, then the same keys parsed from `~/.gemini/.env`.
- Backend is Vite dev-server-only (`configureServer`), consistent with the existing gallery API. No production backend.
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key: <key>`, body `{ contents: [{ parts: [{ text }, { inlineData: { data, mimeType } }] }] }` (omit `inlineData` for text-to-image). Image in response at `candidates[0].content.parts[].inlineData.data` + `.mimeType`; fallback to a base64-looking `part.text`.
- Default model `gemini-3.1-flash-image-preview`; do NOT set `responseModalities` (verified unnecessary).
- Match existing code style: ES modules, 2-space indent, `// ponytail:` comments for deliberate simplifications.

---

### Task 1: Server provider seam (`ai-providers.js`)

**Files:**
- Create: `ai-providers.js`
- Test: `tests/ai-providers.test.js`

**Interfaces:**
- Produces:
  - `listProviders() => Array<{id:string, label:string, models:string[], keyAvailable:boolean}>`
  - `generate({provider:string, model:string, prompt:string, image?:string}) => Promise<{image:string}>` where `image` is a `data:` URL. Throws `Error(message)` on bad input / missing key / API error / no image.
  - `PROVIDERS` registry object (exported for tests / future adapters).

- [ ] **Step 1: Write the failing test**

Create `tests/ai-providers.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listProviders, generate } from '../ai-providers.js';

const FAKE_PNG = 'iVBORw0KGgo' + 'A'.repeat(1200); // long, base64-shaped

beforeEach(() => { process.env.NANOBANANA_API_KEY = 'test-key'; });
afterEach(() => { vi.restoreAllMocks(); delete process.env.NANOBANANA_API_KEY; });

function mockFetch(jsonBody, ok = true, status = 200) {
  const calls = [];
  global.fetch = vi.fn(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok, status, json: async () => jsonBody };
  });
  return calls;
}
const okImage = { candidates: [{ content: { parts: [{ inlineData: { data: FAKE_PNG, mimeType: 'image/png' } }] } }] };

describe('nano-banana adapter', () => {
  it('text-to-image: sends text-only part, returns a data URL', async () => {
    const calls = mockFetch(okImage);
    const out = await generate({ provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview', prompt: 'a cat' });
    expect(calls[0].url).toContain('gemini-3.1-flash-image-preview:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('test-key');
    expect(calls[0].body.contents[0].parts).toEqual([{ text: 'a cat' }]);
    expect(out.image).toBe(`data:image/png;base64,${FAKE_PNG}`);
  });

  it('edit: appends an inlineData part with the stripped base64', async () => {
    const calls = mockFetch(okImage);
    await generate({ provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview', prompt: 'add a hat', image: 'data:image/png;base64,INPUT123' });
    expect(calls[0].body.contents[0].parts[1].inlineData.data).toBe('INPUT123');
  });

  it('parses base64 from a text-field fallback', async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: FAKE_PNG }] } }] });
    const out = await generate({ provider: 'nano-banana', model: 'm', prompt: 'x' });
    expect(out.image).toBe(`data:image/png;base64,${FAKE_PNG}`);
  });

  it('throws the API error message on non-ok response', async () => {
    mockFetch({ error: { message: 'quota exceeded' } }, false, 429);
    await expect(generate({ provider: 'nano-banana', model: 'm', prompt: 'x' })).rejects.toThrow('quota exceeded');
  });

  it('throws when the response has no image', async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: 'I cannot do that' }] } }] });
    await expect(generate({ provider: 'nano-banana', model: 'm', prompt: 'x' })).rejects.toThrow(/No image/);
  });

  it('rejects an empty prompt before calling fetch', async () => {
    const calls = mockFetch(okImage);
    await expect(generate({ provider: 'nano-banana', model: 'm', prompt: '  ' })).rejects.toThrow(/Prompt/);
    expect(calls.length).toBe(0);
  });
});

describe('listProviders', () => {
  it('lists nano-banana with keyAvailable true when an env key is set', () => {
    const list = listProviders();
    const nb = list.find(p => p.id === 'nano-banana');
    expect(nb).toBeTruthy();
    expect(nb.models[0]).toBe('gemini-3.1-flash-image-preview');
    expect(nb.keyAvailable).toBe(true);
  });
});
```

> Note: the `keyAvailable:false` branch is not unit-tested because `resolveKey` also reads `~/.gemini/.env`, which is machine-dependent. The branch is a trivial `!!resolveKey(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-providers.test.js`
Expected: FAIL — cannot resolve `../ai-providers.js`.

- [ ] **Step 3: Write minimal implementation**

Create `ai-providers.js`:

```js
// ai-providers.js — server-side AI image provider seam.
// Add a provider: add an entry to PROVIDERS with an adapter
// (prompt, imageB64|null, model) => Promise<{dataB64, mimeType}> and set its env key.
import fs from 'fs';
import os from 'os';
import path from 'path';

// Resolve an API key: process.env first, then ~/.gemini/.env (where the nano-banana CLI stores it).
function resolveKey(envVars) {
  for (const v of envVars) {
    if (process.env[v]) return process.env[v];
  }
  try {
    const envFile = fs.readFileSync(path.join(os.homedir(), '.gemini', '.env'), 'utf8');
    for (const v of envVars) {
      const m = envFile.match(new RegExp(`^\\s*${v}\\s*=\\s*"?([^"\\n]+)"?`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* no ~/.gemini/.env — fine */ }
  return null;
}

async function nanoBananaAdapter(prompt, imageB64, model) {
  const key = resolveKey(PROVIDERS['nano-banana'].envVars);
  if (!key) throw new Error('No API key found (set NANOBANANA_API_KEY or GEMINI_API_KEY).');

  const parts = [{ text: prompt }];
  if (imageB64) parts.push({ inlineData: { data: imageB64, mimeType: 'image/png' } });

  // ponytail: responseModalities omitted — verified gemini-3.1-flash-image-preview returns inlineData
  // without it. If a future model returns text-only, add generationConfig:{responseModalities:['Text','Image']}.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `API error ${res.status}`);

  const respParts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of respParts) {
    if (p.inlineData?.data) return { dataB64: p.inlineData.data, mimeType: p.inlineData.mimeType || 'image/png' };
  }
  // Fallback: some responses return base64 in a text part.
  for (const p of respParts) {
    const t = (p.text || '').trim();
    if (t.length > 1000 && /^[A-Za-z0-9+/]+={0,2}$/.test(t)) return { dataB64: t, mimeType: 'image/png' };
  }
  throw new Error('No image in response (the model may have refused the prompt).');
}

export const PROVIDERS = {
  'nano-banana': {
    label: 'Nano Banana (Gemini)',
    models: ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'],
    envVars: ['NANOBANANA_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    adapter: nanoBananaAdapter,
  },
};

export function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, label: p.label, models: p.models, keyAvailable: !!resolveKey(p.envVars),
  }));
}

export async function generate({ provider, model, prompt, image }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  if (!prompt || !prompt.trim()) throw new Error('Prompt is required.');
  const useModel = p.models.includes(model) ? model : p.models[0];
  const imageB64 = image ? image.replace(/^data:image\/\w+;base64,/, '') : null;
  const { dataB64, mimeType } = await p.adapter(prompt.trim(), imageB64, useModel);
  return { image: `data:${mimeType};base64,${dataB64}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-providers.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-providers.js tests/ai-providers.test.js
git commit -m "feat: server-side AI image provider seam with nano banana adapter"
```

---

### Task 2: Wire API routes into the Vite dev server

**Files:**
- Modify: `vite.config.js` (add import at top; add two `server.middlewares.use(...)` blocks inside `configureServer`, after the existing `/gallery` middleware at line ~108).

**Interfaces:**
- Consumes: `listProviders`, `generate` from `./ai-providers.js`.
- Produces: `GET /api/ai/providers` → JSON array; `POST /api/ai/generate` `{provider,model,prompt,image?}` → `{image}` (200) or `{error}` (400).

- [ ] **Step 1: Add the import**

At the top of `vite.config.js`, after the existing imports:

```js
import { listProviders, generate } from './ai-providers.js';
```

- [ ] **Step 2: Add the two routes**

Inside `configureServer(server)`, immediately before the closing `}` of the function (after the `/gallery` middleware block):

```js
      server.middlewares.use('/api/ai/providers', (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(listProviders()));
      });

      server.middlewares.use('/api/ai/generate', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const result = await generate(JSON.parse(body));
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
```

- [ ] **Step 3: Verify manually against the running dev server**

Run (in one shell): `npm run dev`
Then (in another):

```bash
curl -s localhost:5173/api/ai/providers
# Expected: [{"id":"nano-banana","label":"Nano Banana (Gemini)","models":["gemini-3.1-flash-image-preview","gemini-2.5-flash-image"],"keyAvailable":true}]

curl -s -X POST localhost:5173/api/ai/generate -H 'Content-Type: application/json' \
  -d '{"provider":"nano-banana","model":"gemini-3.1-flash-image-preview","prompt":"a tiny red circle icon on white"}' | head -c 60
# Expected: {"image":"data:image/png;base64,iVBOR...
```

(If the dev port differs, use the port Vite prints.)

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "feat: dev-server routes for AI providers and image generation"
```

---

### Task 3: Chat pane markup and styles

**Files:**
- Modify: `index.html` (add `<aside class="chat-pane">` as the third child of `.main-layout`, after `</main>` at line 97).
- Modify: `src/style.css` (append chat-pane styles).

**Interfaces:**
- Produces DOM ids consumed by Task 4: `chat-provider`, `chat-model`, `chat-key-status`, `chat-messages`, `chat-input`, `chat-send`.

- [ ] **Step 1: Add the chat pane markup**

In `index.html`, insert immediately after the closing `</main>` (line 97) and before the closing `</div>` of `.main-layout`:

```html
      <aside class="chat-pane">
        <div class="chat-controls">
          <h3>AI Image Chat</h3>
          <div class="select-group">
            <label for="chat-provider">Provider</label>
            <select id="chat-provider"></select>
          </div>
          <div class="select-group">
            <label for="chat-model">Model</label>
            <select id="chat-model"></select>
          </div>
          <div id="chat-key-status" class="chat-key-status"></div>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <div class="chat-input-row">
          <textarea id="chat-input" class="chat-input" rows="2"
            placeholder="Describe an image to create, or how to edit the open one…"></textarea>
          <button id="chat-send" class="primary-btn">Send</button>
        </div>
      </aside>
```

- [ ] **Step 2: Append the styles**

Append to `src/style.css`:

```css
/* AI Chat Pane */
.chat-pane {
  width: 340px;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-controls {
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-controls h3 {
  font-size: 0.9rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 1px; font-weight: 600;
}
.chat-key-status { font-size: 0.75rem; color: var(--text-muted); }
.chat-key-status.missing { color: #f59e0b; }
.chat-messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.chat-msg { max-width: 100%; padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; line-height: 1.4; }
.chat-msg.user { align-self: flex-end; background: var(--primary); color: white; }
.chat-msg.ai { align-self: flex-start; background: var(--bg-card); }
.chat-msg.error { align-self: flex-start; background: rgba(239,68,68,0.15); color: #fca5a5; }
.chat-msg img { max-width: 100%; border-radius: 6px; display: block; }
.chat-msg.pending { color: var(--text-muted); font-style: italic; }
.chat-input-row {
  padding: 16px; border-top: 1px solid var(--border-color);
  display: flex; gap: 8px; align-items: flex-end;
}
.chat-input {
  flex: 1; resize: none; background: var(--bg-card); color: inherit;
  border: 1px solid var(--border-color); border-radius: 8px; padding: 8px; font: inherit;
}
.chat-input:focus { outline: none; border-color: var(--primary); }
.chat-input-row .primary-btn { padding: 8px 16px; }
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`, open the app. Expected: a third pane on the right with "AI Image Chat", two (empty) selects, an input box, and a Send button. Layout stays three columns without horizontal scroll.

- [ ] **Step 4: Commit**

```bash
git add index.html src/style.css
git commit -m "feat: AI chat pane markup and styles"
```

---

### Task 4: Chat client logic and workspace wiring

**Files:**
- Create: `src/chat.js`
- Modify: `src/main.js` (import and initialize the chat after `canvasManager`/`handleFile` exist).

**Interfaces:**
- Consumes: DOM ids from Task 3; the endpoints from Task 2.
- `initChat({ getCurrentImage, loadResult })` where:
  - `getCurrentImage() => string|null` — current working image as a PNG `data:` URL, or null if none loaded.
  - `loadResult(dataUrl:string) => void` — load a result image as the new working image.

- [ ] **Step 1: Create the chat client**

Create `src/chat.js`:

```js
// AI image chat pane. Talks to /api/ai/* and hands results back to the workspace.
export function initChat({ getCurrentImage, loadResult }) {
  const providerSel = document.getElementById('chat-provider');
  const modelSel = document.getElementById('chat-model');
  const keyStatus = document.getElementById('chat-key-status');
  const messages = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  let providers = [];

  function addMsg(cls, content) {
    const div = document.createElement('div');
    div.className = `chat-msg ${cls}`;
    if (content instanceof Node) div.appendChild(content);
    else div.textContent = content;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function refreshModels() {
    const p = providers.find(p => p.id === providerSel.value);
    modelSel.innerHTML = '';
    (p?.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      modelSel.appendChild(opt);
    });
    const ok = !!p?.keyAvailable;
    keyStatus.textContent = ok ? '✓ API key loaded' : '⚠ No API key — set NANOBANANA_API_KEY';
    keyStatus.classList.toggle('missing', !ok);
    sendBtn.disabled = !ok;
  }

  async function send() {
    const prompt = input.value.trim();
    if (!prompt || sendBtn.disabled) return;
    input.value = '';
    addMsg('user', prompt);
    const pending = addMsg('ai pending', 'Generating…');
    sendBtn.disabled = true;

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerSel.value,
          model: modelSel.value,
          prompt,
          image: getCurrentImage() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      pending.remove();
      const img = document.createElement('img');
      img.src = data.image;
      addMsg('ai', img);
      loadResult(data.image);
    } catch (e) {
      pending.remove();
      addMsg('error', e.message);
    } finally {
      sendBtn.disabled = false;
      refreshModels(); // re-apply key-based disabled state
    }
  }

  providerSel.addEventListener('change', refreshModels);
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  fetch('/api/ai/providers')
    .then(r => r.json())
    .then(list => {
      providers = list;
      providerSel.innerHTML = '';
      list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.label;
        providerSel.appendChild(opt);
      });
      refreshModels();
    })
    .catch(() => {
      keyStatus.textContent = 'AI providers unavailable (dev server only)';
      sendBtn.disabled = true;
    });
}
```

- [ ] **Step 2: Wire it into `main.js`**

At the top of `src/main.js`, add to the imports:

```js
import { initChat } from './chat.js';
```

Then, inside the `DOMContentLoaded` handler, after the `handleFile` function is defined (after line ~167) and `targetCanvas`/`canvasManager` exist, add:

```js
  // AI image chat: send the current working image, load each result as the new working image.
  initChat({
    getCurrentImage: () => canvasManager.rawImage ? targetCanvas.toDataURL('image/png') : null,
    loadResult: (dataUrl) => {
      fetch(dataUrl).then(r => r.blob()).then(blob => {
        const f = new File([blob], `ai-${Date.now()}.png`, { type: 'image/png' });
        handleFile(f, true); // fromGallery=true → don't re-upload as an original
      });
    },
  });
```

- [ ] **Step 3: Verify end-to-end**

Run: `npm run dev`, open the app.
1. With no image loaded: type "a watercolor fox", Send → after ~10–30s an image bubble appears AND the workspace shows it as the working image.
2. With that image loaded: type "make the background dark blue", Send → edited result appears and becomes the new working image.
3. Confirm the result can then be upscaled / cropped / saved via the existing left-pane controls.
4. Error path: stop the dev server mid-request or use a refused prompt → a red error bubble appears and Send re-enables.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests plus the 7 new `ai-providers` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat.js src/main.js
git commit -m "feat: AI chat client wired to workspace (generate + edit, chainable results)"
```

---

## Self-Review

- **Spec coverage:** provider seam (Task 1) ✓; switch provider+model, keyAvailable, server-side keys (Tasks 1–2, 4) ✓; generate + edit (Task 1) ✓; result becomes working image / chainable (Task 4) ✓; dev-server-only routes (Task 2) ✓; error handling — missing key, API error, network, empty prompt, pending state (Tasks 1 & 4) ✓; one vitest on the adapter (Task 1) ✓; no new deps / no `responseModalities` (Task 1) ✓.
- **Type consistency:** `listProviders`/`generate`/`PROVIDERS` names match across Tasks 1–2 and the client; `initChat({getCurrentImage, loadResult})` matches Task 4's call site; DOM ids match between Tasks 3 and 4.
- **Out of scope (untasked, intentionally):** key-paste UI, second provider, custom CRUD, streaming, batch, chat persistence, production backend.
```
