// --- DOM Helper ---
window.$ = (id) => document.getElementById(id);
window.$$ = (sel) => document.querySelectorAll(sel);

/** Escape HTML characters for text content */
window.escHtml = (value) =>
  String(value || "").replace(
    /[&<>"]/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[ch],
  );

/** Escape characters for HTML attribute values */
window.escAttr = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );

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

    modal.classList.add("flex");
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
      <div class="confirm-modal-card fade-in" style="padding: var(--space-xl); width: 100%; max-width: 500px;">
        <h4 class="mb-xs" style="color: var(--color-primary-text); font-size: var(--font-size-h3); font-weight: bold;">${title}</h4>
        <p style="color: var(--color-text-secondary); margin-bottom: var(--space-sm);">${message}</p>
        <textarea class="prompt-input" spellcheck="false" style="width: 100%; min-height: 180px; padding: var(--space-sm); border: 1px solid #e2e8f0; border-radius: 8px; font-family: inherit; font-size: 14px; line-height: 1.6; resize: vertical; outline: none; box-sizing: border-box; margin-bottom: var(--space-md);">${defaultValue}</textarea>
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
// --- INPUT VALIDATION HELPERS ---
// ==========================================

/**
 * Validates form inputs and returns error messages if any.
 * @param {Object} fields - Object with field names and values
 * @param {Object} rules - Validation rules for each field
 * @returns {Object} Object with field names as keys and error messages as values
 */
window.validateFields = (fields, rules) => {
  const errors = {};

  for (const [fieldName, value] of Object.entries(fields)) {
    const rule = rules[fieldName];
    if (!rule) continue;

    // Check required
    if (rule.required && (!value || value.toString().trim() === "")) {
      errors[fieldName] = rule.requiredMsg || `${fieldName} là bắt buộc`;
      continue;
    }

    if (!value) continue; // Skip other validations if value is empty and not required

    // Check minLength
    if (rule.minLength && value.toString().length < rule.minLength) {
      errors[fieldName] =
        rule.minLengthMsg ||
        `${fieldName} phải có ít nhất ${rule.minLength} ký tự`;
    }

    // Check maxLength
    if (rule.maxLength && value.toString().length > rule.maxLength) {
      errors[fieldName] =
        rule.maxLengthMsg ||
        `${fieldName} không được vượt quá ${rule.maxLength} ký tự`;
    }

    // Check pattern (regex)
    if (rule.pattern && !rule.pattern.test(value.toString())) {
      errors[fieldName] = rule.patternMsg || `${fieldName} không hợp lệ`;
    }

    // Check min/max for numbers
    if (rule.min !== undefined && Number(value) < rule.min) {
      errors[fieldName] = rule.minMsg || `${fieldName} phải >= ${rule.min}`;
    }

    if (rule.max !== undefined && Number(value) > rule.max) {
      errors[fieldName] = rule.maxMsg || `${fieldName} phải <= ${rule.max}`;
    }

    // Custom validator function
    if (rule.custom && typeof rule.custom === "function") {
      const customError = rule.custom(value);
      if (customError) {
        errors[fieldName] = customError;
      }
    }
  }

  return errors;
};

/**
 * Sanitizes input to prevent XSS
 * @param {string} input - User input
 * @returns {string} Sanitized string
 */
window.sanitizeInput = (input) => {
  if (!input) return "";
  return input
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
};

/**
 * Validates a string is not empty and not just whitespace
 * @param {string} value
 * @param {string} fieldName
 * @returns {string|null} Error message or null if valid
 */
window.validateRequired = (value, fieldName = "Trường") => {
  if (!value || value.toString().trim() === "") {
    return `${fieldName} không được để trống`;
  }
  return null;
};

/**
 * Validates email format
 * @param {string} email
 * @returns {string|null} Error message or null if valid
 */
window.validateEmail = (email) => {
  if (!email) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return "Email không hợp lệ";
  }
  return null;
};

/**
 * Validates phone number (Vietnamese format)
 * @param {string} phone
 * @returns {string|null} Error message or null if valid
 */
