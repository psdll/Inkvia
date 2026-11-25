const path = require("node:path");
const suffix = process.platform + "-" + process.arch;
const staging = "dist-desktop/app-runtime-" + suffix;
module.exports = {
  appId: "com.inkvia.desktop", productName: "Inkvia",
  directories: { app: "dist-desktop/shell-" + suffix, output: "dist-desktop", buildResources: "desktop/build" },
  electronLanguages: ["zh-CN", "en-US"],
  electronVersion: require("../package.json").devDependencies.electron,
  electronDist: path.resolve(__dirname, "../node_modules/electron/dist"),
  asar: true, beforeBuild: async () => false,
  files: ["**/*"],
  extraResources: [
    { from: staging, to: "app-runtime", filter: ["**/*", "!node_modules/**"] },
    { from: staging + "/node_modules", to: "app-runtime/node_modules", filter: ["**/*"] },
  ],
  mac: { target: "dmg", identity: "-", icon: "desktop/build/icon.icns", notarize: false,
    artifactName: "Inkvia-${version}-mac-${arch}.${ext}" },
  dmg: { format: "ULFO", writeUpdateInfo: false },
  win: {
    target: "nsis", icon: "desktop/build/icon.ico", artifactName: "Inkvia-${version}-win-${arch}-setup.${ext}",
    extraResources: [{ from: "desktop/build/icon.ico", to: "inkvia-tray.ico" }],
  },
  nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, deleteAppDataOnUninstall: false },
  publish: null,
};
