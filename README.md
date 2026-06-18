# AuraScale Studio

A browser-based AI image studio. Upload a photo, adjust and transform it, upscale it with
on-device neural networks, or generate and edit images by chatting with an AI provider — all
in the browser, with a thin Vite dev-server backend for the gallery and AI proxy.

Built with vanilla JS + [Vite](https://vitejs.dev/), [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/)
for upscaling, and the Google Generative Language API (Nano Banana / Gemini) for the chat.

## Features

### Edit
- **Upload** — drag & drop or browse (JPG, PNG, WebP). Originals auto-save to the gallery.
- **Basic adjustments** — brightness, contrast, saturation sliders (live, GPU-accelerated).
- **Transformations** — rotate 90°, interactive crop with draggable handles.
- **New** — clear the canvas and start over.
- **Export** — download as PNG, or save to the gallery.

### AI Upscaler (on-device)
- Two ONNX super-resolution models: **4× ClearReality** and **2× RealPLKSR**.
- Runs on **WebGPU** when available, automatically falling back to multi-threaded **WASM**.
- Tiled inference for large images, a draggable **before/after** comparison slider, and
  zoom-to-cursor (`Ctrl` +/-/0 or `Ctrl`+scroll). Nothing leaves your machine.

### AI Image Chat
- Chat pane (right) to **generate** an image from a text prompt, or **edit** the currently
  open image with an instruction (e.g. "add a party hat and confetti").
- Ships with **Nano Banana** (Gemini `gemini-3.1-flash-image-preview` / `gemini-2.5-flash-image`).
  Switch provider and model from the pane.
- Each result becomes the new working image, so it **chains** into upscale, crop, filters,
  and save.
- **Pluggable providers** — add one in [`ai-providers.js`](ai-providers.js): a registry entry
  with an adapter `(prompt, imageB64 | null, model) => { dataB64, mimeType }`. API keys stay
  server-side and are never sent to the browser.

### Gallery
- Saved images persist to a local `gallery/` folder (served by the dev server). Click a
  thumbnail to reload it into the workspace; delete with the ✕.

## Installation

Requires **Node 18+** (the model downloader and AI proxy use the global `fetch`).

```bash
git clone https://github.com/octopodas/aurascale-studio.git
cd aurascale-studio

npm install                      # also copies the ONNX Runtime WASM binaries into public/
node scripts/download-model.js   # downloads the two upscaler models (~31 MB) into public/models/
```

### AI chat API key (optional — only for the chat pane)

Get a key from [Google AI Studio](https://aistudio.google.com/apikey), then expose it as an
environment variable before starting the dev server:

```bash
export GEMINI_API_KEY="your-key"   # or NANOBANANA_API_KEY / GOOGLE_API_KEY
```

The server also reads these keys from `~/.gemini/.env` if present (where the Gemini CLI stores
them), and falls through to the next candidate if one is rejected. The chat pane shows
`✓ API key loaded` when a working key is found; without one, Send is disabled and the rest of
the app works normally.

## Run

```bash
npm run dev        # start the dev server, then open the printed http://localhost:<port>
npm test           # run the unit tests (Vitest)
npm run build      # static production build (see note below)
```

## Architecture notes

- **Frontend** (`src/`): `main.js` wires the DOM, `canvas-manager.js` handles drawing /
  filters / rotate / crop, `onnx-manager.js` runs upscaling, `chat.js` drives the AI pane.
- **Backend** lives in `vite.config.js` as Vite dev-server middleware:
  - `/api/upload`, `/api/images`, `/gallery/*` — gallery storage.
  - `/api/ai/providers`, `/api/ai/generate` — the AI proxy (keys stay here).
- The backend is **dev-server only**. `npm run build` / `npm run preview` produce a static
  bundle without the gallery or AI routes — those need `npm run dev`.

## License

Personal project — no license specified.
