# AI Image Chat Pane — Design

**Date:** 2026-06-18
**Status:** Approved, ready for implementation plan

## Goal

Add a chat-driven AI image panel to the right side of AuraScale Studio: generate a new
image from a text prompt, or edit the currently-open image with an instruction. Ship with
**Nano Banana** (Gemini `gemini-3.1-flash-image-preview`) and a one-file seam so more
providers can be added later. Users switch the active provider + model from the pane.

## Decisions (locked)

- **Provider management UI:** switch active provider + model only. API keys are read
  server-side from env / `~/.gemini/.env`. No key entry in the browser.
- **Providers in v1:** Nano Banana only + a documented one-file adapter seam.
- **Result handling:** an AI result becomes the new working image (fresh load), so it chains
  into upscale / crop / filters / save. It is NOT dropped into the before/after target canvas
  (that slider stays an upscale-only feature and assumes aligned dimensions).
- **Backend:** Vite dev-server middleware, consistent with the existing gallery API. Not part
  of `dist`/`preview`. No production backend is built.
- **Transport:** plain `fetch` to the Generative Language REST API. No SDK dependency.

## Verified facts (pre-implementation)

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  with header `x-goog-api-key: <key>`.
- Request body: `{ contents: [{ parts: [{ text }, { inlineData: { data, mimeType } }] }] }`
  (omit the `inlineData` part for text-to-image).
- Response image: `candidates[0].content.parts[].inlineData.data` (base64) + `.mimeType`;
  defensive fallback parses a base64-looking `part.text`.
- Working key lives in `~/.gemini/.env` as `NANOBANANA_API_KEY` (returns HTTP 200 + inline
  image; confirmed by one-shot curl). Key resolution order:
  `NANOBANANA_API_KEY` → `GEMINI_API_KEY` → `GOOGLE_API_KEY` from `process.env`, then the same
  keys parsed from `~/.gemini/.env`.
- The current model returns `inlineData` WITHOUT `responseModalities`. Risk: a future model
  may return text-only — mitigation is to add `generationConfig:{responseModalities:['Text','Image']}`.
  Noted inline in the adapter.

## Components

### `ai-providers.js` (new, server-side) — the seam
- `resolveKey(envVars)` — first hit across `process.env` then `~/.gemini/.env`.
- Registry: `{ 'nano-banana': { label, models: [...], envVars: [...], adapter } }`.
- Adapter signature: `async (prompt, imageB64 | null, model) => { dataB64, mimeType }`.
  Throws `Error(message)` on API/key failure (message surfaced to the user).
- Nano Banana adapter: builds the request body, one `fetch`, parses the response per the
  verified shape.
- `listProviders()` — `[{ id, label, models, keyAvailable }]`, never includes keys.

### `vite.config.js` — two routes added to the existing plugin
- `GET /api/ai/providers` → `listProviders()`.
- `POST /api/ai/generate` `{ provider, model, prompt, image? }` → `{ image: dataUrl }` on
  success, or `{ error }` with a 4xx/5xx status. Validates provider/prompt; 400 if the
  provider's key is missing. `image` is an optional `data:` URL of the input image.

### `index.html` — right pane
- `<aside class="chat-pane">`: provider `<select>`, model `<select>`, key-status line,
  scrollable message list, prompt `<textarea>` + Send button.
- `.main-layout` becomes three columns (sidebar | workspace | chat).

### `src/chat.js` (new, client)
- On load: fetch `/api/ai/providers`, populate selects, reflect `keyAvailable` (disable Send
  + show hint when false).
- On Send: read the current working image as PNG base64 (or null if none loaded), POST to
  `/api/ai/generate`, render a user bubble + a "generating…" placeholder, then replace it with
  the result image bubble (or a red error bubble). On success, call the workspace callback to
  load the result as the new working image.

### `src/main.js`
- Instantiate the chat with: a getter for the current image as a data URL, and a
  `loadResult(dataUrl)` callback that runs the existing image-load path.

### `src/style.css`
- Chat pane + bubble styling, consistent with the existing dark theme.

## Data flow

1. User loads an image (existing flow) → working image in `CanvasManager`.
2. User types a prompt → Send.
3. `chat.js` grabs the current working image as base64 (or null) → `POST /api/ai/generate`.
4. Server resolves the adapter, calls Gemini, returns the base64 image.
5. `chat.js` renders the result bubble AND loads it as the new working image (chainable).

## Error handling

- Missing key → `keyAvailable:false`, Send disabled + hint; proxy returns 400 defensively.
- API error (403 / quota / safety-blocked / no image in response) → red error bubble with the
  server message; Send re-enabled.
- Network / timeout → red error bubble; Send re-enabled.
- Empty prompt → no-op.
- Long generation (~10–30s) → "generating…" bubble + spinner, Send disabled meanwhile.

## Testing

- One vitest: `tests/ai-providers.test.js` with mocked `fetch` — asserts the Nano Banana
  adapter builds the correct body (text-only vs text+image) and parses both `inlineData` and
  the text-field fallback, and that a key-less provider reports `keyAvailable:false`.

## Out of scope (YAGNI)

Key-paste UI, second provider, custom-provider CRUD, streaming, batch/variations, chat-history
persistence, production backend.
