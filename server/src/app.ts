import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './env';
import { trustProxySetting } from './lib/proxy';
import { errorHandler } from './middleware/error';
import { requireAjaxHeader } from './middleware/security';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';

// tesseract.js loads its worker, WebAssembly core and language data from jsDelivr (see client/src/lib/ocr.ts).
const OCR_CDN = 'https://cdn.jsdelivr.net';

export function createApp() {
  const app = express();
  app.set('trust proxy', trustProxySetting());
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", OCR_CDN, 'blob:', "'wasm-unsafe-eval'"],
          workerSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", OCR_CDN, 'blob:', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );
  app.use(cors({ origin: env.CLIENT_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', requireAjaxHeader);
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (env.STATIC_DIR) serveClient(app, path.resolve(env.STATIC_DIR));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);
  return app;
}

/** Serves the built web app, with index.html as the fallback for client-side routes. */
function serveClient(app: express.Express, dir: string) {
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });
  app.use(
    '/assets',
    express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
  );
  app.use(express.static(dir, { index: false }));
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dir, 'index.html'));
  });
}
