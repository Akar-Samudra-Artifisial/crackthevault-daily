// Local UI preview only (`npm run preview:ui`, root = tools/preview). Serves the app's public/
// folder like the real build does, so `/brand/logo.webp` resolves the same way.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: '../../public',
});
