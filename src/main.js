import { CanvasManager } from './canvas-manager.js';
import { ONNXManager } from './onnx-manager.js';

document.addEventListener('DOMContentLoaded', async () => {
  const dropzone = document.getElementById('dropzone');
  const imageInput = document.getElementById('image-input');
  const brightnessSlider = document.getElementById('brightness-slider');
  const contrastSlider = document.getElementById('contrast-slider');
  const saturationSlider = document.getElementById('saturation-slider');
  const rotateBtn = document.getElementById('rotate-btn');
  const cropBtn = document.getElementById('crop-btn');
  const upscaleBtn = document.getElementById('upscale-btn');
  const upscaleFactorSelect = document.getElementById('upscale-factor');
  const progressContainer = document.getElementById('progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressText = document.getElementById('progress-text');
  const cancelUpscaleBtn = document.getElementById('cancel-upscale-btn');
  const downloadBtn = document.getElementById('download-btn');
  const saveBtn = document.getElementById('save-btn');
  const telemetryBadge = document.getElementById('telemetry-badge');
  const comparisonContainer = document.getElementById('comparison-container');
  const targetWrapper = document.querySelector('.target-wrapper');
  const sliderHandle = document.getElementById('slider-handle');
  const galleryTrack = document.getElementById('gallery-track');
  const galleryCount = document.getElementById('gallery-count');

  const origCanvas = document.getElementById('canvas-original');
  const targetCanvas = document.getElementById('canvas-target');

  const canvasManager = new CanvasManager(origCanvas, targetCanvas);
  const onnxManager = new ONNXManager();

  // Init ONNX Session & Update Telemetry.
  telemetryBadge.textContent = 'Loading AI Model...';
  try {
    const scale = parseInt(upscaleFactorSelect.value, 10) || 4;
    const activeEP = await onnxManager.init(scale);
    telemetryBadge.textContent = activeEP;
    telemetryBadge.className = 'telemetry-badge active';
    upscaleBtn.disabled = false;
  } catch (err) {
    console.error('Model init failed:', err);
    telemetryBadge.textContent = 'AI model failed to load — editing still works';
    telemetryBadge.className = 'telemetry-badge loading';
  }

  // Handle Model Scale Change
  upscaleFactorSelect.addEventListener('change', async () => {
    upscaleBtn.disabled = true;
    telemetryBadge.textContent = 'Loading AI Model...';
    try {
      const scale = parseInt(upscaleFactorSelect.value, 10) || 4;
      const activeEP = await onnxManager.init(scale);
      telemetryBadge.textContent = activeEP;
      telemetryBadge.className = 'telemetry-badge active';
      upscaleBtn.disabled = false;
    } catch (err) {
      console.error('Model init failed:', err);
      telemetryBadge.textContent = 'AI model failed to load';
      telemetryBadge.className = 'telemetry-badge loading';
    }
  });

  // Gallery Logic
  async function loadGallery() {
    try {
      const res = await fetch('/api/images');
      if (res.ok) {
        const files = await res.json();
        galleryCount.textContent = files.length;
        galleryTrack.innerHTML = '';
        files.forEach(file => {
          const div = document.createElement('div');
          div.className = 'gallery-item';
          const img = document.createElement('img');
          img.src = `/gallery/${file}`;
          img.loading = 'lazy';
          img.title = file;
          // allow loading image from gallery back to workspace
          div.addEventListener('click', () => {
            fetch(img.src).then(r => r.blob()).then(blob => {
              const f = new File([blob], file, { type: blob.type });
              handleFile(f, true);
            });
          });
          
          const delBtn = document.createElement('button');
          delBtn.className = 'delete-btn';
          delBtn.innerHTML = '&times;';
          delBtn.title = 'Delete image';
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Delete this image?')) {
              try {
                const res = await fetch('/api/images', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename: file })
                });
                if (res.ok) {
                  loadGallery();
                }
              } catch (err) {
                console.error('Failed to delete image:', err);
              }
            }
          });
          
          div.appendChild(img);
          div.appendChild(delBtn);
          galleryTrack.appendChild(div);
        });
      }
    } catch (err) {
      console.error('Failed to load gallery:', err);
    }
  }

  // Initial gallery load
  loadGallery();

  let currentFileName = 'image.png';

  // Load Image Event Handler
  function handleFile(file, fromGallery = false) {
    if (!file || !file.type.startsWith('image/')) return;

    currentFileName = file.name || 'image.png';

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;

      if (!fromGallery) {
        try {
          await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl, filename: currentFileName })
          });
          loadGallery();
        } catch (err) {
          console.error('Failed to auto-save original image:', err);
        }
      }

      const img = new Image();
      img.onload = () => {
        dropzone.classList.remove('hidden'); // In case there was a hidden class
        dropzone.classList.add('mini');
        dropzone.title = 'Upload new image';
        comparisonContainer.classList.remove('hidden');
        
        // Reset DOM Controls to match CanvasManager state
        brightnessSlider.value = 1;
        contrastSlider.value = 1;
        saturationSlider.value = 1;

        canvasManager.loadImage(img);
        resetZoom();
        downloadBtn.disabled = false;
        saveBtn.disabled = false;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Dropzone Events
  dropzone.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });

  // Slider filter triggers
  function triggerFilters() {
    canvasManager.applyFilters({
      brightness: brightnessSlider.value,
      contrast: contrastSlider.value,
      saturation: saturationSlider.value
    });
  }

  brightnessSlider.addEventListener('input', triggerFilters);
  contrastSlider.addEventListener('input', triggerFilters);
  saturationSlider.addEventListener('input', triggerFilters);

  // Rotation triggers
  rotateBtn.addEventListener('click', () => {
    canvasManager.rotate90();
    triggerFilters();
  });

  // Crop triggers
  cropBtn.addEventListener('click', () => {
    canvasManager.toggleCrop();
    const isCropping = canvasManager.isCropping;
    cropBtn.textContent = isCropping ? 'Apply Crop' : 'Crop Mode';
    cropBtn.classList.toggle('primary-btn', isCropping);
    cropBtn.classList.toggle('secondary-btn', !isCropping);
    
    if (isCropping) {
      targetWrapper.style.clipPath = 'polygon(0% 0, 100% 0, 100% 100%, 0% 100%)';
      sliderHandle.style.display = 'none';
    } else {
      const pos = parseFloat(sliderHandle.style.left || '50');
      targetWrapper.style.clipPath = `polygon(${pos}% 0, 100% 0, 100% 100%, ${pos}% 100%)`;
      sliderHandle.style.display = 'block';
    }
  });

  let currentAbortController = null;

  cancelUpscaleBtn.addEventListener('click', () => {
    if (currentAbortController) {
      currentUpscaleStatus = 'Cancelling...';
      cancelUpscaleBtn.disabled = true;
      currentAbortController.abort();
    }
  });

  // AI Upscale trigger
  let currentUpscaleStatus = '';
  upscaleBtn.addEventListener('click', async () => {
    upscaleBtn.disabled = true;
    upscaleBtn.textContent = 'Upscaling...';
    cancelUpscaleBtn.disabled = false;
    currentAbortController = new AbortController();
    
    progressContainer.classList.remove('hidden');
    progressBarFill.style.width = '0%';
    progressText.textContent = 'Preparing...';

    const startTime = performance.now();

    try {
      const scale = parseInt(upscaleFactorSelect.value, 10) || 4;
      const origData = canvasManager.getOriginalImageData();
      const upscaledData = await onnxManager.upscaleImage(origData, (pct, status) => {
        const percent = Math.round(pct * 100);
        upscaleBtn.textContent = `${percent}% - ${status}`;
        progressBarFill.style.width = `${percent}%`;
        progressText.textContent = `${percent}% - ${status}`;
      }, scale, currentAbortController.signal);

      canvasManager.updateTargetCanvas(upscaledData);
      
      const duration = Math.round(performance.now() - startTime);
      telemetryBadge.textContent = `${onnxManager.activeEP} | Upscaled in ${duration}ms`;
    } catch (err) {
      console.error(err);
      if (err.message === 'Upscaling cancelled by user.') {
        // Just hide UI elements, no alert needed
        progressText.textContent = 'Cancelled';
      } else {
        alert('Upscaling failed: ' + err.message);
      }
    } finally {
      currentAbortController = null;
      upscaleBtn.disabled = false;
      upscaleBtn.textContent = 'Run AI Upscale';
      
      setTimeout(() => {
        progressContainer.classList.add('hidden');
        progressBarFill.style.width = '0%';
        progressText.textContent = '';
      }, 2000);
    }
  });

  // Before/After comparison slider logic
  let isDragging = false;

  function moveSlider(x) {
    const rect = comparisonContainer.getBoundingClientRect();
    let pos = (x - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));
    
    targetWrapper.style.clipPath = `polygon(${pos * 100}% 0, 100% 0, 100% 100%, ${pos * 100}% 100%)`;
    sliderHandle.style.left = `${pos * 100}%`;
  }

  sliderHandle.addEventListener('mousedown', () => isDragging = true);
  window.addEventListener('mouseup', () => isDragging = false);
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    moveSlider(e.clientX);
  });

  sliderHandle.addEventListener('touchstart', () => isDragging = true);
  window.addEventListener('touchend', () => isDragging = false);
  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault(); // Prevent body scrolling while dragging split slider
    moveSlider(e.touches[0].clientX);
  }, { passive: false });

  // Image zoom — Ctrl +/- /0 and Ctrl+wheel. Both canvases get the same transform so the
  // before/after stays aligned; the slider clip lives on the wrapper (container coords) so it's
  // untouched. ponytail: zoom-to-cursor only, no drag-pan — point+scroll moves the focus, which
  // is enough to inspect detail; add drag-pan if someone actually needs it.
  let zoom = 1, panX = 0, panY = 0;
  const ZOOM_MIN = 1, ZOOM_MAX = 8, ZOOM_STEP = 1.15;

  function applyZoom() {
    const t = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    origCanvas.style.transform = t;
    targetCanvas.style.transform = t;
    comparisonContainer.style.cursor = zoom > 1 ? 'zoom-out' : 'zoom-in';
  }

  // Zoom toward a focal point (cx,cy measured from the container centre, px) so the pixel under
  // the cursor stays put. cx=cy=0 zooms about the centre (keyboard).
  function setZoom(next, cx = 0, cy = 0) {
    next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    const ratio = next / zoom;
    panX = cx * (1 - ratio) + panX * ratio;
    panY = cy * (1 - ratio) + panY * ratio;
    zoom = next;
    if (zoom === ZOOM_MIN) { panX = 0; panY = 0; } // snap back to centred fit
    applyZoom();
  }

  function resetZoom() { zoom = 1; panX = 0; panY = 0; applyZoom(); }

  comparisonContainer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;       // leave plain scroll alone
    e.preventDefault();           // stop the browser's page zoom
    const rect = comparisonContainer.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setZoom(zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), cx, cy);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || comparisonContainer.classList.contains('hidden')) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * ZOOM_STEP); }
    else if (e.key === '-') { e.preventDefault(); setZoom(zoom / ZOOM_STEP); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  });

  // Download Logic
  downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'aurascale-enhanced.png';
    link.href = targetCanvas.toDataURL('image/png');
    link.click();
  });

  // Save Logic
  saveBtn.addEventListener('click', async () => {
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
      const dataUrl = targetCanvas.toDataURL('image/png');
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: dataUrl,
          filename: currentFileName
        })
      });
      
      if (res.ok) {
        await loadGallery();
        saveBtn.textContent = 'Saved!';
      } else {
        throw new Error('Server returned an error');
      }
    } catch (err) {
      console.error('Failed to save image:', err);
      alert('Failed to save image');
    } finally {
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 2000);
    }
  });
});
