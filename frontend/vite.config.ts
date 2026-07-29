import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Em produção o nginx faz o proxy de /pb e /api (ver nginx.conf).
// Em `npm run dev` o proxy abaixo aponta para os containers na sua máquina.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/pb": {
        target: "http://localhost:8090",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pb/, ""),
      },
      "/api": {
        target: "http://localhost:8096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
