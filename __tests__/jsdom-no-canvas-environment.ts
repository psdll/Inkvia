import Module, { createRequire } from "node:module";
import type { Environment } from "vitest";
import { populateGlobal } from "vitest/environments";

const require = createRequire(import.meta.url);

export default {
  name: "jsdom-no-canvas",
  transformMode: "web",
  async setup(global) {
    const moduleWithResolver = Module as typeof Module & {
      _resolveFilename: (request: string, ...args: any[]) => string;
    };
    const originalResolveFilename = moduleWithResolver._resolveFilename;
    moduleWithResolver._resolveFilename = function resolveWithoutCanvas(request, ...args) {
      if (request === "canvas") {
        const error = new Error("Cannot find module 'canvas'") as NodeJS.ErrnoException;
        error.code = "MODULE_NOT_FOUND";
        throw error;
      }
      return originalResolveFilename.call(this, request, ...args);
    };

    let JSDOM: new (...args: any[]) => any;
    try {
      ({ JSDOM } = require("jsdom"));
    } finally {
      moduleWithResolver._resolveFilename = originalResolveFilename;
    }

    const dom = new JSDOM("<!DOCTYPE html>", {
      pretendToBeVisual: true,
      url: "http://localhost:3000",
    });
    const { keys, originals } = populateGlobal(global, dom.window, { bindFunctions: true });
    // jsdom has no layout/scroll engine. Runtime tests still exercise handlers and state.
    dom.window.HTMLElement.prototype.scrollTo = function (options: ScrollToOptions | number, y?: number) {
      this.scrollTop = typeof options === "number" ? y ?? 0 : options.top ?? this.scrollTop;
      this.scrollLeft = typeof options === "number" ? options : options.left ?? this.scrollLeft;
    };

    return {
      teardown(targetGlobal) {
        dom.window.close();
        keys.forEach((key) => delete targetGlobal[key]);
        originals.forEach((value, key) => { targetGlobal[key] = value; });
      },
    };
  },
} satisfies Environment;
