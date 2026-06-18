import fs from 'fs';
import path from 'path';

// Node 18+ global fetch follows the HuggingFace 302 redirect to the LFS CDN.
// (The old https.get wrote the redirect body, producing a corrupt/tiny .onnx.)
const dir = './public/models';
fs.mkdirSync(dir, { recursive: true });

// ponytail: confirm this URL resolves to a real .onnx before relying on it; swap for any
// 4x super-resolution ONNX (ESRGAN-arch, fully convolutional) if it 404s.
const models = [
  { url: 'https://huggingface.co/yuvraj108c/ComfyUI-Upscaler-Onnx/resolve/main/4x-ClearRealityV1.onnx?download=true', dest: 'clearreality.onnx', name: '4xClearReality.onnx' },
  // 2x: RealPLKSR (darktable's efficient SR arch) — ~28MB / 653 conv vs the old 2x-ESRGAN's
  // ~69MB / 1405 conv, so it's roughly twice as fast for browser inference. Same NCHW float[0,1] I/O.
  { url: 'https://huggingface.co/darktable-org/upscale-realplksr-onnx/resolve/main/onnx/model_x2.onnx?download=true', dest: 'realplksr-2x.onnx', name: 'RealPLKSR-2x.onnx' }
];

for (const model of models) {
  const destPath = path.join(dir, model.dest);
  console.log(`Downloading ${model.name}...`);
  const res = await fetch(model.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100_000) throw new Error(`Model suspiciously small (${buf.length} bytes) — not the real file`);
  fs.writeFileSync(destPath, buf);
  console.log(`Model saved to ${destPath} (${buf.length} bytes).`);
}