window.validatePhone = (phone) => {
  if (!phone) return null;
  const phoneRegex = /^[\d\s\-+()]{10,}$/;
  if (!phoneRegex.test(phone.toString())) {
    return "Số điện thoại không hợp lệ";
  }
  return null;
};

/**
 * Validates positive number
 * @param {number} value
 * @param {string} fieldName
 * @returns {string|null} Error message or null if valid
 */
window.validatePositiveNumber = (value, fieldName = "Giá trị") => {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    return `${fieldName} phải là số dương`;
  }
  return null;
};

// ==========================================
// --- SHARED INVENTORY & ORDER HELPERS ---
// ==========================================

/**
 * Deducts ingredient stock from inventory batches for a given order.
 * @param {number} orderId
 */
window.deductInventoryFromOrder = async function (orderId) {
  const API = window.electronAPI;
  try {
    await API.db_execute("BEGIN TRANSACTION");
    const [order] = await API.db_query(
      "SELECT items_json FROM orders WHERE id = ?",
      [orderId],
    );
    if (!order || !order.items_json) {
      await API.db_execute("COMMIT");
      return;
    }

    const items = JSON.parse(order.items_json);
    for (const item of items) {
      const itemLabel =
        item.filling_name && item.filling_name !== "Không nhân"
          ? `${item.base_name} (${item.filling_name})`
          : item.base_name;

      const ingredientsNeeded = await API.db_query(
        `
        SELECT ri.ingredient_id, (ri.qty * mr.ratio * ? / CAST(r.output AS REAL)) AS total_needed FROM menu_recipes mr JOIN recipe_ingredients ri ON mr.recipe_id = ri.recipe_id JOIN recipes r ON mr.recipe_id = r.id WHERE mr.menu_item_id = ?
        UNION ALL SELECT ingredient_id, (qty * ?) AS total_needed FROM menu_ingredients WHERE menu_item_id = ?
        UNION ALL SELECT ingredient_id, (qty * ?) AS total_needed FROM menu_packaging WHERE menu_item_id = ?
      `,
        [
          item.qty,
          item.menu_id,
          item.qty,
          item.menu_id,
          item.qty,
          item.menu_id,
        ],
      );

      if (item.filling_id) {
        const fillingIngs = await API.db_query(
          "SELECT ri.ingredient_id, (ri.qty * ? / CAST(r.output AS REAL)) as total_needed FROM recipe_ingredients ri JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = ?",
          [item.qty, item.filling_id],
        );
        ingredientsNeeded.push(...fillingIngs);
      }

      for (const ing of ingredientsNeeded) {
        let remainingToDeduct = ing.total_needed;
        const batches = await API.db_query(
          "SELECT id, qty_remaining FROM inventory_batches WHERE ingredient_id = ? AND qty_remaining > 0 ORDER BY expiry_date ASC, import_date ASC",
          [ing.ingredient_id],
        );

        for (const batch of batches) {
          if (remainingToDeduct < 0.0001) break;
          if (batch.qty_remaining >= remainingToDeduct) {
            await API.db_execute(
              "UPDATE inventory_batches SET qty_remaining = qty_remaining - ? WHERE id = ?",
              [remainingToDeduct, batch.id],
            );
            remainingToDeduct = 0;
          } else {
            remainingToDeduct -= batch.qty_remaining;
            await API.db_execute(
              "UPDATE inventory_batches SET qty_remaining = 0 WHERE id = ?",
              [batch.id],
            );
          }
        }
        if (remainingToDeduct > 0.0001) {
          const [ingInfo] = await API.db_query(
            "SELECT name, unit FROM ingredients WHERE id = ?",
            [ing.ingredient_id],
          );
          throw new Error(
            `Kho thiếu ${window.formatNumber(remainingToDeduct)} ${ingInfo.unit} "${ingInfo.name}" cho món "${itemLabel}"!`,
          );
        }
      }
    }
    await API.db_execute("COMMIT");
  } catch (err) {
    await API.db_execute("ROLLBACK");
    throw err;
  }
};

/**
 * Restores ingredient stock into inventory batches for a cancelled/reverted order.
 * @param {number} orderId
 * @param {string} [noteSuffix]
 */
