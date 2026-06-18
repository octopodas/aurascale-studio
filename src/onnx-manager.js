import * as ort from 'onnxruntime-web';

// WASM binaries served from the jsDelivr CDN (must match the pinned package version).
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
// Multithreaded WASM only works under cross-origin isolation (COOP/COEP). Stay
// single-threaded otherwise so the fallback path doesn't silently fail to start.
// ponytail: raise to navigator.hardwareConcurrency by self-hosting fonts+wasm and setting COOP/COEP headers.
ort.env.wasm.numThreads = (typeof self !== 'undefined' && self.crossOriginIsolated && typeof navigator !== 'undefined')
  ? (navigator.hardwareConcurrency || 1)
  : 1;

export class ONNXManager {
  constructor(modelUrl = '/models/clearreality.onnx') {
    this.modelUrl = modelUrl;
    this.session = null;
    this.activeEP = 'none';
  }

  async init() {
    // Pick the EP explicitly: try WebGPU, fall back to WASM only if creation throws.
    // (ORT Web has no reliable public API to read back which EP was chosen, so don't
    // inspect session internals — that's what previously discarded the WebGPU path.)
    try {
      this.session = await ort.InferenceSession.create(this.modelUrl, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      });
      this.activeEP = 'WebGPU (Accelerated)';
    } catch (err) {
      console.warn('WebGPU unavailable, falling back to WASM:', err);
      this.session = await ort.InferenceSession.create(this.modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      this.activeEP = 'WASM (CPU)';
    }
    return this.activeEP;
  }

  preprocess(rgbaData, width, height) {
    const floatBuffer = new Float32Array(3 * width * height);
    const channelSize = width * height;

    for (let i = 0; i < channelSize; i++) {
      floatBuffer[i] = rgbaData[i * 4] / 255.0;                   // R
      floatBuffer[channelSize + i] = rgbaData[i * 4 + 1] / 255.0; // G
      floatBuffer[2 * channelSize + i] = rgbaData[i * 4 + 2] / 255.0; // B
    }

    return new ort.Tensor('float32', floatBuffer, [1, 3, height, width]);
  }

  postprocess(tensor, width, height) {
    const data = tensor.data;
    const rgbaData = new Uint8ClampedArray(width * height * 4);
    const channelSize = width * height;

    for (let i = 0; i < channelSize; i++) {
      // Clamp output pixel values to [0, 255]
      const r = Math.min(255, Math.max(0, Math.round(data[i] * 255.0)));
      const g = Math.min(255, Math.max(0, Math.round(data[channelSize + i] * 255.0)));
      const b = Math.min(255, Math.max(0, Math.round(data[2 * channelSize + i] * 255.0)));

      rgbaData[i * 4] = r;
      rgbaData[i * 4 + 1] = g;
      rgbaData[i * 4 + 2] = b;
      rgbaData[i * 4 + 3] = 255; // Alpha
    }

    return rgbaData;
  }

  calculateTiles(width, height, tileSize = 256, overlap = 32) {
    const tiles = [];
    let id = 0;

    const xOffsets = [];
    let x = 0;
    while (x < width) {
      if (x + tileSize >= width) {
        xOffsets.push(Math.max(0, width - tileSize));
        break;
      }
      xOffsets.push(x);
      x += (tileSize - overlap);
    }

    const yOffsets = [];
    let y = 0;
    while (y < height) {
      if (y + tileSize >= height) {
        yOffsets.push(Math.max(0, height - tileSize));
        break;
      }
      yOffsets.push(y);
      y += (tileSize - overlap);
    }

    for (let yi = 0; yi < yOffsets.length; yi++) {
      for (let xi = 0; xi < xOffsets.length; xi++) {
        const sx = xOffsets[xi];
        const sy = yOffsets[yi];
        
        tiles.push({
          id: id++,
          sx: sx,
          sy: sy,
          sw: Math.min(tileSize, width - sx),
          sh: Math.min(tileSize, height - sy),
          dx: sx,
          dy: sy,
          dw: Math.min(tileSize, width - sx),
          dh: Math.min(tileSize, height - sy)
        });
      }
    }

    return tiles;
  }

  // Edge-feathering weight function (Cosine Window).
  // Floored at a small epsilon so single-coverage edge pixels (distance 0) normalize
  // back to their true value instead of computing 0/1 -> a black 1px image border.
  getFeatherWeight(distance, overlap) {
    if (overlap === 0) return 1.0;
    if (distance >= overlap) return 1.0;
    return Math.max(1e-4, 0.5 - 0.5 * Math.cos((Math.PI * distance) / overlap));
  }

