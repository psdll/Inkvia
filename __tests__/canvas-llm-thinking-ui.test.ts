// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from 'vitest';
import { verifyLlmThinkingSelection, verifyLlmDisplayNameSelection } from './helpers/canvas-ui-contract-harness';

it('shows custom LLM names while saving the selected provider and original model ID', verifyLlmDisplayNameSelection);

it.each([
  ['volcengine', 'doubao-seed-evolving', ['default', 'none', 'low', 'medium', 'high'], '思考高', 'high'],
  ['bailian', 'qwen3.8-max', ['default', 'none', 'low', 'medium', 'high'], '思考关闭', 'none'],
  ['deepseek', 'deepseek-v4-pro', ['default', 'none', 'low', 'high', 'max'], '思考最大', 'max'],
  ['minimax', 'MiniMax-M3', ['default', 'none', 'adaptive'], '思考自适应', 'adaptive'],
] as const)('saves the supported thinking choice for %s / %s', (providerId, modelId, levels, label, value) =>
  verifyLlmThinkingSelection(providerId, modelId, [...levels], label, value));
