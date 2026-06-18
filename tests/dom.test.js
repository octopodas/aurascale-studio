import { beforeEach, describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';

// fs.readFileSync accepts a file URL; resolve relative to this test file
// (no __dirname in ESM, and this is independent of the cwd vitest runs from).
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('AuraScale Studio DOM Structure', () => {
  let document;

  beforeEach(() => {
    const dom = new JSDOM(html);
    document = dom.window.document;
  });

  it('should contain the dropzone and file input elements', () => {
    expect(document.getElementById('dropzone')).not.toBeNull();
    expect(document.getElementById('image-input')).not.toBeNull();
  });

  it('should contain the basic adjustment sliders', () => {
    expect(document.getElementById('brightness-slider')).not.toBeNull();
    expect(document.getElementById('contrast-slider')).not.toBeNull();
    expect(document.getElementById('saturation-slider')).not.toBeNull();
  });

  it('should contain the upscale button and telemetry panel', () => {
    expect(document.getElementById('upscale-btn')).not.toBeNull();
    expect(document.getElementById('telemetry-badge')).not.toBeNull();
  });
});
