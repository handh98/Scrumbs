// --- DOM Helper ---
window.$ = (id) => document.getElementById(id);
window.$$ = (sel) => document.querySelectorAll(sel);

/** @type {boolean} Trạng thái cập nhật ngầm */
window.isUpdateModalDismissed = false;

window.loadCSS = (filename) => {
  const id = `css-${filename.replace(".", "-")}`;
  if (!$(id)) {
    const link = document.createElement("link");
    Object.assign(link, {
      id,
      rel: "stylesheet",
      href: `./src/renderer/css/${filename}`,
    });
    document.head.appendChild(link);
  }
};

/**
 * Dynamically loads an HTML component and its CSS.
 * @param {string} name - Component name.
 * @returns {Promise<boolean>} Success status.
 */
window.loadComponent = async (name) => {
  window.loadCSS(`${name}.css`);
  const componentId = `${name}-wrapper`;
  if ($(componentId)) return true;

  try {
    const response = await fetch(`./src/renderer/components/${name}.html`);
    if (!response.ok) throw new Error(`Lỗi nạp file: ${name}.html`);

    const wrapper = document.createElement("div");
    wrapper.id = componentId;
    // Giải pháp triệt để: Mọi wrapper của component đều không được chặn click
    wrapper.style.pointerEvents = "none";
    wrapper.innerHTML = await response.text();
    document.body.appendChild(wrapper);
    return true;
  } catch (err) {
    console.error(`Lỗi nạp component ${name}:`, err);
    return false;
  }
};

/**
 * Displays a customized confirmation modal.
 * @param {string} title
 * @param {string} message
 * @param {Object} [options={}] - Custom icon, button text, progress bar etc.
 * @returns {Promise<boolean|string>} User decision.
 */
window.showConfirm = async (title, message, options = {}) => {
  await window.loadComponent("confirm-modal");
  return new Promise((resolve) => {
    const modal = $("confirm-modal");
    if (modal.querySelector("#confirm-modal-title"))
      modal.querySelector("#confirm-modal-title").innerText = title;
    if (modal.querySelector("#confirm-modal-message"))
      modal.querySelector("#confirm-modal-message").innerText = message;

    const iconEl = modal.querySelector("#confirm-modal-icon");
    if (iconEl) iconEl.innerHTML = options.icon || "❓";

    const confirmBtn = $("confirm-modal-confirm-btn");
    const cancelBtn = $("confirm-modal-cancel-btn");
    const bgBtn = $("confirm-modal-bg-btn");

    if (confirmBtn) confirmBtn.innerText = options.confirmText || "Đồng ý";
    if (confirmBtn) confirmBtn.disabled = !!options.disableConfirm;
    if (cancelBtn) cancelBtn.innerText = options.cancelText || "Hủy";
    if (bgBtn) {
      bgBtn.style.display = options.backgroundText ? "inline-block" : "none";
      bgBtn.innerText = options.backgroundText || "";
    }

    const progressWrapper = $("confirm-modal-progress-wrapper");
    if (progressWrapper)
      progressWrapper.style.display = options.showProgress ? "block" : "none";

    modal.classList.add("flex"); //
    modal.style.pointerEvents = "auto"; // Chỉ chặn click khi modal thực sự hiện lên

    if (confirmBtn) {
      confirmBtn.classList.remove("btn-loading");
      confirmBtn.disabled = false;
      confirmBtn.onclick = () => {
        if (options.showLoadingOnConfirm) {
          confirmBtn.classList.add("btn-loading");
          confirmBtn.disabled = true;
          if (cancelBtn) cancelBtn.style.display = "none";
        } else {
          modal.classList.remove("flex");
          modal.style.pointerEvents = "none"; // Giải phóng khi đóng modal
        }
        resolve(true);
      };
    }
    if (cancelBtn) cancelBtn.style.display = "inline-block";
    cancelBtn.onclick = () => {
      modal.classList.remove("flex");
      modal.style.pointerEvents = "none";
      resolve(false);
    };

    if (bgBtn) {
      bgBtn.onclick = () => {
        modal.classList.remove("flex");
        modal.style.pointerEvents = "none";
        resolve("background");
      };
    }
  });
};