  blendOverlap(targetData, tileData, x, y, width, height, scale, overlap = 32) {
    const targetWidth = targetData.width;
    const targetHeight = targetData.height;
    const { outputAccumulator, weightAccumulator } = targetData;

    const upscaledTileWidth = width * scale;
    const upscaledTileHeight = height * scale;
    const tileOverlap = overlap * scale;

    for (let ty = 0; ty < upscaledTileHeight; ty++) {
      for (let tx = 0; tx < upscaledTileWidth; tx++) {
        const outX = x * scale + tx;
        const outY = y * scale + ty;
        
        // Guard against out of bounds
        if (outX >= targetWidth || outY >= targetHeight) continue;

        const pixel = outY * targetWidth + outX;
        const accIdx = pixel * 3;

        // Distance to closest tile edge -> cosine feather weight
        const minDist = Math.min(tx, upscaledTileWidth - 1 - tx, ty, upscaledTileHeight - 1 - ty);
        const w = this.getFeatherWeight(minDist, tileOverlap);

        const tilePixelIdx = (ty * upscaledTileWidth + tx) * 4;
        outputAccumulator[accIdx] += tileData[tilePixelIdx] * w;
        outputAccumulator[accIdx + 1] += tileData[tilePixelIdx + 1] * w;
        outputAccumulator[accIdx + 2] += tileData[tilePixelIdx + 2] * w;
        weightAccumulator[pixel] += w;
      }
    }
  }

  async upscaleImage(imageData, onProgressCallback = () => {}) {
    if (!this.session) await this.init();

    const scale = 4; // ClearReality is a 4x upscale model
    const { width, height } = imageData;
    const targetWidth = width * scale;
    const targetHeight = height * scale;

    // ponytail: the feather blend accumulates the whole output in RAM (~targetW*targetH*17 bytes:
    // 3 float channels + 1 float weight + the uint8 RGBA result). At 4x that's ~1GB for a 2000x2000
    // source. Guard with a hard ceiling and fail loudly instead of OOM-crashing the tab.
    // Upgrade path: stream the blend a row-of-tiles at a time so memory is O(tile), not O(output).
    const MAX_OUTPUT_PIXELS = 4096 * 4096;
    if (targetWidth * targetHeight > MAX_OUTPUT_PIXELS) {
      throw new Error(`Image too large to upscale 4x in-browser (${targetWidth}x${targetHeight}). Crop or downscale first.`);
    }

    const outputBuffer = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const outputAccumulator = new Float32Array(targetWidth * targetHeight * 3); // RGB only; alpha is always 255
    const weightAccumulator = new Float32Array(targetWidth * targetHeight);

    const targetData = {
      width: targetWidth,
      height: targetHeight,
      outputAccumulator,
      weightAccumulator
    };

    const tileSize = 256;
    const overlap = 32;
    const tiles = this.calculateTiles(width, height, tileSize, overlap);

    // Create a temporary canvas of the input image size once to extract tile image segments
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      onProgressCallback(i / tiles.length, `Processing Tile ${i + 1}/${tiles.length}`);

      // Extract input tile pixels
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tile.sw;
      tileCanvas.height = tile.sh;
      const tileCtx = tileCanvas.getContext('2d');

      // Render image segment from tempCanvas onto tile canvas
      tileCtx.drawImage(tempCanvas, tile.sx, tile.sy, tile.sw, tile.sh, 0, 0, tile.sw, tile.sh);

      const inputData = tileCtx.getImageData(0, 0, tile.sw, tile.sh).data;
      const inputTensor = this.preprocess(inputData, tile.sw, tile.sh);

      // Run model inference (input/output names come from the model, not hardcoded)
      const feeds = { [this.session.inputNames[0]]: inputTensor };
      const outputMap = await this.session.run(feeds);
      const outputTensor = outputMap[this.session.outputNames[0]];

      // Convert back to pixels
      const upscaledTileWidth = tile.sw * scale;
      const upscaledTileHeight = tile.sh * scale;
      const upscaledPixels = this.postprocess(outputTensor, upscaledTileWidth, upscaledTileHeight);

      // Blend tile pixels into target canvas accumulators
      this.blendOverlap(targetData, upscaledPixels, tile.dx, tile.dy, tile.sw, tile.sh, scale, overlap);
    }

    // Final normalization of pixels based on accumulated feather weights.
    // Uint8ClampedArray rounds + clamps to [0,255] on assignment, so no manual clamp needed.
    for (let i = 0; i < targetWidth * targetHeight; i++) {
      const w = weightAccumulator[i] || 1.0;
      outputBuffer[i * 4] = outputAccumulator[i * 3] / w;
      outputBuffer[i * 4 + 1] = outputAccumulator[i * 3 + 1] / w;
      outputBuffer[i * 4 + 2] = outputAccumulator[i * 3 + 2] / w;
      outputBuffer[i * 4 + 3] = 255;
    }

    onProgressCallback(1.0, 'Done');
    return new ImageData(outputBuffer, targetWidth, targetHeight);
  }
}
