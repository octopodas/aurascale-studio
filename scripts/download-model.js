import fs from 'fs';
import path from 'path';

// Node 18+ global fetch follows the HuggingFace 302 redirect to the LFS CDN.
// (The old https.get wrote the redirect body, producing a corrupt/tiny .onnx.)
const dir = './public/models';
fs.mkdirSync(dir, { recursive: true });

// ponytail: confirm this URL resolves to a real .onnx before relying on it; swap for any
// 4x super-resolution ONNX (ESRGAN-arch, fully convolutional) if it 404s.
const modelUrl = 'https://huggingface.co/yuvraj108c/ComfyUI-Upscaler-Onnx/resolve/main/4x-ClearRealityV1.onnx?download=true';
const dest = path.join(dir, 'clearreality.onnx');

console.log('Downloading 4xClearReality.onnx (approx 1.7 MB)...');
const res = await fetch(modelUrl, { redirect: 'follow' });
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
// Guard against a redirect/HTML body silently masquerading as the model.
if (buf.length < 100_000) throw new Error(`Model suspiciously small (${buf.length} bytes) — not the real file`);
fs.writeFileSync(dest, buf);
console.log(`Model saved to ${dest} (${buf.length} bytes).`);
