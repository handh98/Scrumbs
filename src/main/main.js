const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { initDB } = require("./database/database");
const { autoUpdater } = require("electron-updater");
const { registerDatabaseIPC } = require("./ipc/databaseIPC");

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

function sendUpdateStatusToRenderer(text, type = "info") {
  if (mainWindow) {
    mainWindow.webContents.send("update-message", { message: text, type });
  }
}

app.whenReady().then(() => {
  initDB();
  registerDatabaseIPC();

  // --- Cấu hình và kiểm tra cập nhật tự động ---
  autoUpdater.logger = require("electron-log");
  autoUpdater.logger.transports.file.level = "info";

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
    sendUpdateStatusToRenderer("Lỗi cập nhật: " + err.message, "error");
  });
  autoUpdater.on("download-progress", (progressObj) => {
    sendUpdateStatusToRenderer(
      `Đang tải: ${Math.round(progressObj.percent)}%`,
      "loading",
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatusToRenderer(
      "Tải xong! Ứng dụng sẽ khởi động lại để cập nhật.",
      "success",
    );
    autoUpdater.quitAndInstall();
  });

  createSplashWindow(); // Hiện màn hình chờ trước
  createMainWindow(); // Load dữ liệu ngầm
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
