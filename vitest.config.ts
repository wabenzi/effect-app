import * as Path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    alias: {
      app: Path.join(__dirname, "src")
    },
    environment: 'node',
    testTimeout: 10000,
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.trunk/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'test/**',
        'dist/**',
        '**/*.d.ts',
        'vitest.config.ts',
        'scripts/**'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    }
  }
})
