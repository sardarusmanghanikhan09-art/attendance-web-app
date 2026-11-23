import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  // onnxruntime-web ships its own .wasm files; keep Vite's pre-bundler away from them
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  esbuild: {
    drop: ['console', 'debugger'],
  }
})
