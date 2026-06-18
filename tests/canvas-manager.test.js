import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { CanvasManager } from '../src/canvas-manager.js';

describe('CanvasManager Calculations', () => {
  let mockOriginalCanvas;
  let mockTargetCanvas;

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><canvas id="orig"></canvas><canvas id="target"></canvas></body></html>');
    const doc = dom.window.document;
    mockOriginalCanvas = doc.getElementById('orig');
    mockTargetCanvas = doc.getElementById('target');
    
    // Mock Canvas 2D API context
    const mockContext = {
      drawImage: () => {},
      getImageData: () => ({
        data: new Uint8ClampedArray([100, 150, 200, 255]),
        width: 1,
        height: 1
      }),
      putImageData: () => {},
      clearRect: () => {},
      translate: () => {},
      rotate: () => {},
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      setLineDash: () => {},
      filter: ''
    };
    mockOriginalCanvas.getContext = () => mockContext;
    mockTargetCanvas.getContext = () => mockContext;

    // Mock doc.createElement to avoid JSDOM getContext implementation missing error
    const originalCreateElement = doc.createElement;
    doc.createElement = function(tagName) {
      if (tagName === 'canvas') {
        const c = originalCreateElement.call(doc, 'canvas');
        c.getContext = () => mockContext;
        return c;
      }
      return originalCreateElement.call(doc, tagName);
    };
  });

  it('should initialize and assign properties', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    expect(manager.originalCanvas).toBe(mockOriginalCanvas);
    expect(manager.targetCanvas).toBe(mockTargetCanvas);
  });

  it('should load image and set dimensions', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    const mockImage = { width: 400, height: 300 };
    
    let clearedRect = false;
    let drewImage = false;
    
    mockOriginalCanvas.getContext('2d').clearRect = () => { clearedRect = true; };
    mockOriginalCanvas.getContext('2d').drawImage = () => { drewImage = true; };
    
    manager.loadImage(mockImage);
    
    expect(manager.rawImage).toBe(mockImage);
    expect(manager.rotation).toBe(0);
    expect(mockOriginalCanvas.width).toBe(400);
    expect(mockOriginalCanvas.height).toBe(300);
    expect(mockTargetCanvas.width).toBe(400);
    expect(mockTargetCanvas.height).toBe(300);
    expect(clearedRect).toBe(true);
    expect(drewImage).toBe(true);
  });

  it('should apply filters to the target canvas', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    const mockImage = { width: 400, height: 300 };
    
    manager.loadImage(mockImage);
    
    let targetFilter = '';
    let drewOriginalCanvas = false;
    
    mockTargetCanvas.getContext('2d').drawImage = (img) => {
      if (img === mockOriginalCanvas) {
        drewOriginalCanvas = true;
      }
    };
    
    // We intercept context.filter updates by defining a getter/setter on target context,
    // or just checking the property on mockContext directly since it's an object.
    const targetCtx = mockTargetCanvas.getContext('2d');
    
    manager.applyFilters({ brightness: 1.2, contrast: 0.9, saturation: 1.5 });
    
    expect(targetCtx.filter).toBe('brightness(1.2) contrast(0.9) saturate(1.5)');
    expect(drewOriginalCanvas).toBe(true);
  });

  it('should rotate canvas by 90 degrees and swap dimensions', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    const mockImage = { width: 400, height: 300 };
    
    manager.loadImage(mockImage);
    
    // Initial size
    expect(mockOriginalCanvas.width).toBe(400);
    expect(mockOriginalCanvas.height).toBe(300);
    
    // Rotate 90
    manager.rotate90();
    expect(manager.rotation).toBe(90);
    expect(mockOriginalCanvas.width).toBe(300);
    expect(mockOriginalCanvas.height).toBe(400);
    
    // Rotate 180
    manager.rotate90();
    expect(manager.rotation).toBe(180);
    expect(mockOriginalCanvas.width).toBe(400);
    expect(mockOriginalCanvas.height).toBe(300);
    
    // Rotate 270
    manager.rotate90();
    expect(manager.rotation).toBe(270);
    expect(mockOriginalCanvas.width).toBe(300);
    expect(mockOriginalCanvas.height).toBe(400);
    
    // Rotate 360 -> 0
    manager.rotate90();
    expect(manager.rotation).toBe(0);
    expect(mockOriginalCanvas.width).toBe(400);
    expect(mockOriginalCanvas.height).toBe(300);
  });

  it('should get original image data', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    let calledGetImageData = false;
    mockOriginalCanvas.getContext('2d').getImageData = (x, y, w, h) => {
      calledGetImageData = true;
      return { data: 'mockData', width: w, height: h };
    };
    
    const data = manager.getOriginalImageData();
    expect(calledGetImageData).toBe(true);
    expect(data.data).toBe('mockData');
  });

  it('should get cropped data based on cropRect', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    let cropParams = null;
    mockOriginalCanvas.getContext('2d').getImageData = (x, y, w, h) => {
      cropParams = { x, y, w, h };
      return { data: 'croppedMockData', width: w, height: h };
    };
    
    const cropRect = { x: 10, y: 20, w: 100, h: 80 };
    const data = manager.getCroppedData(cropRect);
    expect(cropParams).toEqual(cropRect);
    expect(data.data).toBe('croppedMockData');
  });

  it('should update target canvas with image data', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    let putData = null;
    mockTargetCanvas.getContext('2d').putImageData = (data, x, y) => {
      putData = { data, x, y };
    };
    
    const mockImageData = { data: 'newImageData', width: 250, height: 150 };
    manager.updateTargetCanvas(mockImageData);
    
    expect(mockTargetCanvas.width).toBe(250);
    expect(mockTargetCanvas.height).toBe(150);
    expect(putData).toEqual({ data: mockImageData, x: 0, y: 0 });
  });

  it('should toggle cropping mode and set cropRect', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    const mockImage = { width: 400, height: 300 };
    
    manager.loadImage(mockImage);
    
    expect(manager.isCropping).toBeUndefined();
    
    // Toggle on
    manager.toggleCrop();
    expect(manager.isCropping).toBe(true);
    expect(manager.cropRect).toEqual({
      x: 40,
      y: 30,
      w: 320,
      h: 240
    });
    
    // Stub performCrop since we test toggle off
    let calledPerformCrop = false;
    manager.performCrop = () => { calledPerformCrop = true; };
    
    // Toggle off
    manager.toggleCrop();
    expect(manager.isCropping).toBe(false);
    expect(calledPerformCrop).toBe(true);
  });

  it('should perform crop correctly using canvas and image', () => {
    const manager = new CanvasManager(mockOriginalCanvas, mockTargetCanvas);
    const mockImage = { width: 400, height: 300 };
    manager.loadImage(mockImage);
    
    // Enable cropping
    manager.toggleCrop();
    
    // Mock document.createElement
    const mockCropCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
          expect(img).toBe(mockOriginalCanvas);
          expect(sx).toBe(40);
          expect(sy).toBe(30);
          expect(sw).toBe(320);
          expect(sh).toBe(240);
          expect(dx).toBe(0);
          expect(dy).toBe(0);
          expect(dw).toBe(320);
          expect(dh).toBe(240);
        }
      }),
      toDataURL: () => 'data:image/png;base64,mock'
    };
    
    const originalCreateElement = mockOriginalCanvas.ownerDocument.createElement;
    mockOriginalCanvas.ownerDocument.createElement = (tagName) => {
      if (tagName === 'canvas') {
        return mockCropCanvas;
      }
      return originalCreateElement.call(mockOriginalCanvas.ownerDocument, tagName);
    };
    
    // Mock global Image constructor on ownerDocument's defaultView (window)
    const windowObj = mockOriginalCanvas.ownerDocument.defaultView;
    const originalImage = windowObj.Image;
    let mockImageInstance = {};
    windowObj.Image = function() {
      return mockImageInstance;
    };
    
    // Spy on drawImageScaled
    let calledDrawImageScaled = false;
    manager.drawImageScaled = () => { calledDrawImageScaled = true; };
    
    manager.performCrop();
    
    // Check cropCanvas dimensions are set to cropRect dimensions
    expect(mockCropCanvas.width).toBe(manager.cropRect.w);
    expect(mockCropCanvas.height).toBe(manager.cropRect.h);
    expect(mockImageInstance.src).toBe('data:image/png;base64,mock');
    
    // Trigger onload
    mockImageInstance.onload();
    expect(manager.rawImage).toBe(mockImageInstance);
    expect(manager.rotation).toBe(0);
    expect(calledDrawImageScaled).toBe(true);
    
    // Restore
    mockOriginalCanvas.ownerDocument.createElement = originalCreateElement;
    windowObj.Image = originalImage;
  });
});
