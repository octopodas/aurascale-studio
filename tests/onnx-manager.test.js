import { describe, it, expect } from 'vitest';
import { ONNXManager } from '../src/onnx-manager.js';

describe('ONNXManager Tiling Calculation', () => {
  it('should split simple dimensions correctly without overlap', () => {
    const manager = new ONNXManager();
    const tiles = manager.calculateTiles(300, 300, 256, 0);
    
    // Expected: 4 tiles to cover 300x300 image using 256 tile size
    expect(tiles.length).toBe(4);
    expect(tiles[0]).toEqual({ id: 0, sx: 0, sy: 0, sw: 256, sh: 256, dx: 0, dy: 0, dw: 256, dh: 256 });
    expect(tiles[3]).toEqual({ id: 3, sx: 44, sy: 44, sw: 256, sh: 256, dx: 44, dy: 44, dw: 256, dh: 256 });
  });

  it('should handle overlap correctly', () => {
    const manager = new ONNXManager();
    // width=300, height=300, tileSize=256, overlap=32
    // For x:
    // Offset 0: 0
    // x += (256 - 32) -> 224
    // 224 + 256 = 480 >= 300 -> Offset 1: Math.max(0, 300 - 256) = 44
    // So xOffsets: [0, 44]
    const tiles = manager.calculateTiles(300, 300, 256, 32);
    expect(tiles.length).toBe(4);
    expect(tiles[0].sx).toBe(0);
    expect(tiles[1].sx).toBe(44);
    expect(tiles[2].sx).toBe(0);
    expect(tiles[3].sx).toBe(44);
  });
});

describe('ONNXManager Feather Weight Calculation', () => {
  it('should calculate weights correctly', () => {
    const manager = new ONNXManager();
    expect(manager.getFeatherWeight(5, 0)).toBe(1.0);    // no overlap -> full weight
    expect(manager.getFeatherWeight(32, 32)).toBe(1.0);  // at/after overlap -> full weight
    expect(manager.getFeatherWeight(99, 32)).toBe(1.0);
    expect(manager.getFeatherWeight(0, 32)).toBeGreaterThan(0);    // floored -> no black 1px edge
    expect(manager.getFeatherWeight(0, 32)).toBeLessThan(0.01);
    expect(manager.getFeatherWeight(24, 32)).toBeGreaterThan(manager.getFeatherWeight(8, 32)); // monotonic
  });
});

describe('ONNXManager blendOverlap Calculation', () => {
  it('should blend a tile correctly with overlap weighting', () => {
    const manager = new ONNXManager();
    const scale = 2;
    const tileWidth = 2;
    const tileHeight = 2;
    const overlap = 1; // scaled overlap = 2
    
    // Target is 4x4 upscaled image
    // Accumulators for a 4x4 image
    const targetData = {
      width: 4,
      height: 4,
      outputAccumulator: new Float32Array(4 * 4 * 3), // 16 pixels * 3 channels
      weightAccumulator: new Float32Array(4 * 4) // 16 pixels
    };

    // A 2x2 (unscaled) tile at x=1, y=1
    // Upscaled tile size is 4x4
    const tileData = new Uint8ClampedArray(4 * 4 * 4); // RGBA
    tileData.fill(255); // Red=255, Green=255, Blue=255, Alpha=255

    // Call blendOverlap
    manager.blendOverlap(targetData, tileData, 1, 1, tileWidth, tileHeight, scale, overlap);

    // Destination top-left coordinates: x = 1 * 2 = 2, y = 1 * 2 = 2
    // Since width=2, height=2, scale=2, target tile starts at (2,2) and ends at (3,3)
    // Pixel (2,2) inside the target:
    // tx = 0, ty = 0 (top-left of tile)
    // minDist = Math.min(0, 3, 0, 3) = 0
    // Weight at 0 distance: getFeatherWeight(0, 2)
    const w0 = manager.getFeatherWeight(0, 2);
    const pixelIndex = 2 * 4 + 2; // y=2, x=2 -> 10 in 1D array of 4x4 pixels
    expect(targetData.weightAccumulator[pixelIndex]).toBeCloseTo(w0);
    expect(targetData.outputAccumulator[pixelIndex * 3]).toBeCloseTo(255 * w0);
    expect(targetData.outputAccumulator[pixelIndex * 3 + 1]).toBeCloseTo(255 * w0);
    expect(targetData.outputAccumulator[pixelIndex * 3 + 2]).toBeCloseTo(255 * w0);
  });
});
