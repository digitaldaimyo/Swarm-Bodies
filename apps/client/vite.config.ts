import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

const iconSvg = fileURLToPath(new URL("./build/icon.svg", import.meta.url));

/**
 * PWA icons are generated at build time from one SVG (SPEC §10.7), so the repository ships no
 * bitmaps (CLAUDE.md).
 */
function generatedIcons(): Plugin {
  const sizes: [string, number, boolean][] = [
    ["icons/icon-192.png", 192, false],
    ["icons/icon-512.png", 512, false],
    ["icons/maskable-512.png", 512, true],
    ["icons/apple-touch-icon.png", 180, false],
  ];
  return {
    name: "swarm-generated-icons",
    configureServer(server) {
      server.middlewares.use("/icon.svg", (_req, res) => {
        res.setHeader("Content-Type", "image/svg+xml");
        res.end(readFileSync(iconSvg));
      });
    },
    async generateBundle() {
      const sharp = (await import("sharp")).default;
      const svg = readFileSync(iconSvg);
      this.emitFile({ type: "asset", fileName: "icon.svg", source: svg });
      for (const [fileName, size, maskable] of sizes) {
        // Maskable icons keep the art inside the central safe zone.
        const inner = maskable ? Math.round(size * 0.8) : size;
        const art = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
        const png = maskable
          ? await sharp({
              create: { width: size, height: size, channels: 4, background: "#070b1a" },
            })
              .composite([{ input: art, gravity: "center" }])
              .png()
              .toBuffer()
          : art;
        this.emitFile({ type: "asset", fileName, source: png });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    preact(),
    generatedIcons(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Swarm Bodies",
        short_name: "Swarm Bodies",
        description: "Grow slime colonies across an asteroid in a simultaneous-turn strategy game.",
        theme_color: "#070b1a",
        background_color: "#070b1a",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.googleapis.com" ||
              url.origin === "https://fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "fonts", expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 900 },
});
