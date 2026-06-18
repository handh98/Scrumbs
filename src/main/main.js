const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  protocol,
} = require("electron");
const path = require("path");
const fs = require("fs");
const {
  setupDatabase,
  dbManager,
  setMainWindow,
} = require("./database/database.js");
const { autoUpdater } = require("electron-updater");
const { registerDatabaseIPC } = require("./ipc/databaseIPC.js");
const log = require("electron-log");
const ExcelJS = require("exceljs");

// --- Đăng ký các Protocol đặc quyền trước khi App Ready ---
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app-img",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

// --- Cấu hình Logger ---
log.transports.file.level = "info";
// Tùy chỉnh tên file và vị trí: mặc định ở %AppData%/crumbs-app/logs/main.log
log.transports.file.fileName = "update.log";
log.transports.file.maxSize = 5 * 1024 * 1024; // Giới hạn 5MB mỗi file log

// Ghi log thông tin khởi động
log.info("--- Ứng dụng Crumbs đang khởi động ---");
log.info(`Phiên bản: ${app.getVersion()}`);
log.info(`Nền tảng: ${process.platform} (${process.arch})`);
log.info(`Đường dẫn ứng dụng (app.getAppPath()): ${app.getAppPath()}`);
log.info(`Đường dẫn DB: ${path.join(app.getPath("userData"), "bakery.db")}`);

// --- Xử lý lỗi hệ thống để app không thoát đột ngột ---

// Bắt lỗi từ các Promise bị rejected mà không có .catch()
process.on("unhandledRejection", (reason, promise) => {
  log.error("🚨 Unhandled Rejection tại:", promise, "Lý do:", reason);

  // Tùy chọn: Hiển thị thông báo cho người dùng thay vì thoát app
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Lỗi hệ thống (Promise)",
      message:
        "Đã xảy ra lỗi không mong muốn trong tiến trình chính. Vui lòng kiểm tra nhật ký.",
      detail: reason?.stack || reason?.toString(),
    });
  }
});

// Bắt các lỗi đồng bộ chưa được xử lý
process.on("uncaughtException", (error) => {
  log.error("🚨 Uncaught Exception:", error);

  dialog.showErrorBox(
    "Lỗi ứng dụng nghiêm trọng",
    `Đã xảy ra lỗi hệ thống: ${error.message}\n\nỨng dụng sẽ cố gắng tiếp tục chạy, nhưng một số tính năng có thể không ổn định.`,
  );

  // Thông thường với uncaughtException, app nên được khởi động lại nếu lỗi quá nặng
});

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

/**
 * Creates and initializes the main application window.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    show: false, // QUAN TRỌNG: Ẩn đi cho đến khi load xong
    icon: path.join(__dirname, "../renderer/assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, "..", "..", "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) splashWindow.destroy();
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        log.error("Lỗi khi kiểm tra cập nhật:", err);
        // Chỉ ghi log, không làm gián đoạn trải nghiệm người dùng nếu lỗi chỉ là 404 hoặc mạng
        sendUpdateStatusToRenderer(
          "Không thể kết nối máy chủ cập nhật.",
          "error",
        );
      });
    }
    mainWindow.show();
  });
}

/**
 * Sends auto-update status information to the renderer process.
 * @param {string} text - The message text.
 * @param {string} [type='info'] - Message category.
 * @param {number|null} [percent=null] - Progress percentage.
 */
function sendUpdateStatusToRenderer(text, type = "info", percent = null) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-message", {
      message: text,
      type,
      percent,
    });
  }
}

