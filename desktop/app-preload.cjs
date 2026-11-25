const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inkviaWindow", {
  getCloseSetting: () => ipcRenderer.invoke("inkvia:close-setting:get"),
  setCloseSetting: value => ipcRenderer.invoke("inkvia:close-setting:set", value),
});
