import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listProviders, generate } from './ai-providers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function imageApiPlugin() {
  return {
    name: 'image-api',
    configureServer(server) {
      server.middlewares.use('/api/images', (req, res, next) => {
        const galleryDir = path.resolve(__dirname, 'gallery');
        if (req.method === 'GET') {
          if (!fs.existsSync(galleryDir)) {
            fs.mkdirSync(galleryDir, { recursive: true });
          }
          const files = fs.readdirSync(galleryDir).filter(f => f.match(/\.(png|jpe?g|webp)$/i));
          files.sort((a, b) => fs.statSync(path.join(galleryDir, b)).mtimeMs - fs.statSync(path.join(galleryDir, a)).mtimeMs);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        } else if (req.method === 'DELETE') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const filename = data.filename.replace(/[^a-z0-9.-]/gi, '_');
              const filePath = path.resolve(galleryDir, filename);
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        } else {
          next();
        }
      });
      
      server.middlewares.use('/api/upload', (req, res, next) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const base64Data = data.image.replace(/^data:image\/\w+;base64,/, "");
              const buffer = Buffer.from(base64Data, 'base64');
              const galleryDir = path.resolve(__dirname, 'gallery');
              if (!fs.existsSync(galleryDir)) {
                fs.mkdirSync(galleryDir, { recursive: true });
              }
              let filename = data.filename || `image-${Date.now()}.png`;
              // Sanitize filename
              filename = filename.replace(/[^a-z0-9.-]/gi, '_');
              let filePath = path.resolve(galleryDir, filename);
              
              if (fs.existsSync(filePath)) {
                const base = path.basename(filename, path.extname(filename));
                const ext = path.extname(filename);
                filename = `${base}-${Date.now()}${ext}`;
                filePath = path.resolve(galleryDir, filename);
              }

              fs.writeFileSync(filePath, buffer);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, filename }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        } else {
          next();
        }
      });

      server.middlewares.use('/gallery', (req, res, next) => {
        const galleryDir = path.resolve(__dirname, 'gallery');
        const reqPath = decodeURI(req.url.split('?')[0]);
        if (reqPath.includes('..')) {
           res.statusCode = 403;
           res.end();
           return;
        }
        const filePath = path.join(galleryDir, reqPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
           const ext = path.extname(filePath).toLowerCase();
           let mime = 'image/png';
           if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
           if (ext === '.webp') mime = 'image/webp';
           res.setHeader('Content-Type', mime);
           const readStream = fs.createReadStream(filePath);
           readStream.pipe(res);
        } else {
           next();
        }
      });

      server.middlewares.use('/api/ai/providers', (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(listProviders()));
      });

      server.middlewares.use('/api/ai/generate', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const result = await generate(JSON.parse(body));
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  plugins: [imageApiPlugin()],
  // ponytail: COOP/COEP headers (needed for multithreaded WASM) are intentionally omitted —
  // they break the CDN Google Fonts and jsDelivr wasm fetches. Add them only if you self-host both.
});
