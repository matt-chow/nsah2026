import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/** The Node archive functions in ../api, served locally the way Vercel serves them (api/index.py is Vercel-only). */
const API = ['observations', 'cutout'];
function localApi(): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api', (req, res, next) => {
      const url = new URL(`http://localhost/api${req.url ?? ''}`);
      const name = url.pathname.slice('/api/'.length);
      if (req.method !== 'GET' || !API.includes(name)) return next();
      import(/* @vite-ignore */ new URL(`../api/${name}.mjs`, import.meta.url).href)
        .then((m: { GET: (r: Request) => Promise<Response> }) => m.GET(new Request(url)))
        .then(async (r) => {
          res.statusCode = r.status;
          r.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await r.arrayBuffer()));
        })
        .catch(next);
    });
  };
  return { name: 'parallax-local-api', configureServer: mount, configurePreviewServer: mount };
}

// api/index.py (Python) can't run inside Vite, so local dev forwards its two routes to the deployed function.
const pythonApi = {
  '^/api/(sia|spherex)': { target: 'https://nsah2026.vercel.app', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), localApi()],
  server: { proxy: pythonApi },
  preview: { proxy: pythonApi },
  // Relative base so dist/ works from any static host path (e.g. GitHub Pages project URL).
  base: './',
  // data/ holds only validated, publishable products; disposable caches live in .cache/.
  publicDir: '../data',
  // index.html is the observatory (src/prototype); classic.html keeps the earlier explorer pages.
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: ['index.html', 'classic.html'] },
  },
});
