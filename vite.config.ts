import { defineConfig } from "vite";

export default defineConfig({
  base: "/Forge/",
  build: {
    chunkSizeWarningLimit: 1300,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/grapesjs")) return "editor-grapesjs";
          if (id.includes("node_modules/dompurify")) return "import-sanitizer";
          if (id.includes("node_modules/fflate")) return "export-packager";
          if (id.includes("node_modules/idb")) return "storage-idb";
        }
      }
    }
  }
});
