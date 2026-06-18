import { describe, it, expect, vi } from 'vitest';
import { ONNXManager } from '../src/onnx-manager.js';

describe('ONNX WebGPU/WASM Engine', () => {
  it('should pre-process input channels to float array NCHW correctly', () => {
    const manager = new ONNXManager();
    
    const width = 2;
    const height = 2;
    const rgbArray = new Uint8ClampedArray([
      255, 0, 0, 255,   // Red
      0, 255, 0, 255,   // Green
      0, 0, 255, 255,   // Blue
      255, 255, 255, 255 // White
    ]);

    const floatTensor = manager.preprocess(rgbArray, width, height);
    expect(floatTensor.dims).toEqual([1, 3, height, width]);
    
    // Verify channel separation
    const data = floatTensor.data;
    expect(data[0]).toBeCloseTo(1.0); // Top-left R
    expect(data[4 + 1]).toBeCloseTo(1.0); // Top-right G
    expect(data[8 + 2]).toBeCloseTo(1.0); // Bottom-left B
  });

  it('postprocess should invert preprocess (RGB round-trip)', () => {
    const manager = new ONNXManager();
    const width = 2, height = 2;
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      10, 20, 30, 255,
    ]);
    const tensor = manager.preprocess(rgba, width, height);
    const out = manager.postprocess(tensor, width, height);
    for (let p = 0; p < width * height; p++) {
      expect(out[p * 4]).toBe(rgba[p * 4]);         // R
      expect(out[p * 4 + 1]).toBe(rgba[p * 4 + 1]); // G
      expect(out[p * 4 + 2]).toBe(rgba[p * 4 + 2]); // B
      expect(out[p * 4 + 3]).toBe(255);             // A
    }
  });

  it('getFeatherWeight is a non-zero, monotonic 0..1 ramp across the overlap', () => {
    const manager = new ONNXManager();
    expect(manager.getFeatherWeight(5, 0)).toBe(1.0);    // no overlap -> full weight
    expect(manager.getFeatherWeight(32, 32)).toBe(1.0);  // at/after overlap -> full weight
    expect(manager.getFeatherWeight(99, 32)).toBe(1.0);
    expect(manager.getFeatherWeight(0, 32)).toBeGreaterThan(0);    // floored -> no black 1px edge
    expect(manager.getFeatherWeight(0, 32)).toBeLessThan(0.01);
    expect(manager.getFeatherWeight(24, 32)).toBeGreaterThan(manager.getFeatherWeight(8, 32)); // monotonic
  });
});
