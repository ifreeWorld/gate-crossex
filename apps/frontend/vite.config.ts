import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const backendPort = Number(process.env.GCT_PORT ?? 17840);
const frontendPort = Number(process.env.GCT_FRONTEND_PORT ?? 5173);
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const backendProxy = {
  target: backendOrigin,
  // A standalone Vite frontend may attach to an already-running production backend. Rewrite Host
  // and Origin to that backend's local origin so its loopback and same-origin guards stay intact.
  changeOrigin: true,
  headers: { Origin: backendOrigin },
};
const releaseVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(releaseVersion),
  },
  server: {
    // Expose only the development frontend port to the local network. Authenticated API and
    // WebSocket traffic still goes through Vite's proxy to the loopback-only backend below.
    host: '0.0.0.0',
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/health': backendProxy,
      '/api': backendProxy,
      '/secure': backendProxy,
      '/ws': { ...backendProxy, ws: true },
    },
  },
});
