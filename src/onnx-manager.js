export class ONNXManager {
  constructor(modelUrl = '/models/clearreality.onnx') {
    this.modelUrl = modelUrl;
    this.session = null;
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
}
