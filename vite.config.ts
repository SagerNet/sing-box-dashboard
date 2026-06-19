import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      pwaAssets: {
        config: true,
        injectThemeColor: false,
      },
      manifest: {
        name: "sing-box dashboard",
        short_name: "sing-box",
        description: "Web dashboard for sing-box.",
        id: "./",
        start_url: "./",
        scope: "./",
        display: "standalone",
        theme_color: "#181818",
        background_color: "#1e1e1e",
        lang: "en",
        dir: "ltr",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico,webmanifest}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
