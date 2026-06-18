import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  // ponytail: COOP/COEP headers (needed for multithreaded WASM) are intentionally omitted —
  // they break the CDN Google Fonts and jsDelivr wasm fetches. Add them only if you self-host both.
});
