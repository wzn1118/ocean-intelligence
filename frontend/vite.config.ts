import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, ".", "");
  const runtimeEnvironment = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const tiandituToken = (runtimeEnvironment?.VITE_TIANDITU_TOKEN ?? environment.VITE_TIANDITU_TOKEN ?? "").trim();
  if (command === "build" && !tiandituToken) {
    throw new Error("生产构建必须配置 VITE_TIANDITU_TOKEN，中国大陆和台湾省底图固定使用天地图。");
  }

  return {
    plugins: [react()],
    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("maplibre-gl")) return "vendor-map";
            if (id.includes("three")) return "vendor-three";
            if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (/node_modules[\\/]react(?:-dom)?[\\/]/.test(id) || id.includes("node_modules/scheduler")) {
              return "vendor-react";
            }
            return undefined;
          }
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api/codex-runtime": {
          target: "http://127.0.0.1:8011",
          changeOrigin: false,
        },
        "/api/codex-browser": {
          target: "http://127.0.0.1:8011",
          changeOrigin: false,
        },
        "/codex": {
          target: "http://127.0.0.1:8011",
          changeOrigin: false,
        },
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: false,
        },
      },
    },
  };
});