window.showPrompt = (title, message, defaultValue = "") => {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "confirm-modal-overlay";
    modal.classList.add("flex");
    modal.innerHTML = `
      <div class="confirm-modal-card fade-in">
        <h4 class="mb-xs" style="color: var(--color-primary-text);">${title}</h4>
        <p>${message}</p>
        <textarea class="prompt-input" rows="3">${defaultValue}</textarea>
        <div class="confirm-modal-actions">
          <button class="btn-secondary btn-cancel">Hủy</button>
          <button class="btn-primary btn-ok">Lưu</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector(".prompt-input");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    modal.querySelector(".btn-ok").onclick = () => {
      resolve(input.value);
      modal.remove();
    };
    modal.querySelector(".btn-cancel").onclick = () => {
      resolve(null);
      modal.remove();
    };
  });
};

/**
 * Updates the progress bar within an open confirmation modal.
 * @param {number} percent
 * @param {string} message
 */
window.updateConfirmProgress = (percent, message) => {
  const bar = $("confirm-modal-progress-bar");
  const text = $("confirm-modal-progress-text");
  const wrapper = $("confirm-modal-progress-wrapper");
  if (wrapper) wrapper.style.display = "block";
  if (bar) bar.style.width = `${percent}%`;
  if (text && message) text.innerText = message;
};

/**
 * Displays a temporary toast notification.
 * @param {string} msg
 * @param {string} [type='success'] - success, error, warning.
 */
window.showToast = async (msg, type = "success") => {
  await window.loadComponent("toast");

  // Đảm bảo wrapper và container không chặn tương tác chuột của các phần tử bên dưới
  const wrapper = $("toast-wrapper");
  if (wrapper) wrapper.style.pointerEvents = "none";

  const container = $("toast-container");
  if (container) container.style.pointerEvents = "none";

  const toast = document.createElement("div");
  toast.className = `toast toast-${type} fade-in`;
  // Chỉ cho phép tương tác chuột trên chính thẻ thông báo (ví dụ để tắt hoặc hover)
  toast.style.pointerEvents = "auto";

  const icon =
    { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" }[type] || "🔔";
  toast.innerHTML = `<span>${icon}</span> ${msg}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 500);
  }, 3000);
};

// Thêm biến đếm để xử lý các lời gọi showLoader lồng nhau
let loaderCount = 0;

window.showLoader = async (show) => {
  let loader = $("app-loader");
  if (!loader) {
    // Nếu loader chưa có trong DOM, nạp component và thử tìm lại
    if (show) await window.loadComponent("loader");
    loader = $("app-loader");
    if (!loader) {
      console.warn("Loader element 'app-loader' not found.");
      return;
    }
  }

  if (show) {
    loaderCount++;
    loader.classList.add("flex");
    loader.classList.remove("hidden");
    loader.style.pointerEvents = "auto"; // Đảm bảo chặn tương tác khi loader hiện
  } else {
    loaderCount = Math.max(0, loaderCount - 1); // Giảm số đếm, không âm
    if (loaderCount === 0) {
      // Chỉ ẩn loader khi không còn lời gọi nào yêu cầu hiển thị
      loader.classList.remove("flex");
      loader.classList.add("hidden");
      loader.style.pointerEvents = "none"; // Quan trọng: Giải phóng tương tác khi loader ẩn
    }
  }
};

// --- Utilities Phân trang ---
window.getPagination = (data, itemsPerPage, currentPage, onPageChange) => {
  const totalPages = Math.ceil(data.length / itemsPerPage);
  const start = (currentPage - 1) * itemsPerPage;

  window.changePageHandler = onPageChange;

  let html = `<button class="page-btn" ${currentPage === 1 ? "disabled" : ""} onclick="window.changePageHandler(${currentPage - 1})">&lt;</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - 1 && i <= currentPage + 1)
    ) {
      html += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="window.changePageHandler(${i})">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<span class="page-dots">...</span>`;
    }
  }

  html += `<button class="page-btn" ${currentPage === totalPages || totalPages === 0 ? "disabled" : ""} onclick="window.changePageHandler(${currentPage + 1})">&gt;</button>`;

  return { data: data.slice(start, start + itemsPerPage), html };
};

