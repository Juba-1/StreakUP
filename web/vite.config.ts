import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts')) return 'vendor-recharts'
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('@tanstack')) return 'vendor-tanstack'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('cmdk')) return 'vendor-cmdk'
          if (id.includes('lucide-react')) return 'vendor-icons'
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
