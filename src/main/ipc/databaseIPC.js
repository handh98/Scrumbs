const { ipcMain, app } = require("electron");
const { query, run } = require("../database/database");

/**
 * Đăng ký các trình xử lý IPC cho tương tác cơ sở dữ liệu
 */
function registerDatabaseIPC() {
  // Xử lý yêu cầu truy vấn dữ liệu (SELECT)
  // Tương ứng với window.electronAPI.db_query trong Renderer
  ipcMain.handle("db-query", async (event, sql, params) => {
    try {
      return await query(sql, params);
    } catch (error) {
      console.error("❌ IPC [db-query] Error:", error.message);
      throw error; // Electron sẽ chuyển lỗi này thành Promise rejection ở Renderer
    }
  });

  // Xử lý yêu cầu thực thi lệnh (INSERT, UPDATE, DELETE)
  // Tương ứng với window.electronAPI.db_execute trong Renderer
  ipcMain.handle("db-execute", async (event, sql, params) => {
    try {
      return await run(sql, params);
    } catch (error) {
      console.error("❌ IPC [db-execute] Error:", error.message);
      throw error;
    }
  });

  // Handler lấy phiên bản ứng dụng từ package.json
  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });
}

module.exports = { registerDatabaseIPC };
