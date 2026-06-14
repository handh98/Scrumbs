// Biến trạng thái để theo dõi nếu người dùng chọn chạy ngầm bản cập nhật
window.isUpdateModalDismissed = false;

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

        if (data.type === "error") {
          window.toggleLoader?.(false);
          toggleUpdateIndicator(false); // Tắt icon quay ở góc màn hình

          const wasBackground = window.isUpdateModalDismissed;
          window.isUpdateModalDismissed = false; // Reset để có thể hiện modal lỗi

          if (wasBackground && window.showConfirm) {
            // Nếu đang tải ngầm mà lỗi, hiện hẳn Modal để người dùng chú ý
            window
              .showConfirm(
                "Lỗi tải cập nhật ⚠️",
                `Quá trình tải bản cập nhật ngầm đã bị gián đoạn. Vui lòng kiểm tra kết nối mạng.`,
                {
                  icon: "❌",
                  confirmText: "Đã hiểu",
                  cancelText: "Xem nhật ký",
                },
              )
              .then((confirmed) => {
                if (confirmed === false) window.electronAPI.openLogsFolder();
              });
            return;
          }
        }

        if (data.type === "downloaded") {
          // Hiển thị modal xác nhận thay vì thông báo toast đơn thuần
          if (window.showConfirm) {
            window
              .showConfirm(
                "Sẵn sàng nâng cấp! ✨",
                "Phiên bản mới đã được tải về thành công. Bạn có muốn khởi động lại ứng dụng để trải nghiệm các tính năng mới ngay bây giờ không?",
                {
                  icon: "🚀",
                  confirmText: "Cập nhật ngay",
                  cancelText: "Để sau",
                  showLoadingOnConfirm: true,
                },
              )
              .then((confirmed) => {
                if (confirmed) window.electronAPI.installUpdate();
              });
          }
        } else {
          // Hiển thị các thông báo trạng thái khác (đang tải, kiểm tra...) qua toast
          if (window.showToast)
            window.showToast(
              data.message,
              data.type === "loading" ? "info" : data.type,
            );
        }
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

// Hàm quản lý icon báo hiệu tải ngầm ở góc màn hình
function toggleUpdateIndicator(show, percent = 0) {
  let indicator = document.getElementById("bg-update-indicator");

  if (show && window.isUpdateModalDismissed) {
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "bg-update-indicator";
      indicator.className = "update-bg-badge";
      indicator.title = "Đang tải bản cập nhật. Nhấn để xem chi tiết.";
      indicator.innerHTML = `
        <div class="spinner-mini"></div>
        <span class="percent-text">0%</span>
      `;

      // Khi click vào icon thì hiện lại modal
      indicator.onclick = () => {
        window.isUpdateModalDismissed = false;
        indicator.style.display = "none";
      };

      document.body.appendChild(indicator);
    }

    indicator.style.display = "flex";
    const text = indicator.querySelector(".percent-text");
    if (text) text.innerText = `${percent}%`;
  } else if (indicator) {
    indicator.style.display = "none";
  }
}

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
