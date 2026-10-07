import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' lets the built app run from any folder or static host (GitHub Pages, Netlify).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { open: true },
})
