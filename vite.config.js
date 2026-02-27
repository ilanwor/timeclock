import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'TimeClock Pro',
        short_name: 'TimeClock',
        description: 'Employee time tracking kiosk',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache all static assets
        globPatterns: ['**/*.{js,css,html,svg,ico,woff,woff2}'],
        // Runtime caching strategy — network-first for API-like requests
        runtimeCaching: [],
        // Skip waiting so updated SW activates immediately on refresh
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
