import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      strict: false,
    },
    middlewareMode: false,
  },
  assetsInclude: ['**/*.mp3', '**/*.wav', '**/*.ogg', '**/*.flac'],
  appType: 'spa',
})