app.whenReady().then(async () => {
  // IPC để lấy đường dẫn tuyệt đối đến một tài sản trong thư mục assets
  ipcMain.handle("get-asset-path", (event, assetName) => {
    // Sử dụng path.resolve để đảm bảo đường dẫn tuyệt đối chuẩn xác
    const fullPath = path.join(
      __dirname,
      "..",
      "renderer",
      "assets",
      assetName,
    );

    console.log(`[DEBUG IPC] Yêu cầu lấy asset: ${assetName}`);
    console.log(`[DEBUG IPC] Đường dẫn tìm kiếm: ${fullPath}`);
    console.log(
      `[DEBUG IPC] Tình trạng file: ${fs.existsSync(fullPath) ? "ĐÃ TÌM THẤY ✅" : "KHÔNG TỒN TẠI ❌"}`,
    );
    return fullPath;
  });

  await setupDatabase();
  registerDatabaseIPC();
  cleanOldLogs();

  protocol.handle("app-img", async (request) => {
    try {
      const url = new URL(request.url);
      // Giải mã ký tự đặc biệt (khoảng trắng, dấu tiếng Việt)
      let filePath = decodeURIComponent(url.pathname);

      if (process.platform === "win32") {
        // Trường hợp ổ đĩa bị nhảy vào phần host (app-img://D:/...)
        if (url.host && /^[a-zA-Z]$/.test(url.host)) {
          filePath =
            url.host +
            ":" +
            (filePath.startsWith("/") ? filePath : "/" + filePath);
        } else if (filePath.startsWith("/")) {
          filePath = filePath.slice(1);
        }

        // Đảm bảo LUÔN có dấu \ sau ổ đĩa để tránh lỗi "drive-relative path" (D:Folder -> D:\Folder)
        if (/^[a-zA-Z]:[^\\]/.test(filePath)) {
          filePath = filePath.replace(/^([a-zA-Z]:)/, "$1\\");
        }
      }

      filePath = path.normalize(filePath);

      console.log(`[DEBUG Protocol] Đang nạp ảnh qua app-img: ${filePath}`);
      const buffer = fs.readFileSync(filePath);

      // Xác định Content-Type dựa trên phần mở rộng của file
      let contentType = "application/octet-stream"; // Mặc định
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".png") {
        contentType = "image/png";
      } else if (ext === ".jpg" || ext === ".jpeg") {
        contentType = "image/jpeg";
      } else if (ext === ".gif") {
        contentType = "image/gif";
      } else if (ext === ".svg") {
        contentType = "image/svg+xml";
      }

      return new Response(buffer, {
        headers: { "Content-Type": contentType },
      });
    } catch (err) {
      console.error(`[app-img] Lỗi:`, err);
      // Log chi tiết lỗi ENOENT để dễ debug hơn
      if (err.code === "ENOENT") {
        console.error(
          `[app-img] Lỗi ENOENT: Không tìm thấy tệp tại đường dẫn: ${err.path}`,
        );
      }
      return new Response("Not Found", { status: 404 });
    }
  });

  // IPC cho Sticky Notes
  ipcMain.handle("get-sticky-notes", async () => {
    return await dbManager.all("SELECT * FROM sticky_notes ORDER BY id DESC");
  });
  ipcMain.handle("save-sticky-note", async (event, { content, color }) => {
    return await dbManager.run(
      "INSERT INTO sticky_notes (content, color) VALUES (?, ?)",
      [content, color],
    );
  });
  ipcMain.handle("delete-sticky-note", async (event, id) => {
    return await dbManager.run("DELETE FROM sticky_notes WHERE id = ?", [id]);
  });
  ipcMain.handle("update-sticky-note", async (event, { id, content }) => {
    return await dbManager.run(
      "UPDATE sticky_notes SET content = ? WHERE id = ?",
      [content, id],
    );
  });

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatusToRenderer("Đang kiểm tra cập nhật mới...");
  });
  autoUpdater.on("update-available", () => {
    sendUpdateStatusToRenderer(
      "Có bản cập nhật mới! Đang tải xuống...",
      "info",
    );
  });
  autoUpdater.on("update-not-available", () => {
    sendUpdateStatusToRenderer("Bạn đang dùng phiên bản mới nhất.", "success");
  });
  autoUpdater.on("error", (err) => {
    sendUpdateStatusToRenderer(`Lỗi cập nhật: ${err.message}`, "error");
  });
  let lastPercent = -1;
  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent);
    if (percent !== lastPercent) {
      lastPercent = percent;
      sendUpdateStatusToRenderer(
        `Đang tải: ${percent}%`,
        "downloading",
        percent,
      );
    }
  });
  autoUpdater.on("update-downloaded", () => {
    sendUpdateStatusToRenderer(
      "Bản cập nhật đã sẵn sàng. Bạn có muốn khởi động lại để cài đặt ngay không?",
      "downloaded",
    );
  });

  createSplashWindow(); // Hiện màn hình chờ trước
  createMainWindow(); // Load dữ liệu ngầm
  setMainWindow(mainWindow); // Register main window with database module
});

