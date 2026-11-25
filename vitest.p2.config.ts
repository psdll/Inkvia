import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      '__tests__/canvas-p2-*-runtime.test.ts',
      '__tests__/canvas-batch-upload.test.ts',
      '__tests__/canvas-save-before-run.test.ts',
      '__tests__/canvas-run-save-flush.test.ts',
      '__tests__/canvas-shortcut-runtime.test.ts',
      '__tests__/canvas-media-runtime-lifecycle.test.ts',
      '__tests__/canvas-video-poster-zoom.test.ts',
      '__tests__/media-cleanup-batching.test.ts',
      '__tests__/media-cleanup-p2-filesystem.test.ts',
    ],
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
