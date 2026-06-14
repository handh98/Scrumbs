const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Expose functions from main process to renderer process
  db_query: (sql, params) => ipcRenderer.invoke("db-query", sql, params),
  db_execute: (sql, params) => ipcRenderer.invoke("db-execute", sql, params),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  onMigrationUpdate: (callback) =>
    ipcRenderer.on("migration-status", (event, data) => callback(data)),
  onUpdateMessage: (callback) =>
    ipcRenderer.on("update-message", (event, data) => callback(data)),
});
