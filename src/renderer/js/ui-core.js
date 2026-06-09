// Hàm này để nạp các thứ dùng chung như Tooltip, Modal...
async function setupGlobalUI() {
  try {
    // Tự động lấy version từ package.json thông qua main process
    const version = await window.electronAPI.getAppVersion();
    document.title = `Crumbs - v${version}`;

    // Đảm bảo nạp CSS dùng chung (bao gồm pagination, layout cơ bản...) ngay từ đầu
    window.loadCSS("global.css");
    // Nạp file tooltip.html vào trang
    await window.loadComponent("tooltip");

    // Khởi tạo bộ não xử lý hover (nằm trong utils.js hoặc tooltip.js)
    if (typeof TooltipComponent !== "undefined") {
      TooltipComponent.init();
      console.log("Hệ thống Tooltip: Đã kích hoạt");
    }

    // Lắng nghe thông báo nén/nâng cấp DB từ Main Process
    if (window.electronAPI && window.electronAPI.onMigrationUpdate) {
      window.electronAPI.onMigrationUpdate((data) => {
        console.log("DB Status:", data);
        if (data.type === "loading") window.toggleLoader(true);
        if (data.type === "success") window.toggleLoader(false);
        if (window.showToast)
          window.showToast(
            data.message,
            data.type === "loading" ? "info" : data.type,
          );
      });
    }

    // Lắng nghe thông báo cập nhật ứng dụng
    if (window.electronAPI && window.electronAPI.onUpdateMessage) {
      window.electronAPI.onUpdateMessage((data) => {
        console.log("Update Status:", data);
        if (data.type === "loading") window.toggleLoader?.(true);
        if (data.type === "success") window.toggleLoader?.(false);
        if (window.showToast)
          window.showToast(
            data.message,
            data.type === "loading" ? "info" : data.type,
          );
      });
    }
  } catch (err) {
    console.error("Không nạp được Tooltip:", err);
  }
}

// Hàm bật/tắt Loader toàn cục (Phủ lên Main Content hoặc Modal)
window.toggleLoader = (show) => {
  let loader = document.getElementById("global-app-loader");
  if (show) {
    if (!loader) {
      loader = document.createElement("div");
      loader.id = "global-app-loader";
      loader.className = "loader-embed-overlay";
      loader.style.position = "fixed"; // Phủ toàn màn hình để tránh tương tác khi đang xử lý DB
      loader.style.zIndex = "100001"; // Cao hơn cả Modal (10000)
      loader.innerHTML = '<div class="loader-spinner"></div>';
      document.body.appendChild(loader);
    }
  } else if (loader) {
    loader.remove();
  }
};

// Gọi nó ngay khi file này được load
setupGlobalUI();

// Thay vì dùng DOMContentLoaded, ta dùng cơ chế kiểm tra an toàn window.electronAPI
function checkElectronAPI() {
  if (window.electronAPI && window.electronAPI.db_query) {
    // Kích hoạt điều hướng về trang mặc định sau khi môi trường đã an toàn
    navigate("dashboard");
  } else {
    // Anti-pattern fix: Using requestAnimationFrame is better for UI responsiveness
    // than a fixed setTimeout when waiting for environment variables.
    requestAnimationFrame(checkElectronAPI);
  }
}

// Chạy kiểm tra ngay khi mở app
checkElectronAPI();
