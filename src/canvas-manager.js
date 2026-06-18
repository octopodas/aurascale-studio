export class CanvasManager {
  constructor(originalCanvas, targetCanvas) {
    this.originalCanvas = originalCanvas;
    this.targetCanvas = targetCanvas;
    this.origCtx = originalCanvas.getContext('2d');
    this.targetCtx = targetCanvas.getContext('2d');
    this.rawImage = null; // Store base image element
    this.rotation = 0; // Degrees (0, 90, 180, 270)
    this.filters = { brightness: 1, contrast: 1, saturation: 1 };
    this.upscaledCanvas = null; // Stores upscale buffer
    
    this.isCropping = false;
    this.cropRect = null;
    this.cropDragMode = null;
    this.dragStart = null;
    this.initialCropRect = null;
    
    this.onMouseDownBound = this.onMouseDown.bind(this);
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseUpBound = this.onMouseUp.bind(this);
    
    this.targetCanvas.addEventListener('mousedown', this.onMouseDownBound);
    this.targetCanvas.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    
    this.targetCanvas.addEventListener('touchstart', this.onMouseDownBound, {passive: false});
    this.targetCanvas.addEventListener('touchmove', this.onMouseMoveBound, {passive: false});
    window.addEventListener('touchend', this.onMouseUpBound);
  }

  getEventPos(e) {
    const rect = this.targetCanvas.getBoundingClientRect();
    let clientX = e.clientX, clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    const x = (clientX - rect.left) / rect.width * this.targetCanvas.width;
    const y = (clientY - rect.top) / rect.height * this.targetCanvas.height;
    return { x, y, scaleX: this.targetCanvas.width / rect.width, scaleY: this.targetCanvas.height / rect.height };
  }

  getHitMode(x, y) {
    if (!this.cropRect) return null;
    const { x: cx, y: cy, w: cw, h: ch } = this.cropRect;
    const t = 10 * this.targetCanvas.width / this.targetCanvas.getBoundingClientRect().width; // tolerance

    const left = Math.abs(x - cx) < t;
    const right = Math.abs(x - (cx + cw)) < t;
    const top = Math.abs(y - cy) < t;
    const bottom = Math.abs(y - (cy + ch)) < t;
    
    if (top && left) return 'nw';
    if (top && right) return 'ne';
    if (bottom && left) return 'sw';
    if (bottom && right) return 'se';
    if (top) return 'n';
    if (bottom) return 's';
    if (left) return 'w';
    if (right) return 'e';

    if (x > cx && x < cx + cw && y > cy && y < cy + ch) return 'move';
    return null;
  }

  onMouseDown(e) {
    if (!this.isCropping) return;
    const pos = this.getEventPos(e);
    const mode = this.getHitMode(pos.x, pos.y);
    if (mode) {
      e.preventDefault();
      this.cropDragMode = mode;
      this.dragStart = pos;
      this.initialCropRect = { ...this.cropRect };
    }
  }

  onMouseMove(e) {
    if (!this.isCropping) return;
    const pos = this.getEventPos(e);
    
    if (!this.cropDragMode) {
      const mode = this.getHitMode(pos.x, pos.y);
      let cursor = 'default';
      if (mode === 'nw' || mode === 'se') cursor = 'nwse-resize';
      else if (mode === 'ne' || mode === 'sw') cursor = 'nesw-resize';
      else if (mode === 'n' || mode === 's') cursor = 'ns-resize';
      else if (mode === 'e' || mode === 'w') cursor = 'ew-resize';
      else if (mode === 'move') cursor = 'move';
      this.targetCanvas.style.cursor = cursor;
      return;
    }

    e.preventDefault();
    const dx = pos.x - this.dragStart.x;
    const dy = pos.y - this.dragStart.y;
    let { x, y, w, h } = this.initialCropRect;

    if (this.cropDragMode === 'move') {
      x += dx;
      y += dy;
    } else {
      if (this.cropDragMode.includes('n')) { y += dy; h -= dy; }
      if (this.cropDragMode.includes('s')) { h += dy; }
      if (this.cropDragMode.includes('w')) { x += dx; w -= dx; }
      if (this.cropDragMode.includes('e')) { w += dx; }
    }

    // Constraints
    const minSize = 20;
    if (w < minSize) { w = minSize; if (this.cropDragMode.includes('w')) x = this.initialCropRect.x + this.initialCropRect.w - minSize; }
    if (h < minSize) { h = minSize; if (this.cropDragMode.includes('n')) y = this.initialCropRect.y + this.initialCropRect.h - minSize; }
    
    x = Math.max(0, Math.min(x, this.originalCanvas.width - w));
    y = Math.max(0, Math.min(y, this.originalCanvas.height - h));

    this.cropRect = { x, y, w, h };
    this.applyFilters();
  }

  onMouseUp() {
    this.cropDragMode = null;
  }

  loadImage(imageElement) {
    this.rawImage = imageElement;
    this.rotation = 0;
    this.upscaledCanvas = null;
    this.filters = { brightness: 1, contrast: 1, saturation: 1 };
    this.resetCanvasDimensions(imageElement.width, imageElement.height);
    this.drawImageScaled();
  }

  // Drop the current image and reset all editing state back to empty.
  clear() {
    this.rawImage = null;
    this.upscaledCanvas = null;
    this.rotation = 0;
    this.isCropping = false;
    this.cropRect = null;
    this.filters = { brightness: 1, contrast: 1, saturation: 1 };
    this.origCtx.clearRect(0, 0, this.originalCanvas.width, this.originalCanvas.height);
    this.targetCtx.clearRect(0, 0, this.targetCanvas.width, this.targetCanvas.height);
  }

  resetCanvasDimensions(w, h) {
    // Set correct dimension considering rotation
    const isRotated = (this.rotation / 90) % 2 !== 0;
    const targetWidth = isRotated ? h : w;
    const targetHeight = isRotated ? w : h;

    this.originalCanvas.width = targetWidth;
    this.originalCanvas.height = targetHeight;
    this.targetCanvas.width = targetWidth;
    this.targetCanvas.height = targetHeight;
  }

  drawImageScaled() {
    if (!this.rawImage) return;
    const w = this.rawImage.width;
    const h = this.rawImage.height;

    this.origCtx.clearRect(0, 0, this.originalCanvas.width, this.originalCanvas.height);
    this.origCtx.save();

    // Translate and rotate around center
    this.origCtx.translate(this.originalCanvas.width / 2, this.originalCanvas.height / 2);
    this.origCtx.rotate((this.rotation * Math.PI) / 180);
    this.origCtx.drawImage(this.rawImage, -w / 2, -h / 2);
    this.origCtx.restore();

    // Synchronize Target Canvas
    this.applyFilters();
  }

  applyFilters(filters) {
    if (!this.rawImage) return;
    if (filters) {
      this.filters = filters;
    }
    const { brightness, contrast, saturation } = this.filters;

    this.targetCtx.clearRect(0, 0, this.targetCanvas.width, this.targetCanvas.height);
    this.targetCtx.save();
    
    // Inject CSS properties for hardware accelerated adjustments
    this.targetCtx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
    if (this.upscaledCanvas) {
      this.targetCtx.drawImage(this.upscaledCanvas, 0, 0);
    } else {
      this.targetCtx.drawImage(this.originalCanvas, 0, 0);
    }
    this.targetCtx.restore();

    // Draw crop overlay if cropping is active
    if (this.isCropping && this.cropRect) {
      const { x, y, w, h } = this.cropRect;
      this.targetCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      
      // Top shadow
      this.targetCtx.fillRect(0, 0, this.targetCanvas.width, y);
      // Bottom shadow
      this.targetCtx.fillRect(0, y + h, this.targetCanvas.width, this.targetCanvas.height - (y + h));
      // Left shadow
      this.targetCtx.fillRect(0, y, x, h);
      // Right shadow
      this.targetCtx.fillRect(x + w, y, this.targetCanvas.width - (x + w), h);

      // Dashed border
      this.targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.targetCtx.lineWidth = 2;
      this.targetCtx.setLineDash([6, 6]);
      this.targetCtx.strokeRect(x, y, w, h);
      this.targetCtx.setLineDash([]);
      
      // Corner handles
      const hSize = 8;
      this.targetCtx.fillStyle = 'white';
      const drawHandle = (hx, hy) => this.targetCtx.fillRect(hx - hSize/2, hy - hSize/2, hSize, hSize);
      drawHandle(x, y);
      drawHandle(x + w, y);
      drawHandle(x, y + h);
      drawHandle(x + w, y + h);
      
      // Edge handles
      drawHandle(x + w/2, y);
      drawHandle(x + w/2, y + h);
      drawHandle(x, y + h/2);
      drawHandle(x + w, y + h/2);
    }
  }

  rotate90() {
    this.rotation = (this.rotation + 90) % 360;
    if (this.rawImage) {
      this.upscaledCanvas = null;
      this.resetCanvasDimensions(this.rawImage.width, this.rawImage.height);
      this.drawImageScaled();
    }
  }

  getOriginalImageData() {
    return this.origCtx.getImageData(0, 0, this.originalCanvas.width, this.originalCanvas.height);
  }

  getCroppedData(cropRect) {
    const { x, y, w, h } = cropRect;
    return this.origCtx.getImageData(x, y, w, h);
  }

  updateTargetCanvas(imageData) {
    this.targetCanvas.width = imageData.width;
    this.targetCanvas.height = imageData.height;
    this.targetCtx.putImageData(imageData, 0, 0);

    // Cache the upscaled pixels into a canvas source for drawImage filters
    const doc = this.targetCanvas.ownerDocument;
    this.upscaledCanvas = doc.createElement('canvas');
    this.upscaledCanvas.width = imageData.width;
    this.upscaledCanvas.height = imageData.height;
    this.upscaledCanvas.getContext('2d').putImageData(imageData, 0, 0);
  }

  toggleCrop() {
    if (this.isCropping) {
      this.performCrop();
      this.isCropping = false;
    } else {
      this.isCropping = true;
      const w = this.originalCanvas.width;
      const h = this.originalCanvas.height;
      this.cropRect = {
        x: w * 0.1,
        y: h * 0.1,
        w: w * 0.8,
        h: h * 0.8
      };
    }
    this.applyFilters();
  }

  performCrop() {
    if (!this.rawImage || !this.cropRect) return;
    const { x, y, w, h } = this.cropRect;

    const doc = this.originalCanvas.ownerDocument;
    const cropCanvas = doc.createElement('canvas');
    cropCanvas.width = w;
    cropCanvas.height = h;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(this.originalCanvas, x, y, w, h, 0, 0, w, h);

    const img = new doc.defaultView.Image();
    img.onload = () => {
      this.rawImage = img;
      this.rotation = 0;
      this.upscaledCanvas = null;
      this.resetCanvasDimensions(w, h);
      this.drawImageScaled();
    };
    img.src = cropCanvas.toDataURL();
  }
}
