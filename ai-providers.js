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
