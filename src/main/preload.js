const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Lắng nghe sự kiện từ Main Process (dùng cho sendStatusToUI trong database.js)
  onMigrationUpdate: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on("migration-status", subscription);

    // Trả về hàm gỡ bỏ listener để Renderer có thể cleanup khi cần thiết
    return () => ipcRenderer.removeListener("migration-status", subscription);
  },

  // Lắng nghe thông báo cập nhật ứng dụng
  onUpdateMessage: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on("update-message", subscription);
    return () => ipcRenderer.removeListener("update-message", subscription);
  },

  // Lệnh cài đặt bản cập nhật
  installUpdate: () => ipcRenderer.send("install-update"),

  // Mở thư mục chứa file log
  openLogsFolder: () => ipcRenderer.invoke("open-logs-folder"),

  // Lấy phiên bản ứng dụng
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  // Các hàm gửi yêu cầu từ Renderer lên Main (Database query/execute)
  db_query: (sql, params) => ipcRenderer.invoke("db-query", sql, params),
  db_execute: (sql, params) => ipcRenderer.invoke("db-execute", sql, params),
});
