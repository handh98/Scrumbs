// --- DOM Helper ---
window.$ = (id) => document.getElementById(id);
window.$$ = (sel) => document.querySelectorAll(sel);

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

window.loadComponent = async (name) => {
  window.loadCSS(`${name}.css`);
  const componentId = `${name}-wrapper`;
  if ($(componentId)) return true;

  try {
    const response = await fetch(`./src/renderer/components/${name}.html`);
    if (!response.ok) throw new Error(`Lỗi nạp file: ${name}.html`);

    const wrapper = document.createElement("div");
    wrapper.id = componentId;
    wrapper.innerHTML = await response.text();
    document.body.appendChild(wrapper);
    return true;
  } catch (err) {
    console.error(`Lỗi nạp component ${name}:`, err);
    return false;
  }
};

window.showConfirm = async (title, message, options = {}) => {
  await window.loadComponent("confirm-modal");
  return new Promise((resolve) => {
    const modal = $("confirm-modal");
    if (modal.querySelector("#confirm-modal-title"))
      modal.querySelector("#confirm-modal-title").innerText = title;
    if (modal.querySelector("#confirm-modal-message"))
      modal.querySelector("#confirm-modal-message").innerText = message;

    // Hỗ trợ hiển thị icon nếu có (ví dụ: emoji hoặc SVG)
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

    modal.style.display = "flex";

    if (confirmBtn) {
      confirmBtn.classList.remove("btn-loading");
      confirmBtn.disabled = false;
      confirmBtn.onclick = () => {
        if (options.showLoadingOnConfirm) {
          confirmBtn.classList.add("btn-loading");
          confirmBtn.disabled = true;
          if (cancelBtn) cancelBtn.style.display = "none";
        } else {
          modal.style.display = "none";
        }
        resolve(true);
      };
    }
    if (cancelBtn) cancelBtn.style.display = "inline-block";
    cancelBtn.onclick = () => {
      modal.style.display = "none";
      resolve(false);
    };

    if (bgBtn) {
      bgBtn.onclick = () => {
        modal.style.display = "none";
        resolve("background");
      };
    }
  });
};

window.updateConfirmProgress = (percent, message) => {
  const bar = $("confirm-modal-progress-bar");
  const text = $("confirm-modal-progress-text");
  const wrapper = $("confirm-modal-progress-wrapper");
  if (wrapper) wrapper.style.display = "block";
  if (bar) bar.style.width = `${percent}%`;
  if (text && message) text.innerText = message;
};

window.showToast = async (msg, type = "success") => {
  await window.loadComponent("toast");
  const container = $("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type} fade-in`;
  toast.innerHTML = `<span>${{ success: "✅", error: "❌", warning: "⚠️" }[type]}</span> ${msg}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 500);
  }, 3000);
};

window.showLoader = async (show) => {
  if (show) await window.loadComponent("loader");
  const loader = $("app-loader");
  if (loader) loader.style.display = show ? "flex" : "none";
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
      tooltip.style.left = `${e.clientX}px`;
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

  let formattedValue = "";
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

  // Tính toán lại vị trí chuột
  let newLength = formattedValue.length;
  cursorPosition = cursorPosition + (newLength - originalLength);
  inputElement.setSelectionRange(cursorPosition, cursorPosition);
};

/**
 * Xóa cache của một module và nạp lại dữ liệu
 * @param {string} sourceKey - Tên biến cache trên window
 * @param {function} reloadFunc - Hàm load lại dữ liệu
 */
window.invalidateAndReload = async (sourceKey, reloadFunc) => {
  window[sourceKey] = null;
  if (typeof reloadFunc === "function") {
    await reloadFunc();
  }
};
