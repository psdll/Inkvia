const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inkviaToolbar", {
  onState: listener => { ipcRenderer.on("toolbar:state", (_event, state) => listener(state)); },
});
