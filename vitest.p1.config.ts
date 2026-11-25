import { defineConfig } from 'vitest/config';
import base from './vitest.p0.config';
export default defineConfig({ ...base, test: { ...base.test, include: [...(base.test?.include || []),  '__tests__/agent-memory-*.test.ts',   '__tests__/llm-routing*.test.ts',  '__tests__/no-native-video-controls.test.ts'], maxWorkers: 4, minWorkers: 1 } });
