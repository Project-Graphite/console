import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    env: { APP_URL: 'http://localhost:3000', SESSION_SECRET: 'test-session-secret', DEV_LOGIN: 'tester' },
  },
});
