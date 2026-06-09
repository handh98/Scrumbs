const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Gửi lệnh thực thi (Insert, Update, Delete)
  db_execute: (sql, params) => ipcRenderer.invoke("db-execute", sql, params),

  // Gửi lệnh truy vấn lấy dữ liệu (Select)
  db_query: (sql, params) => ipcRenderer.invoke("db-query", sql, params),
});
