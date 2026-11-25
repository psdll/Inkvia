import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("production canvas build boundary", () => {
  it("does not bundle Fabric's optional native node-canvas backend", () => {
    const configPath = resolve(process.cwd(), "next.config.js");
    delete require.cache[require.resolve(configPath)];
    const nextConfig = require(configPath);
    const webpackConfig = nextConfig.webpack(
      { context: process.cwd(), resolve: { alias: {} } },
      { isServer: true },
    );

    expect(webpackConfig.resolve.alias.canvas).toBe(false);
  });

  it("keeps the browser-side Fabric bundle unchanged", () => {
    const configPath = resolve(process.cwd(), "next.config.js");
    delete require.cache[require.resolve(configPath)];
    const nextConfig = require(configPath);
    const webpackConfig = nextConfig.webpack(
      { context: process.cwd(), resolve: { alias: {} } },
      { isServer: false },
    );

    expect(webpackConfig.resolve.alias.canvas).toBeUndefined();
  });
});