// --- Debounce Helper ---
window.debounce = (func, wait) => {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// --- Tooltip Reusable Component ---
window.TooltipComponent = {
  init() {
    const tooltip = $("choc-tooltip");
    if (!tooltip) return;

    document.addEventListener("mousemove", (e) => {
      const target = e.target.closest(".has-tooltip");
      if (!target) return tooltip.classList.remove("show");

      const content = target.getAttribute("data-note");
      if (!content) return;

      tooltip.innerText = content;
      tooltip.classList.add("show");
      tooltip.style.top = `${e.clientY - tooltip.offsetHeight - 15}px`;
      tooltip.style.left = `${e.clientX + 10}px`;
    });

    document.addEventListener("mouseout", (e) => {
      if (e.target.closest(".has-tooltip")) tooltip.classList.remove("show");
    });
  },
};

// =========================================================
// --- UTILITIES XỬ LÝ ĐỊNH DẠNG SỐ (FORMAT NUMBER) ---
// =========================================================

// 1. Chuyển chuỗi '1,000' thành số 1000 để tính toán
window.unformatNumber = (str) => {
  if (!str) return 0;
  return parseFloat(str.toString().replace(/,/g, "")) || 0;
};

// 2. Chuyển số 1000 thành chuỗi '1,000' để hiển thị
window.formatNumber = (number) => {
  if (number === null || number === undefined || number === "") return "";
  const num = parseFloat(number);
  if (isNaN(num)) return "";
  // Hỗ trợ hiển thị tối đa 3 chữ số thập phân
  return num.toLocaleString("en-US", { maximumFractionDigits: 3 });
};

// 3. Loại bỏ dấu tiếng Việt để tìm kiếm không dấu (Accent-insensitive search)
const accentCache = new Map();
window.removeAccents = (str) => {
  if (!str) return "";
  const cached = accentCache.get(str);
  if (cached !== undefined) return cached;

  const result = str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (m) => (m === "đ" ? "d" : "D"))
    .toLowerCase()
    .trim();

  if (accentCache.size > 2000) accentCache.clear();
  accentCache.set(str, result);
  return result;
};

/**
 * Wraps matching text segments with a <mark> tag for search highlighting.
 * @param {string} text
 * @param {string} query
 * @returns {string} HTML string with highlights.
 */
window.highlightMatch = (text, query) => {
  if (!query || !text) return text;
  const cleanText = window.removeAccents(text);
  const cleanQuery = window.removeAccents(query);
  const index = cleanText.indexOf(cleanQuery);

  if (index >= 0) {
    const originalPart = text.substring(index, index + query.length);
    return (
      text.substring(0, index) +
      `<mark class="search-highlight">${originalPart}</mark>` +
      text.substring(index + query.length)
    );
  }
  return text;
};

// 3. Xử lý trực tiếp khi gõ vào ô input (Chống nhảy chuột, cho phép nhập số thập phân)
window.formatInputOnType = (inputElement) => {
  let cursorPosition = inputElement.selectionStart;
  let originalLength = inputElement.value.length;

  // Chỉ cho phép nhập số và 1 dấu chấm thập phân
  let rawValue = inputElement.value.replace(/[^0-9.]/g, "");
  const parts = rawValue.split(".");
  if (parts.length > 2) {
    parts[1] = parts.slice(1).join("");
    rawValue = parts[0] + "." + parts[1];
  }

  if (rawValue === "") {
    inputElement.value = "";
    return;
  }

  let formattedValue;
  if (rawValue.includes(".")) {
    const [integerPart, decimalPart] = rawValue.split(".");
    const formattedInt = integerPart
      ? Number(integerPart).toLocaleString("en-US")
      : "0";
    formattedValue = formattedInt + "." + decimalPart;
  } else {
    formattedValue = Number(rawValue).toLocaleString("en-US");
  }

  inputElement.value = formattedValue;

  let newLength = formattedValue.length;
  cursorPosition = cursorPosition + (newLength - originalLength);
  inputElement.setSelectionRange(cursorPosition, cursorPosition);
};

