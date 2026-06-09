import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative paths so the built app loads from file:// inside Electron (prod).
  base: './',
  server: {
    port: 5191,
    strictPort: true,
  },
})
