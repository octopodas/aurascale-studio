# Design Spec: Browser-Based Image Studio with AI Upscaling (AuraScale Studio)

This document specifies the design, architecture, and implementation details for a browser-based, performant image manipulation and AI-enhanced image upscaling application.

---

## 1. Project Overview & Requirements

### Purpose
Provide a high-quality, professional web interface for basic image adjustments (crop, resize, rotate, brightness, contrast, saturation) and hardware-accelerated AI upscaling directly in the browser, ensuring data privacy and zero server costs.

### Key Features
1. **Core Image Manipulation**: Clean interface to crop, rotate, resize, and adjust brightness, contrast, and saturation.
2. **AI-Enhanced Upscaling**: GPU-accelerated image super-resolution using ONNX Runtime Web.
3. **WebGPU & WASM Fallback**: Automatic selection of the fastest available execution provider (WebGPU on modern browsers, multithreaded WASM as fallback).
4. **Tile-Based Processing**: Splitting large images into overlapping tiles to stay within VRAM bounds and prevent browser thread crashes, then blending edges smoothly.
5. **Interactive Before/After Comparison**: Side-by-side split screen slider to visually compare upscaled and adjusted images.
6. **No-Server Architecture**: Runs completely client-side. Cache the model file in the browser's Cache Storage or IndexedDB.

---

## 2. Technology Stack

*   **Bundler/Build Tool**: [Vite](https://vitejs.dev/) with vanilla JavaScript and standard CSS.
*   **AI Inference**: `@onnxruntime/web` (ONNX Runtime Web) for executing lightweight `.onnx` models.
*   **Styling**: Pure CSS3 utilizing modern flexbox/grid layouts, variables, and transition effects.
*   **Web Workers**: Background thread for model download, chunking, and handling canvas data transfers where applicable.

---

## 3. UI/UX Design

### Aesthetics
*   **Theme**: Deep dark theme (`#0c0c0e` base, `#141417` cards, `#8b5cf6` vibrant violet primary accents).
*   **Layout**: Left-hand sidebar containing controls, main center workspace for the image canvas/comparison viewport, and a bottom telemetry status bar showing performance metrics (Active execution provider, VRAM usage approximation, and execution time in ms).
*   **Aero Glass Effects**: Subtle transparency, border-radii (`12px`), and background blurs (`backdrop-filter: blur(10px)`).

### Interactive Components
*   **Drag & Drop Area**: Dashed border area with pulse animations.
*   **Before/After Comparison Slider**: Vertically aligned divider bar that users can drag horizontally to see the original vs. upscaled image.
*   **Slider Adjustments**: Custom range inputs with colored track fills matching the accent colors.
*   **Performance Badge**: Floating indicator (`WebGPU (Accelerated)` in green, or `WASM (CPU)` in amber) highlighting the runtime environment.

---

## 4. Technical Architecture

### 4.1. Core Image Manipulation Engine (Canvas 2D)
A dedicated `CanvasManager` class wraps the rendering pipeline. Basic adjustments are computed synchronously on the canvas context using offscreen buffers for intermediate filters to maintain a smooth 60fps UI performance:
1. **Rotation**: Rotates the canvas context (`ctx.rotate(angle)`) and adjusts container bounds.
2. **Crop**: Allows users to select an aspect ratio or custom bounding box. Crops are executed on the original image buffer.
3. **Color Filters**: Implemented via canvas `ctx.filter` commands (`brightness()`, `contrast()`, `saturate()`) for real-time preview, and baked into pixels using `getImageData()` for saving.

### 4.2. ONNX Runtime Web Integration
*   **Execution Providers**: Prioritize `webgpu`, then `wasm`.
*   **WASM Settings**: Configure `numThreads` to match `navigator.hardwareConcurrency` and enable SIMD.
*   **Model Source**: A lightweight super-resolution model (~1.7MB ClearReality V1 or ~4.9MB RealESR-General) served from a local Vite public asset folder (offline support) or dynamic Hugging Face CDN link.

### 4.3. Data Preprocessing & Postprocessing
Converting canvas image buffers into NCHW tensor data:
*   **Shape**: `[1, 3, height, width]`
*   **Data Conversion**:
    ```javascript
    // Convert RGBA to Float32 RGB tensor
    const floatBuffer = new Float32Array(3 * width * height);
    const channelSize = width * height;
    for (let i = 0; i < channelSize; i++) {
      floatBuffer[i] = imageData[i * 4] / 255.0;                   // R
      floatBuffer[channelSize + i] = imageData[i * 4 + 1] / 255.0; // G
      floatBuffer[2 * channelSize + i] = imageData[i * 4 + 2] / 255.0; // B
    }
    ```
*   **Postprocessing**: Extract output channels and reconstruct `Uint8ClampedArray` (RGBA) for canvas writing.

### 4.4. Tiled Upscaling Engine with Feather Blending
To handle high-resolution photos without running out of GPU memory:
*   **Tile Dimensions**: Split images larger than `512px` in any dimension into overlapping patches of size `256x256` with a border overlap of `32px`.
*   **Overlap Blend (Feathering)**: For overlapping margins, apply a weight function $w(x)$ which smoothly scales from $0.0$ to $1.0$ across the overlap boundary.
    $$\text{weight} = 0.5 - 0.5 \times \cos\left(\pi \times \frac{d}{\text{overlap}}\right)$$
    This ensures smooth, seamless output transitions.

---

## 5. Security & Verification Plan

### Security Considerations
*   **Privacy**: All processing remains local to the user's browser. No data is transmitted to remote servers.
*   **Model Validation**: Verify integrity of downloaded model via SHA-256 validation if fetched dynamically.

### Verification Plan
*   **Functional Testing**:
    - Image loading, basic adjustments, crop bounding limits, and output format conversion.
    - AI Upscaling functionality with verified dimensions (e.g. upscaling a 100x100 image to 400x400).
*   **Performance Metrics**:
    - Telemetry verification: display runtime execution provider (WebGPU/WASM) and processing duration.
    - Large image upscaling verification to confirm tiling functions without crashing memory.
