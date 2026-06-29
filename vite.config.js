import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/contract-info": {
        target: "https://contracts-info.services.blockscout.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/contract-info/, ""),
      },
      "/gt-api": {
        target: "https://api.geckoterminal.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gt-api/, ""),
      },
    },
  },
});
