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
  const downloadBtn = document.getElementById('download-btn');
  const telemetryBadge = document.getElementById('telemetry-badge');
  const comparisonContainer = document.getElementById('comparison-container');
  const targetWrapper = document.querySelector('.target-wrapper');
  const sliderHandle = document.getElementById('slider-handle');

  const origCanvas = document.getElementById('canvas-original');
  const targetCanvas = document.getElementById('canvas-target');

  const canvasManager = new CanvasManager(origCanvas, targetCanvas);
  const onnxManager = new ONNXManager();

  // Init ONNX Session & Update Telemetry. If the model fails to load (e.g. bad download),
  // keep image editing usable and surface the error instead of throwing out of DOMContentLoaded
  // (which would leave the badge stuck on "Loading..." and the button silently disabled).
  telemetryBadge.textContent = 'Loading AI Model...';
  try {
    const activeEP = await onnxManager.init();
    telemetryBadge.textContent = activeEP;
    telemetryBadge.className = 'telemetry-badge active';
    upscaleBtn.disabled = false;
  } catch (err) {
    console.error('Model init failed:', err);
    telemetryBadge.textContent = 'AI model failed to load — editing still works';
    telemetryBadge.className = 'telemetry-badge loading';
  }

  // Load Image Event Handler
  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        dropzone.classList.add('hidden');
        comparisonContainer.classList.remove('hidden');
        
        // Reset DOM Controls to match CanvasManager state
        brightnessSlider.value = 1;
        contrastSlider.value = 1;
        saturationSlider.value = 1;

        canvasManager.loadImage(img);
        downloadBtn.disabled = false;
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
    cropBtn.textContent = canvasManager.isCropping ? 'Apply Crop' : 'Crop Mode';
    cropBtn.classList.toggle('primary-btn', canvasManager.isCropping);
    cropBtn.classList.toggle('secondary-btn', !canvasManager.isCropping);
  });

  // AI Upscale trigger
  upscaleBtn.addEventListener('click', async () => {
    upscaleBtn.disabled = true;
    upscaleBtn.textContent = 'Upscaling...';
    const startTime = performance.now();

    try {
      const origData = canvasManager.getOriginalImageData();
      const upscaledData = await onnxManager.upscaleImage(origData, (pct, status) => {
        upscaleBtn.textContent = `${Math.round(pct * 100)}% - ${status}`;
      });

      canvasManager.updateTargetCanvas(upscaledData);
      
      const duration = Math.round(performance.now() - startTime);
      telemetryBadge.textContent = `${onnxManager.activeEP} | Upscaled in ${duration}ms`;
    } catch (err) {
      console.error(err);
      alert('Upscaling failed: ' + err.message);
    } finally {
      upscaleBtn.disabled = false;
      upscaleBtn.textContent = 'Run AI Upscale';
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

  // Download Logic
  downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'aurascale-enhanced.png';
    link.href = targetCanvas.toDataURL('image/png');
    link.click();
  });
});
