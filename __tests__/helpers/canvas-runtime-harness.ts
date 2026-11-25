import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CanvasNode } from '@/lib/canvas/document';

/** Per-test cache for components that use the same providers as the real app. */
export function createCanvasQueryHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    wrap: (children: React.ReactNode) => React.createElement(QueryClientProvider, { client }, children),
    async dispose() { await client.cancelQueries(); client.clear(); },
  };
}

/** Read current controlled nodes, including selection and geometry; never invent missing nodes. */
export function canvasInternalNode(nodes: readonly CanvasNode[] | undefined, id: string) {
  const node = nodes?.find(candidate => candidate.id === id);
  return node && { ...node, measured: { width: node.width, height: node.height }, internals: { positionAbsolute: node.position } };
}

/** DOM-only layout stand-ins. They do not claim to draw or decode real media. */
export function installCanvasDomMeasurements() {
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const context = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value() {} });
  // FrostedSelect measures text to position its menu; this is not a raster test.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ({ measureText: (text: string) => ({ width: text.length * 8 }) }) });
  return () => {
    if (scroll) Object.defineProperty(Element.prototype, 'scrollIntoView', scroll);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    if (context) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', context);
    else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
  };
}
