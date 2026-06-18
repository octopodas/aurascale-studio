import * as ort from 'onnxruntime-web';

// In the production build, ORT's loader .mjs/.wasm are emitted to the site root from public/
// (see postinstall), so point ORT there. In Vite dev, leave wasmPaths unset: ORT then resolves
// the loader relative to its node_modules module URL, which the dev server can import — whereas
// files under /public can't be module-imported in dev ("should not be imported from source code").
if (import.meta.env.PROD) {
  ort.env.wasm.wasmPaths = '/';
}
// Multithreaded WASM only works under cross-origin isolation (COOP/COEP). Stay
// single-threaded otherwise so the fallback path doesn't silently fail to start.
// ponytail: raise to navigator.hardwareConcurrency by self-hosting fonts+wasm and setting COOP/COEP headers.
ort.env.wasm.numThreads = (typeof self !== 'undefined' && self.crossOriginIsolated && typeof navigator !== 'undefined')
  ? (navigator.hardwareConcurrency || 1)
  : 1;

export class ONNXManager {
  constructor() {
    this.session = null;
    this.activeEP = 'none';
    this.currentScale = null;
  }

  async init(scale = 4) {
    if (this.session && this.currentScale === scale) {
      return this.activeEP;
    }

    if (this.session) {
      try {
        await this.session.release();
      } catch (e) {
        // Ignored, fallback if release isn't fully supported
      }
      this.session = null;
    }

    this.currentScale = scale;
    const modelUrl = scale === 2 ? '/models/realplksr-2x.onnx' : '/models/clearreality.onnx';

    // Pick the EP explicitly: try WebGPU, fall back to WASM only if creation throws.
    try {
      // ORT requests a "core" adapter, which returns null on systems whose only WebGPU
      // adapter is compatibility-mode (e.g. ANGLE/GL backend when Vulkan is off) — dropping
      // them to WASM. Acquire an adapter ourselves: core first (full speed), then compat,
      // and hand it to ORT via env.webgpu.adapter. If both are null we leave it unset and let
      // ORT's own path throw into the WASM fallback below.
      if (!ort.env.webgpu.adapter && typeof navigator !== 'undefined' && navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter()
          || await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
        if (adapter) ort.env.webgpu.adapter = adapter;
      }
      this.session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      });
      this.activeEP = 'WebGPU (Accelerated)';
    } catch (err) {
      console.warn('WebGPU unavailable, falling back to WASM:', err);
      this.session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      this.activeEP = 'WASM (CPU)';
    }
    return this.activeEP;
  }

  // Rebuild the session on WASM. Used when a WebGPU session loads fine but a kernel fails at
  // run time (e.g. DepthToSpace can't allocate output on a compat-mode GPU), so the upscale can
  // retry on CPU instead of hard-failing. Also flips activeEP so the badge reports the truth.
  async fallbackToWasm(scale) {
    if (this.session) {
      try { await this.session.release(); } catch (e) { /* ignored */ }
      this.session = null;
    }
    const modelUrl = scale === 2 ? '/models/realplksr-2x.onnx' : '/models/clearreality.onnx';
    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    this.activeEP = 'WASM (CPU)';
    this.currentScale = scale;
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

  // Convert an NCHW float tensor back to packed RGBA. The tensor is srcWidth x srcHeight, but for
  // fixed-input models we pad the tile up to that size and only want the top-left cropWidth x
  // cropHeight back (the rest is padding the model hallucinated and we discard).
  postprocess(tensor, srcWidth, srcHeight, cropWidth = srcWidth, cropHeight = srcHeight) {
    const data = tensor.data;
    const rgbaData = new Uint8ClampedArray(cropWidth * cropHeight * 4);
    const channelSize = srcWidth * srcHeight;

    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        const si = y * srcWidth + x;   // index within a source channel plane
        const di = y * cropWidth + x;  // index within the packed output

        // Clamp output pixel values to [0, 255]
        rgbaData[di * 4] = Math.min(255, Math.max(0, Math.round(data[si] * 255.0)));
        rgbaData[di * 4 + 1] = Math.min(255, Math.max(0, Math.round(data[channelSize + si] * 255.0)));
        rgbaData[di * 4 + 2] = Math.min(255, Math.max(0, Math.round(data[2 * channelSize + si] * 255.0)));
        rgbaData[di * 4 + 3] = 255; // Alpha
      }
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

  async upscaleImage(imageData, onProgressCallback = () => {}, scale = 4, abortSignal = null) {
    if (!this.session || this.currentScale !== scale) await this.init(scale);

    try {
      return await this._runUpscale(imageData, onProgressCallback, scale, abortSignal);
    } catch (err) {
      // A WebGPU kernel can load but fail at run time (e.g. DepthToSpace on a compat-mode GPU).
      // Retry once on WASM so the user still gets an image. Don't retry user-cancels.
      if (this.activeEP.startsWith('WebGPU') && !(abortSignal && abortSignal.aborted)) {
        console.warn('WebGPU inference failed, retrying on WASM:', err);
        onProgressCallback(0, 'GPU failed — retrying on CPU');
        await this.fallbackToWasm(scale);
        return await this._runUpscale(imageData, onProgressCallback, scale, abortSignal);
      }
      throw err;
    }
  }

  async _runUpscale(imageData, onProgressCallback = () => {}, scale = 4, abortSignal = null) {
    const { width, height } = imageData;
    const targetWidth = width * scale;
    const targetHeight = height * scale;

    // ponytail: the feather blend accumulates the whole output in RAM (~targetW*targetH*17 bytes:
    // 3 float channels + 1 float weight + the uint8 RGBA result). At 4x that's ~1GB for a 2000x2000
    // source. Guard with a hard ceiling and fail loudly instead of OOM-crashing the tab.
    // Upgrade path: stream the blend a row-of-tiles at a time so memory is O(tile), not O(output).
    const MAX_OUTPUT_PIXELS = 4096 * 4096;
    if (targetWidth * targetHeight > MAX_OUTPUT_PIXELS) {
      throw new Error(`Image too large to upscale ${scale}x in-browser (${targetWidth}x${targetHeight}). Crop or downscale first.`);
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

    // ponytail: 512 tiles (vs 256) = ~4x fewer model runs, so far less per-call CPU<->GPU
    // transfer + kernel-dispatch overhead. If a large tile ever OOMs the GPU the run-fallback
    // drops it to WASM, so this is safe to tune; lower to 384/256 if that happens often.
    const tileSize = 512;
    const overlap = 32;
    const tiles = this.calculateTiles(width, height, tileSize, overlap);

    // RealPLKSR's 2x ONNX export has a STATIC 512x512 input; ClearReality's 4x is dynamic.
    // For the fixed model we pad each tile up to fixedSize and crop the upscaled output back to
    // the tile's real size. Interior tiles are already exactly 512, so padding only kicks in for
    // images/edges smaller than 512.
    const fixedSize = scale === 2 ? 512 : null;

    // Create a temporary canvas of the input image size once to extract tile image segments
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

    // Allocate reusable canvas for tile processing outside the loop
    const tileCanvas = document.createElement('canvas');
    const tileCtx = tileCanvas.getContext('2d');

    let lastYield = performance.now();
    for (let i = 0; i < tiles.length; i++) {
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Upscaling cancelled by user.');
      }

      const tile = tiles[i];
      onProgressCallback(i / tiles.length, `Processing Tile ${i + 1}/${tiles.length}`);

      // Yield to the event loop only every ~100ms so the browser can paint progress and stay
      // responsive — yielding every tile forced a ~4ms macrotask clamp per tile, which dominated
      // wall-clock once tiles got cheap on the GPU.
      if (performance.now() - lastYield > 100) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }

      // Feed the model: a fixed-input model gets a padded inW x inH canvas; a dynamic one gets
      // the tile at its natural size.
      const inW = fixedSize || tile.sw;
      const inH = fixedSize || tile.sh;
      tileCanvas.width = inW;
      tileCanvas.height = inH;

      if (inW !== tile.sw || inH !== tile.sh) {
        // Padding needed: stretch the tile to fill the canvas first, then overlay the real region
        // 1:1 at top-left. The model sees content-colored padding instead of a black border, which
        // avoids dark edge artifacts on sub-512 images. The padded area is cropped off afterwards.
        tileCtx.drawImage(tempCanvas, tile.sx, tile.sy, tile.sw, tile.sh, 0, 0, inW, inH);
      }
      tileCtx.drawImage(tempCanvas, tile.sx, tile.sy, tile.sw, tile.sh, 0, 0, tile.sw, tile.sh);

      const inputData = tileCtx.getImageData(0, 0, inW, inH).data;
      const inputTensor = this.preprocess(inputData, inW, inH);

      // Run model inference (input/output names come from the model, not hardcoded)
      const feeds = { [this.session.inputNames[0]]: inputTensor };
      const outputMap = await this.session.run(feeds);
      const outputTensor = outputMap[this.session.outputNames[0]];

      // Convert back to pixels, cropping the (possibly padded) output to the tile's real size.
      const upscaledPixels = this.postprocess(
        outputTensor, inW * scale, inH * scale, tile.sw * scale, tile.sh * scale
      );

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
