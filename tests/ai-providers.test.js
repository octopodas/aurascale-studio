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
