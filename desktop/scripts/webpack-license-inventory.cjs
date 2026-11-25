const fs = require("node:fs");
const path = require("node:path");

class WebpackLicenseInventory {
  constructor(root, distDir) {
    this.root = root;
    this.directory = path.resolve(root, distDir);
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tap("WebpackLicenseInventory", (compilation) => {
      const resources = new Set();
      const visited = new Set();
      const collect = (module) => {
        if (visited.has(module)) return;
        visited.add(module);
        if (module.resource) {
          const relative = path.relative(this.root, module.resource.split("?")[0]);
          if (relative.startsWith("node_modules" + path.sep)) resources.add(relative);
        }
        // A concatenated module keeps the resources of its individual modules.
        for (const child of module.modules ?? []) collect(child);
      };
      for (const chunk of compilation.chunks) {
        for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) collect(module);
      }
      const file = path.join(this.directory, "webpack-license-" + compiler.options.name + ".json");
      fs.writeFileSync(file, JSON.stringify([...resources].sort()));
    });
  }
}

module.exports = { WebpackLicenseInventory };
