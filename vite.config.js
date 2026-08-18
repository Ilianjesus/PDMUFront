import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "/PDMUFront/",
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.js",
      include: ["src/**/*.{test,spec}.{js,jsx}"],
      css: true,
    },
  };
});
