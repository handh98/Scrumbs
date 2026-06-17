const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
  installUpdate: () => ipcRenderer.invoke("install-update"),

  // Mở thư mục chứa file log
  openLogsFolder: () => ipcRenderer.invoke("open-logs-folder"),

  // Lấy phiên bản ứng dụng
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  // Lấy đường dẫn tệp an toàn (Electron 28+)
  getPathForFile: (file) => {
    if (!file) return null;
    // webUtils.getPathForFile là cách chuẩn cho Electron hiện đại
    // Tuy nhiên, nó chỉ hoạt động với File object từ input[type="file"]
    // Đối với đường dẫn tĩnh, chúng ta cần một cách khác
    // webUtils.getPathForFile là cách chuẩn cho Electron hiện đại
    if (webUtils && typeof webUtils.getPathForFile === "function") {
      return webUtils.getPathForFile(file);
    }
    return file.path; // Fallback cho các bản Electron cũ hơn
  },

  // Lấy đường dẫn tuyệt đối đến một tài sản (asset)
  getAssetPath: (assetName) => ipcRenderer.invoke("get-asset-path", assetName),

  // Các hàm gửi yêu cầu từ Renderer lên Main (Database query/execute)
  db_query: (sql, params) => ipcRenderer.invoke("db-query", sql, params),
  db_execute: (sql, params) => ipcRenderer.invoke("db-execute", sql, params),

  // Xuất Excel
  exportStatsExcel: (payload) =>
    ipcRenderer.invoke("export-statistics-excel", payload),

  // Lưu ảnh công thức
  saveRecipeImage: (path) => ipcRenderer.invoke("save-recipe-image", path),

  // Xuất PDF công thức
  exportRecipePdf: (data) => ipcRenderer.invoke("export-recipe-pdf", data),

  // Xóa ảnh công thức
  deleteRecipeImageFile: (filePath) =>
    ipcRenderer.invoke("delete-recipe-image-file", filePath),

  // Sticky Notes API
  getStickyNotes: () => ipcRenderer.invoke("get-sticky-notes"),
  saveStickyNote: (data) => ipcRenderer.invoke("save-sticky-note", data),
  deleteStickyNote: (id) => ipcRenderer.invoke("delete-sticky-note", id),
  updateStickyNote: (data) => ipcRenderer.invoke("update-sticky-note", data),
});
