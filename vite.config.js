import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Single config for the Vite dev/build server and Vitest.
 *
 * Local-LLM wiring (all optional; everything has a safe default):
 *   .env.local
 *     VITE_LLM_PROXY_TARGET=http://127.0.0.1:8080   # where the /v1 proxy forwards
 *     VITE_LLM_PROXY_KEY=<api-key>                  # injected server-side; browser never sees it
 *     VITE_LLM_MODEL=FG-Inteligencia                # default model id shown/used
 *
 * The dev server proxies /v1/* to the llama.cpp router same-origin, and — if
 * VITE_LLM_PROXY_KEY is set — stamps the Authorization header on the proxied
 * request. That keeps the API key out of the client bundle and out of git.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', '']);
  const target = env.VITE_LLM_PROXY_TARGET || 'http://127.0.0.1:8080';
  const proxyKey = env.VITE_LLM_PROXY_KEY || '';

  return {
    plugins: [react()],
    // Expose a couple of non-secret values to the client for the demo config.
    define: {
      __VITE_LLM_MODEL__: JSON.stringify(env.VITE_LLM_MODEL || 'default'),
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/v1': {
          target,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (proxyKey) proxyReq.setHeader('Authorization', `Bearer ${proxyKey}`);
            });
          },
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 1000, // three.js is one big chunk; silence the warning
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./test/setup.js'],
      include: ['test/**/*.test.[jt]s', 'src/**/*.test.[jt]s'],
    },
  };
});
