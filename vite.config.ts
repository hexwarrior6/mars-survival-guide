import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: { main: "index.html", dev: "dev.html", test3d: "test3d.html" },
    },
  },
});
