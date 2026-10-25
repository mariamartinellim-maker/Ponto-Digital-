import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "test-secret-test-secret-test-secret-123456",
      DEMO_ADMIN_PASSWORD: "senhaDeTeste123",
      DEMO_TEAM_PASSWORD: "senhaDeTeste123",
      WHATSAPP_SEND_MODE: "live", // mesmo em "live", NODE_ENV=test deve bloquear envios reais
    },
  },
});
