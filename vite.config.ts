import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const appVariant = process.env.KHABIR_APP_VARIANT === "director" ? "director" : process.env.KHABIR_APP_VARIANT === "teacher" ? "teacher" : "combined";
const isDirector = appVariant === "director";
const appIdentity = isDirector
  ? {
    name: "خبير الشواهد للمدير",
    shortName: "خبير المدير",
    description: "تطبيق محلي أولًا لاستقبال ملفات الأداء ومراجعة إنجازات المعلمين.",
    title: "خبير الشواهد للمدير — راجع بوضوح",
  }
  : {
    name: "خبير الشواهد",
    shortName: "خبير الشواهد",
    description: "تطبيق محلي أولًا لتجميع شواهد الأداء المهني.",
    title: "خبير الشواهد — وثّق إنجازك",
  };
const outputDirectory = path.resolve(import.meta.dirname, process.env.KHABIR_BUILD_OUTPUT || "dist/public");

/**
 * Portable, offline-first Vite configuration.
 * PWA assets are pre-cached locally; no runtime proxy, analytics, or platform
 * service is required to load or operate the application.
 */
export default defineConfig({
  define: {
    __KHABIR_APP_VARIANT__: JSON.stringify(appVariant),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "khabir-app-identity",
      transformIndexHtml(html) {
        return html.replace("%KHABIR_APP_TITLE%", appIdentity.title);
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        id: "/",
        name: appIdentity.name,
        short_name: appIdentity.shortName,
        description: appIdentity.description,
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#F7FCFC",
        background_color: "#FFF9F1",
        icons: [
          {
            src: "/assets/khabir-alshawahid-store-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/assets/khabir-alshawahid-store-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{html,js,css,svg,png,ico,webp}"],
        globIgnores: ["assets/khabir-alshawahid-store-icon-192.png", "assets/khabir-alshawahid-store-icon-512.png"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 3000,
    allowedHosts: true,
  },
});
