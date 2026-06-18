// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock CanvasManager and ONNXManager
const mockCanvasManagerInstances = [];
const mockONNXManagerInstances = [];

vi.mock('../src/canvas-manager.js', () => {
  return {
    CanvasManager: vi.fn().mockImplementation((orig, target) => {
      const instance = {
        originalCanvas: orig,
        targetCanvas: target,
        loadImage: vi.fn(),
        applyFilters: vi.fn(),
        rotate90: vi.fn(),
        toggleCrop: vi.fn(),
        getOriginalImageData: vi.fn().mockReturnValue({ width: 100, height: 100, data: new Uint8ClampedArray(400) }),
        updateTargetCanvas: vi.fn(),
        isCropping: false,
      };
      mockCanvasManagerInstances.push(instance);
      return instance;
    })
  };
});

vi.mock('../src/onnx-manager.js', () => {
  return {
    ONNXManager: vi.fn().mockImplementation(() => {
      const instance = {
        init: vi.fn().mockResolvedValue('WebGPU (Accelerated)'),
        upscaleImage: vi.fn().mockResolvedValue({ width: 400, height: 400, data: new Uint8ClampedArray(1600) }),
        activeEP: 'WebGPU (Accelerated)'
      };
      mockONNXManagerInstances.push(instance);
      return instance;
    })
  };
});

const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

describe('AuraScale Studio Main Integration & UI Bindings', () => {
  beforeEach(() => {
    mockCanvasManagerInstances.length = 0;
    mockONNXManagerInstances.length = 0;
    document.documentElement.innerHTML = html;
  });

  it('should wire up all DOM controls and handle the full interactive user flow', async () => {
    // 1. Load the main.js logic and dispatch DOMContentLoaded
    await import('../src/main.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    // Wait for the async init in DOMContentLoaded
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockCanvasManagerInstances.length).toBe(1);
    expect(mockONNXManagerInstances.length).toBe(1);

    const canvasMgr = mockCanvasManagerInstances[0];
    const onnxMgr = mockONNXManagerInstances[0];

    // Verify connection status telemetry
    const telemetryBadge = document.getElementById('telemetry-badge');
    expect(telemetryBadge.textContent).toBe('WebGPU (Accelerated)');
    expect(telemetryBadge.className).toContain('active');

    const upscaleBtn = document.getElementById('upscale-btn');
    expect(upscaleBtn.disabled).toBe(false);

    // 2. Test slider filter triggers
    const brightnessSlider = document.getElementById('brightness-slider');
    brightnessSlider.value = '1.3';
    brightnessSlider.dispatchEvent(new window.Event('input'));

    expect(canvasMgr.applyFilters).toHaveBeenCalledWith({
      brightness: '1.3',
      contrast: '1',
      saturation: '1'
    });

    // 3. Test rotate button
    const rotateBtn = document.getElementById('rotate-btn');
    rotateBtn.dispatchEvent(new window.Event('click'));

    expect(canvasMgr.rotate90).toHaveBeenCalled();
    expect(canvasMgr.applyFilters).toHaveBeenCalled();

    // 4. Test crop button
    const cropBtn = document.getElementById('crop-btn');
    
    // Simulate first click: enters crop mode
    canvasMgr.isCropping = true;
    cropBtn.dispatchEvent(new window.Event('click'));

    expect(canvasMgr.toggleCrop).toHaveBeenCalled();
    expect(cropBtn.textContent).toBe('Apply Crop');
    expect(cropBtn.className).toContain('primary-btn');

    // Simulate second click: exits/applies crop
    canvasMgr.isCropping = false;
    cropBtn.dispatchEvent(new window.Event('click'));

    expect(cropBtn.textContent).toBe('Crop Mode');
    expect(cropBtn.className).toContain('secondary-btn');

    // 5. Test slider handle movement dragging
    const comparisonContainer = document.getElementById('comparison-container');
    const sliderHandle = document.getElementById('slider-handle');
    const targetWrapper = document.querySelector('.target-wrapper');

    comparisonContainer.getBoundingClientRect = () => ({
      left: 100,
      width: 500,
      top: 50,
      height: 300,
      right: 600,
      bottom: 350
    });

    sliderHandle.dispatchEvent(new window.Event('mousedown'));

    // Move to 50%
    const mouseMoveEvent = new window.Event('mousemove');
    mouseMoveEvent.clientX = 350;
    window.dispatchEvent(mouseMoveEvent);

    expect(targetWrapper.style.clipPath).toBe('polygon(50% 0, 100% 0, 100% 100%, 50% 100%)');
    expect(sliderHandle.style.left).toBe('50%');

    // End drag
    window.dispatchEvent(new window.Event('mouseup'));

    // 6. Test upscale flow
    upscaleBtn.dispatchEvent(new window.Event('click'));

    expect(upscaleBtn.disabled).toBe(true);
    expect(upscaleBtn.textContent).toContain('Upscaling...');

    // Wait for the async upscale to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onnxMgr.upscaleImage).toHaveBeenCalled();
    expect(canvasMgr.getOriginalImageData).toHaveBeenCalled();
    expect(canvasMgr.updateTargetCanvas).toHaveBeenCalled();

    expect(upscaleBtn.disabled).toBe(false);
    expect(upscaleBtn.textContent).toBe('Run AI Upscale');

    // 7. Test download flow
    const targetCanvas = document.getElementById('canvas-target');
    targetCanvas.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mock-download');

    const createdElements = [];
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tagName) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        el.click = vi.fn();
        createdElements.push(el);
      }
      return el;
    };

    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.dispatchEvent(new window.Event('click'));

    expect(targetCanvas.toDataURL).toHaveBeenCalledWith('image/png');
    expect(createdElements.length).toBe(1);
    expect(createdElements[0].download).toBe('aurascale-enhanced.png');
    expect(createdElements[0].href).toBe('data:image/png;base64,mock-download');
    expect(createdElements[0].click).toHaveBeenCalled();

    // Restore original createElement
    document.createElement = originalCreateElement;
  });
});
