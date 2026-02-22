import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.js', 'routes/**/*.js', 'ws/**/*.js', 'public/**/*.js'],
      exclude: ['public/index.html'],
    },
  },
});
