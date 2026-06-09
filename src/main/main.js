const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { initDB } = require("./database/database");
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
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  initDB();
  registerDatabaseIPC();

  createSplashWindow(); // Hiện màn hình chờ trước
  createMainWindow(); // Load dữ liệu ngầm
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
