const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { setupDatabase } = require("./database/database");
const { autoUpdater } = require("electron-updater");
const { registerDatabaseIPC } = require("./ipc/databaseIPC");
const log = require("electron-log");

// --- Cấu hình Logger ---
log.transports.file.level = "info";
// Tùy chỉnh tên file và vị trí: mặc định ở %AppData%/crumbs-app/logs/main.log
log.transports.file.fileName = "update.log";
log.transports.file.maxSize = 5 * 1024 * 1024; // Giới hạn 5MB mỗi file log

// Ghi log thông tin khởi động
log.info("--- Ứng dụng Crumbs đang khởi động ---");
log.info(`Phiên bản: ${app.getVersion()}`);
log.info(`Nền tảng: ${process.platform} (${process.arch})`);
log.info(`Đường dẫn DB: ${path.join(app.getPath("userData"), "bakery.db")}`);

let mainWindow;
let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 300,
    frame: false, // Bỏ khung cửa sổ
    transparent: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false },
  });

  splashWindow.loadFile(path.join(__dirname, "../renderer/pages/splash.html"));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    show: false, // QUAN TRỌNG: Ẩn đi cho đến khi load xong
    icon: path.join(__dirname, "../renderer/assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.maximize();
  mainWindow.show();
  mainWindow.loadFile(path.join(__dirname, "..", "..", "index.html"));

  // Chỉ hiện cửa sổ khi nội dung đã tải xong
  mainWindow.once("ready-to-show", () => {
    if (splashWindow) splashWindow.destroy();
    // Bắt đầu kiểm tra cập nhật sau khi cửa sổ chính đã sẵn sàng
    if (app.isPackaged) {
      // Chỉ kiểm tra cập nhật khi ứng dụng đã được đóng gói
      autoUpdater.checkForUpdatesAndNotify();
    }
    mainWindow.show();
  });
}

function sendUpdateStatusToRenderer(text, type = "info", percent = null) {
  if (mainWindow) {
    mainWindow.webContents.send("update-message", {
      message: text,
      type,
      percent,
    });
  }
}

app.whenReady().then(async () => {
  await setupDatabase();
  registerDatabaseIPC();
  cleanOldLogs(); // Chạy dọn dẹp log cũ khi khởi động

  // --- Cấu hình và kiểm tra cập nhật tự động ---
  autoUpdater.logger = log;

  // Cấu hình tự động tải và cài đặt
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatusToRenderer("Đang kiểm tra cập nhật mới...");
  });
  autoUpdater.on("update-available", (info) => {
    sendUpdateStatusToRenderer(
      "Có bản cập nhật mới! Đang tải xuống...",
      "info",
    );
  });
  autoUpdater.on("update-not-available", (info) => {
    sendUpdateStatusToRenderer("Bạn đang dùng phiên bản mới nhất.", "success");
  });
  autoUpdater.on("error", (err) => {
    log.error("Lỗi Auto-Updater:", err); // Ghi log chi tiết lỗi vào file
    sendUpdateStatusToRenderer(`Lỗi cập nhật: ${err.message}`, "error");
  });
  autoUpdater.on("download-progress", (progressObj) => {
    sendUpdateStatusToRenderer(
      `Đang tải: ${Math.round(progressObj.percent)}%`,
      "downloading",
      Math.round(progressObj.percent),
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatusToRenderer(
      "Bản cập nhật đã sẵn sàng. Bạn có muốn khởi động lại để cài đặt ngay không?",
      "downloaded",
    );
  });

  createSplashWindow(); // Hiện màn hình chờ trước
  createMainWindow(); // Load dữ liệu ngầm
});

ipcMain.on("install-update", () => {
  autoUpdater.quitAndInstall();
});

// Hàm tự động giữ lại tối đa 5 file log gần nhất
function cleanOldLogs() {
  try {
    const logFile = log.transports.file.getFile();
    const logDir = path.dirname(logFile.path);
    if (!fs.existsSync(logDir)) return;

    // Lấy danh sách file kèm theo thông tin thời gian sửa đổi
    const files = fs
      .readdirSync(logDir)
      .map((file) => {
        const filePath = path.join(logDir, file);
        return {
          name: file,
          path: filePath,
          mtime: fs.statSync(filePath).mtimeMs,
        };
      })
      // Sắp xếp theo thời gian sửa đổi giảm dần (file mới nhất đứng đầu)
      .sort((a, b) => b.mtime - a.mtime);

    const maxFiles = 5;
    if (files.length > maxFiles) {
      // Lấy các file từ vị trí thứ 6 trở đi để xóa
      files.slice(maxFiles).forEach((file) => {
        fs.unlinkSync(file.path);
        log.info(
          `Đã xóa file log cũ (vượt quá giới hạn ${maxFiles} file): ${file.name}`,
        );
      });
    }
  } catch (err) {
    console.error("Lỗi khi dọn dẹp log:", err);
  }
}

// IPC để mở thư mục Log khi người dùng cần kiểm tra lỗi
ipcMain.handle("open-logs-folder", () => {
  const logPath = path.dirname(log.transports.file.getFile().path);
  shell.openPath(logPath);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
