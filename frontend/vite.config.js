import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// En desarrollo, Vite reenvía al backend Laravel las rutas de la API, de los
// flujos OAuth (Microsoft y Google) y de Sanctum, y /realtime al gateway.
// Así el navegador ve un único origen (http://localhost:5173) y la cookie de
// sesión funciona sin CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_BACKEND_URL || 'http://localhost:8000';
  const proxy = { target, changeOrigin: false, xfwd: true };
  // Gateway del servicio realtime (Server-Sent Events), si está corriendo.
  const realtime = { target: env.VITE_REALTIME_URL || 'http://localhost:3001', changeOrigin: false, xfwd: true };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': proxy,
        '/auth': proxy,
        '/sanctum': proxy,
        '/realtime': realtime,
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api': proxy,
        '/auth': proxy,
        '/sanctum': proxy,
        '/realtime': realtime,
      },
    },
    build: {
      sourcemap: false,
      target: 'es2022',
    },
  };
});
