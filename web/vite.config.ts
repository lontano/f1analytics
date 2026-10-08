import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

const proxy = {
  "/v1": {
    target: "http://127.0.0.1:18700",
    changeOrigin: false,
  },
  "/timing-live": {
    target: "http://127.0.0.1:4000",
    rewrite: (path: string) => path.replace(/^\/timing-live/, ""),
  },
  "/timing-api": {
    target: "http://127.0.0.1:4010",
    rewrite: (path: string) => path.replace(/^\/timing-api/, ""),
  },
};

export default defineConfig({
  plugins: [
    {
      name: "public-asset-urls",
      enforce: "pre",
      resolveId(id) {
        if (id.startsWith("public/")) return `/${id.slice("public/".length)}?url`;
        return null;
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": src,
    },
  },
  server: {
    port: 18701,
    host: "127.0.0.1",
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
    proxy,
  },
  preview: {
    port: 18701,
    host: "127.0.0.1",
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
    proxy,
  },
});