/**
 * Clears a specific window-level cache and optionally reloads the data.
 * @param {string} sourceKey - Window property key.
 * @param {Function} [reloadFunc] - Async function to refresh data.
 */
window.invalidateAndReload = async (sourceKey, reloadFunc) => {
  window[sourceKey] = null;
  if (typeof reloadFunc === "function") {
    await reloadFunc();
  }
};

// ==========================================
// --- APP CORE & INITIALIZATION ---
// ==========================================

async function setupGlobalUI() {
  try {
    const version = await window.electronAPI.getAppVersion();
    document.title = `Crumbs - v${version}`;

    window.loadCSS("global.css");
    await window.loadComponent("tooltip");
    if (typeof window.TooltipComponent !== "undefined")
      window.TooltipComponent.init();

    // Lắng nghe trạng thái Database (Migration)
    window.electronAPI.onMigrationUpdate?.((data) => {
      if (data.type === "loading") window.showLoader(true);
      if (data.type === "success") window.showLoader(false);
      window.showToast(
        data.message,
        data.type === "loading" ? "info" : data.type,
      );
    });

    // Lắng nghe Update ứng dụng
    window.electronAPI.onUpdateMessage?.((data) => {
      if (data.type === "downloading")
        return toggleUpdateIndicator(true, data.percent);
      if (data.type === "error") {
        window.showLoader(false);
        toggleUpdateIndicator(false);
        if (window.isUpdateModalDismissed) {
          window
            .showConfirm(
              "Lỗi cập nhật ⚠️", // Icon đã được xử lý trong showConfirm
              "Quá trình tải bản cập nhật bị gián đoạn. Kiểm tra kết nối mạng?",
            )
            .then((c) => {
              if (c === false) window.electronAPI.openLogsFolder();
            });
        }
        window.isUpdateModalDismissed = false;
      }
      if (data.type === "downloaded") {
        toggleUpdateIndicator(false);
        window
          .showConfirm(
            "Sẵn sàng nâng cấp! ✨", // Icon đã được xử lý trong showConfirm
            "Phiên bản mới đã tải xong. Cập nhật ngay?",
            { confirmText: "Cập nhật", showLoadingOnConfirm: true },
          )
          .then((c) => c && window.electronAPI.installUpdate());
      } else {
        window.showToast(
          data.message,
          data.type === "loading" ? "info" : data.type,
        );
      }
    });
  } catch (err) {
    console.error("Lỗi khởi tạo UI:", err);
  }
}

function toggleUpdateIndicator(show, percent = 0) {
  let indicator = $("bg-update-indicator");
  if (show) {
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "bg-update-indicator";
      indicator.className = "update-bg-badge";
      indicator.innerHTML = `<div class="spinner-mini"></div><div class="update-progress-container"><div class="update-progress-fill"></div></div><span class="percent-text">0%</span>`;
      indicator.onclick = () => {
        //
        window.isUpdateModalDismissed = false;
        indicator.classList.add("hidden");
        indicator.classList.remove("flex");
      };
      document.body.appendChild(indicator);
    }
    indicator.style.display = "flex";
    const fill = indicator.querySelector(".update-progress-fill");
    indicator.querySelector(".percent-text").innerText = `${percent}%`;
    fill.style.width = `${percent}%`;
    fill.classList.toggle("is-nearly-done", percent >= 90);
  } else if (indicator) {
    indicator.classList.add("hidden");
    indicator.classList.remove("flex");
  }
}

async function initApp() {
  if (window.electronAPI?.db_query) {
    await setupGlobalUI();
    if (typeof navigate === "function") navigate("dashboard");
  } else {
    requestAnimationFrame(initApp);
  }
}

initApp();
