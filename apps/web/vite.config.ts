import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(() => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv('development', root, 'PORT');
  return {
    plugins: [react()],
    server: {
      port: 5173, strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? '3001'}` },
    },
  };
});