window.restoreInventoryFromOrder = async function (orderId, noteSuffix = "") {
  const API = window.electronAPI;
  try {
    await API.db_execute("BEGIN TRANSACTION");
    const [order] = await API.db_query(
      "SELECT items_json FROM orders WHERE id = ?",
      [orderId],
    );
    if (!order || !order.items_json) {
      await API.db_execute("COMMIT");
      return;
    }

    const items = JSON.parse(order.items_json);
    for (const item of items) {
      const ingredientsNeeded = await API.db_query(
        `
        SELECT ri.ingredient_id, (ri.qty * mr.ratio * ? / CAST(r.output AS REAL)) AS total_needed FROM menu_recipes mr JOIN recipe_ingredients ri ON mr.recipe_id = ri.recipe_id JOIN recipes r ON mr.recipe_id = r.id WHERE mr.menu_item_id = ?
        UNION ALL SELECT ingredient_id, (qty * ?) AS total_needed FROM menu_ingredients WHERE menu_item_id = ?
        UNION ALL SELECT ingredient_id, (qty * ?) AS total_needed FROM menu_packaging WHERE menu_item_id = ?
      `,
        [
          item.qty,
          item.menu_id,
          item.qty,
          item.menu_id,
          item.qty,
          item.menu_id,
        ],
      );

      if (item.filling_id) {
        const fillingIngs = await API.db_query(
          "SELECT ri.ingredient_id, (ri.qty * ? / CAST(r.output AS REAL)) as total_needed FROM recipe_ingredients ri JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = ?",
          [item.qty, item.filling_id],
        );
        ingredientsNeeded.push(...fillingIngs);
      }

      for (const ing of ingredientsNeeded) {
        if (ing.total_needed <= 0) continue;
        const [ingInfo] = await API.db_query(
          "SELECT unit_price FROM ingredients WHERE id = ?",
          [ing.ingredient_id],
        );
        const refundPrice = (ingInfo.unit_price || 0) * ing.total_needed;

        await API.db_execute(
          `INSERT INTO inventory_batches (ingredient_id, qty_imported, qty_remaining, import_date, purchase_price, note) VALUES (?, ?, ?, DATE('now'), ?, ?)`,
          [
            ing.ingredient_id,
            ing.total_needed,
            ing.total_needed,
            refundPrice,
            `[♻️ Hoàn trả kho do Hủy/Lùi đơn #${orderId}${noteSuffix ? " " + noteSuffix : ""}]`,
          ],
        );
      }
    }
    await API.db_execute("COMMIT");
  } catch (err) {
    await API.db_execute("ROLLBACK");
    throw err;
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

window.formatRichText = (text) => {
  if (!text) return "";

  let html = window.escHtml(text);

  // 1. Wiki Links
  html = html.replace(/\[\[(.*?)\]\]/g, (match, title) => {
    const cleanTitle = title.trim();
    return `<a href="javascript:void(0)" class="wiki-link" onclick="event.stopPropagation(); if(window.KnowledgeController) window.KnowledgeController.goToArticleByTitle('${cleanTitle}')">${cleanTitle}</a>`;
  });

  // 2. Bold và Highlight
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/==(.*?)==/g, '<mark class="text-highlight">$1</mark>');

  // 3. Xử lý các loại Tiêu đề (Block level)

  // CẬP NHẬT MỚI: Bắt các loại 1. Tiêu đề: hoặc 1. Tiêu đề ?
  html = html.replace(
    /^(\d+\.\s+.*[:?])\s*$/gm,
    '<span class="label-numbered">$1</span>',
  );

  // Loại: [Tiêu đề]:
  html = html.replace(
    /^(\[[^\]]+\]:)/gm,
    '<span class="label-bracket">$1</span>',
  );

  // Bắt các từ đầu dòng viết hoa kết thúc bằng dấu : (VD: Bước 1:, Lưu ý:)
  html = html.replace(
    /^([A-ZÀ-Ỹ][^:\n]{0,20}:)/gm,
    '<span class="label-bold-colon">$1</span>',
  );

  return html;
};

async function initApp() {
  if (window.electronAPI?.db_query) {
    await setupGlobalUI();
    if (typeof navigate === "function") navigate("dashboard");
  } else {
    requestAnimationFrame(initApp);
  }
}

initApp();
