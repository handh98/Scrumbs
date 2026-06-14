const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  protocol,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL, fileURLToPath } = require("url");
const { setupDatabase } = require("./database/database");
const { autoUpdater } = require("electron-updater");
const { registerDatabaseIPC } = require("./ipc/databaseIPC");
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

  // Đăng ký protocol để load ảnh từ ổ đĩa (tránh lỗi bảo mật Not allowed to load local resource)
  protocol.handle("app-img", (request) => {
    try {
      // Bóc tách URL để lấy đường dẫn tệp tin thực tế
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);

      if (process.platform === "win32") {
        // Fix lỗi Chromium chuẩn hóa ổ đĩa trên Windows:
        // Nếu URL có dạng app-img://c/path thì 'c' sẽ nằm ở host
        if (url.host && /^[a-zA-Z]$/.test(url.host)) {
          filePath = url.host + ":" + filePath;
        } else if (filePath.startsWith("/")) {
          // Trường hợp pathname bắt đầu bằng /C:/...
          filePath = filePath.slice(1);
        }
        filePath = path.normalize(filePath);
      } else {
        filePath = path.normalize(filePath);
      }

      // Sử dụng net.fetch kết hợp pathToFileURL để hỗ trợ streaming và OneDrive
      // Cách này giúp Chromium tự động quản lý Mime-type và kích thước tệp.
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      log.error(`[app-img] Lỗi xử lý request ${request.url}:`, err);
      return new Response("Not Found", { status: 404 });
    }
  });

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

// IPC xử lý xuất Excel
ipcMain.handle(
  "export-statistics-excel",
  async (event, { orders, products, fileName }) => {
    try {
      const workbook = new ExcelJS.Workbook();

      // --- SHEET 1: CHI TIẾT DOANH THU ---
      const sheet1 = workbook.addWorksheet("Doanh Thu Chi Tiết");
      if (orders.length > 0) {
        const headerKeys = Object.keys(orders[0]);
        sheet1.columns = headerKeys.map((key) => ({
          header: key,
          key: key,
          width: key === "Khách hàng" ? 25 : 15,
        }));
        sheet1.addRows(orders);

        // Định dạng tiêu đề cho Sheet 1
        const headerRow = sheet1.getRow(1);
        headerRow.font = {
          name: "Arial",
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        headerRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF6366F1" }, // Màu Indigo (giống biểu đồ)
        };
        headerRow.alignment = { vertical: "middle", horizontal: "center" };
      }

      // --- SHEET 2: THỐNG KÊ SẢN PHẨM ---
      const sheet2 = workbook.addWorksheet("Thống Kê Sản Phẩm");
      if (products.length > 0) {
        const productKeys = Object.keys(products[0]);
        sheet2.columns = productKeys.map((key) => ({
          header: key,
          key: key,
          width: 30,
        }));
        sheet2.addRows(products);

        // Định dạng tiêu đề cho Sheet 2
        const headerRow2 = sheet2.getRow(1);
        headerRow2.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow2.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF10B981" }, // Màu Emerald xanh lá
        };
        headerRow2.alignment = { vertical: "middle", horizontal: "center" };
      }

      // Hiển thị hộp thoại lưu file
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

    // Nạp HTML template cho PDF
    // Dựa trên cấu trúc file hiện tại, file nằm cùng thư mục với main.js (src/main/)
    const pdfTemplatePath = path.join(__dirname, "recipe-pdf-template.html");

    await pdfWindow.loadFile(pdfTemplatePath);

    // Gửi dữ liệu công thức vào template HTML
    await pdfWindow.webContents.executeJavaScript(`
      window.renderRecipePdf(${JSON.stringify(recipeData)});
    `);

    // Hiển thị hộp thoại lưu file
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

    // Làm sạch tên file để tránh lỗi kí tự đặc biệt trên Windows
    const safeFileName = path
      .basename(tempImagePath)
      .replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${Date.now()}_${safeFileName}`;
    const destPath = path.join(recipeImagesDir, fileName);

    if (!fs.existsSync(tempImagePath))
      throw new Error("Tệp nguồn không tồn tại.");

    fs.copyFileSync(tempImagePath, destPath);
    log.info(`Đã lưu ảnh công thức: ${destPath}`);
    return destPath; // Trả về đường dẫn mới
  } catch (error) {
    log.error("Lỗi khi lưu ảnh công thức:", error);
    return null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
