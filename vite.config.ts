/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import packageInfo from './package.json' with { type: 'json' }

// 127.0.0.1:8765 是既定的 WebHID 授权源：dev/preview 固定此端口；
// GitHub Pages 部署用相对 base，任意子路径可用。
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageInfo.version),
  },
  base: process.env.GITHUB_PAGES ? './' : '/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      manifest: {
        name: 'MonsGeek Web Driver',
        short_name: 'MonsGeek',
        description: 'MonsGeek（RongYuan 平台）键盘的浏览器端配置工具：改键、组合键、宏、灯效，WebHID 直连无需安装。',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0c0c0e',
        theme_color: '#0c0c0e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 8765, strictPort: true, host: '127.0.0.1' },
  preview: { port: 8765, strictPort: true, host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