// Trình xử lý lấy version ứng dụng
ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("install-update", () => {
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
      .sort((a, b) => b.mtime - a.mtime);

    const maxFiles = 5;
    if (files.length > maxFiles) {
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

// IPC xử lý xuất Excel
ipcMain.handle(
  "export-statistics-excel",
  async (event, { orders, products, fileName }) => {
    try {
      const workbook = new ExcelJS.Workbook();

      const sheet1 = workbook.addWorksheet("Doanh Thu Chi Tiết");
      if (orders.length > 0) {
        const headerKeys = Object.keys(orders[0]);
        sheet1.columns = headerKeys.map((key) => ({
          header: key,
          key: key,
          width: key === "Khách hàng" ? 25 : 15,
        }));
        sheet1.addRows(orders);

        const headerRow = sheet1.getRow(1);
        headerRow.font = {
          name: "Arial",
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        headerRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF6366F1" },
        };
        headerRow.alignment = { vertical: "middle", horizontal: "center" };
      }

      const sheet2 = workbook.addWorksheet("Thống Kê Sản Phẩm");
      if (products.length > 0) {
        const productKeys = Object.keys(products[0]);
        sheet2.columns = productKeys.map((key) => ({
          header: key,
          key: key,
          width: 30,
        }));
        sheet2.addRows(products);

        const headerRow2 = sheet2.getRow(1);
        headerRow2.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow2.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF10B981" },
        };
        headerRow2.alignment = { vertical: "middle", horizontal: "center" };
      }

      const { filePath } = await dialog.showSaveDialog({
        title: "Lưu báo cáo doanh thu",
        defaultPath: fileName,
        filters: [{ name: "Excel Files", extensions: ["xlsx"] }],
      });

      if (filePath) {
        await workbook.xlsx.writeFile(filePath);
        return { success: true, path: filePath };
      }
      return { success: false };
    } catch (error) {
      log.error("Lỗi xuất Excel:", error);
      throw error;
    }
  },
);

// IPC xử lý xuất PDF công thức
ipcMain.handle("export-recipe-pdf", async (event, recipeData) => {
  let pdfWindow; // Khai báo ngoài try để khối finally có thể truy cập
  try {
    pdfWindow = new BrowserWindow({
      show: false, // In ngầm không hiển thị UI
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const pdfTemplatePath = path.join(__dirname, "recipe-pdf-template.html");

    await pdfWindow.loadFile(pdfTemplatePath);

    await pdfWindow.webContents.executeJavaScript(`
      window.renderRecipePdf(${JSON.stringify(recipeData)});
    `);

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Lưu công thức PDF",
      defaultPath: `${recipeData.name.replace(/[^a-zA-Z0-9 ]/g, "")}_${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });

    if (filePath) {
      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        landscape: false, // Chế độ dọc
        pageSize: "A4",
        margins: {
          top: 0, // Đặt margins = 0 trong core để tránh lỗi margins > pageSize
          // Lề thực tế sẽ được điều chỉnh bằng CSS trong file template HTML
          bottom: 0,
          left: 0,
          right: 0,
        },
      });
      fs.writeFileSync(filePath, pdfBuffer);
      return { success: true, path: filePath };
    }
    return { success: false };
  } catch (error) {
    log.error("Lỗi xuất PDF công thức:", error);
    throw error;
  } finally {
    // Đảm bảo cửa sổ ẩn luôn được đóng ngay cả khi có lỗi xảy ra
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
});

// IPC xử lý xóa file ảnh công thức
ipcMain.handle("delete-recipe-image-file", async (event, filePath) => {
  if (!filePath) return { success: false, message: "Đường dẫn file rỗng." };

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.info(`Đã xóa file ảnh: ${filePath}`);
      return { success: true };
    }
    return { success: false, message: "File không tồn tại." };
  } catch (error) {
    log.error(`Lỗi khi xóa file ảnh ${filePath}:`, error);
    return { success: false, message: error.message };
  }
});

// IPC xử lý lưu file ảnh công thức
ipcMain.handle("save-recipe-image", async (event, tempImagePath) => {
  if (!tempImagePath || tempImagePath.includes("fakepath")) {
    log.error("Lưu ảnh thất bại: Đường dẫn không hợp lệ hoặc bị fakepath.");
    return null;
  }

  try {
    const appDataPath = app.getPath("userData");
    const recipeImagesDir = path.join(appDataPath, "recipe_images");

    if (!fs.existsSync(recipeImagesDir)) {
      fs.mkdirSync(recipeImagesDir, { recursive: true });
    }

    const safeFileName = path
      .basename(tempImagePath)
      .replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${Date.now()}_${safeFileName}`;
    const destPath = path.join(recipeImagesDir, fileName);

    if (!fs.existsSync(tempImagePath))
      throw new Error("Tệp nguồn không tồn tại.");

    fs.copyFileSync(tempImagePath, destPath);
    log.info(`Đã lưu ảnh công thức: ${destPath}`);
    return destPath;
  } catch (error) {
    log.error("Lỗi khi lưu ảnh công thức:", error);
    throw new Error(`Không thể lưu ảnh: ${error.message}`, { cause: error });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
