import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The German dictionary is its own chunk (~100 kB gzip). For German browsers / households the page starts loading it
 * together with the app instead of after it (no waterfall): a tiny inline script adds a modulepreload for it.
 */
function preloadDict(): Plugin {
  return {
    name: 'tohuus-preload-dict',
    apply: 'build',
    enforce: 'post',
    // the CSP allows no inline scripts, so the check lives in a small file next to index.html
    transformIndexHtml: (html) => html.replace('</head>', '    <script src="/dict-preload.js"></script>\n  </head>'),
    generateBundle(_opts, bundle) {
      const de = Object.values(bundle).find((c) => c.type === 'chunk' && c.name === 'de' && c.isDynamicEntry);
      const js = de
        ? `try{var l=localStorage.getItem('sw.lang')||navigator.language||'';if(/^de/i.test(l)){var k=document.createElement('link');k.rel='modulepreload';k.crossOrigin='';k.href='/${de.fileName}';document.head.appendChild(k)}}catch(e){}\n`
        : '';
      this.emitFile({ type: 'asset', fileName: 'dict-preload.js', source: js });
      // every hashed file of this build, for the service worker to precache (lazy route chunks work offline too)
      const files = Object.values(bundle)
        .map((c) => c.fileName)
        .filter((f) => f.startsWith('assets/') && /\.(js|css|woff2)$/.test(f))
        .map((f) => `/${f}`);
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files }) });
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [react(), preloadDict()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // the first load is the shell + Heute; every other page is its own chunk (plan 2026-10-12, speed)
    chunkSizeWarningLimit: 400,
    rolldownOptions: {
      // the app and the back office (own host, server/lib/admin-auth.ts) are two pages of one build
      input: { main: 'web/index.html', admin: 'web/admin.html' },
      output: {
        // long-lived vendor chunks: an app update does not invalidate React, the router or TanStack Query in the cache
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'router', test: /node_modules[\\/](react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/, priority: 20 },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080', '/img': 'http://localhost:8080', '/mcp': 'http://localhost:8080', '/display': 'http://localhost:8080' },
  },
});
