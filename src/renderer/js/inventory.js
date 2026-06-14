(function () {
  const itemsPerPage = 8;
  const API = window.electronAPI;
  if (typeof window.currentPageInventory === "undefined")
    window.currentPageInventory = 1;
  if (typeof window.inventoryKeyword === "undefined")
    window.inventoryKeyword = "";

  // 1. Tải bảng Tổng Quan Tồn Kho
  window.loadInventory = async () => {
    try {
      const tbody = $("inventory-list-body");
      const paginationContainer = $("inventory-pagination");

      // Đồng bộ keyword từ UI
      const searchInput = $("inventory-search");
      if (searchInput) {
        window.inventoryKeyword = searchInput.value.trim();
      }

      const sql = `
        SELECT 
          i.id, i.name, i.unit, 
          COALESCE(SUM(b.qty_remaining), 0) as total_qty
        FROM ingredients i
        LEFT JOIN inventory_batches b ON i.id = b.ingredient_id AND b.qty_remaining > 0
        WHERE i.is_active = 1
        GROUP BY i.id
        ORDER BY total_qty ASC
      `;
      const rawData = await API.db_query(sql);

      // Lọc không dấu và không phân biệt hoa thường
      const kw = window.removeAccents(window.inventoryKeyword);
      const data = rawData.filter((i) =>
        window.removeAccents(i.name).includes(kw),
      );

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">Không tìm thấy vật tư nào.</td></tr>`;
        paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        data,
        itemsPerPage,
        window.currentPageInventory,
        (newPage) => {
          window.currentPageInventory = newPage;
          window.loadInventory();
        },
      );

      tbody.innerHTML = pagingResult.data
        .map((item, index) => {
          const stt =
            (window.currentPageInventory - 1) * itemsPerPage + index + 1;

          let statusHtml = "";
          if (item.total_qty === 0)
            statusHtml = `<span class="status-badge status-empty">Hết hàng</span>`;
          else if (item.total_qty < 10)
            statusHtml = `<span class="status-badge status-low">Sắp hết</span>`;
          else
            statusHtml = `<span class="status-badge status-ok">Đủ hàng</span>`;

          return `
          <tr>
            <td class="text-center">${stt}</td>
            <td class="text-center" style="font-weight: bold; color: var(--text-chocolate);">${item.name}</td>
            <td class="text-center">${item.unit}</td>
            <td class="text-center"><strong>${window.formatNumber(item.total_qty)}</strong></td>
            <td class="text-center">${statusHtml}</td>
            <td class="text-center">
              <button class="btn-secondary has-tooltip" data-note="Xem các lô hàng" onclick="window.viewBatchHistory(${item.id}, '${item.name}')">
              <img src="src/renderer/assets/document.svg" alt="Menu Icon" class="icon"/>
              </button>
            </td>
          </tr>
        `;
        })
        .join("");

      paginationContainer.innerHTML = pagingResult.html;
      if (typeof window.TooltipComponent !== "undefined")
        window.TooltipComponent.init();
    } catch (error) {
      console.error(error);
      if (typeof window.showToast === "function")
        window.showToast("Lỗi tải dữ liệu kho!", "error");
    }
  };

  window.searchInventory = window.debounce(() => {
    window.inventoryKeyword = $("inventory-search").value.trim();
    window.currentPageInventory = 1;
    window.loadInventory();
  }, 300);

  // 2. Mở Modal Nhập Kho
  window.openImportModal = async () => {
    const select = $("imp-ing-id");
    // Kiểm tra an toàn để tránh crash khi thiếu HTML
    if (!select)
      return console.warn("Không tìm thấy phần tử imp-ing-id trong HTML.");

    try {
      const ings = await API.db_query(
        "SELECT id, name, unit FROM ingredients WHERE is_active = 1 ORDER BY name ASC",
      );

      // KIỂM TRA: Nếu không có vật tư nào thì báo lỗi và KHÔNG mở modal
      if (!ings || ings.length === 0) {
        if (typeof window.showToast === "function") {
          window.showToast(
            "Chưa có vật tư nào! Vui lòng thêm vật tư trước khi nhập kho.",
            "error",
          );
        }
        return; // Dừng hàm tại đây
      }

      // Nếu có dữ liệu thì load vào select
      select.innerHTML = ings
        .map((i) => `<option value="${i.id}">${i.name} (${i.unit})</option>`)
        .join("");

      // Kiểm tra sự tồn tại của các input trước khi reset để tránh lỗi null
      if ($("imp-qty")) $("imp-qty").value = "";
      if ($("imp-expiry")) $("imp-expiry").value = "";
      if ($("imp-purchase-price")) $("imp-purchase-price").value = "";
      if ($("imp-note")) $("imp-note").value = "";

      // Mở modal
      if ($("import-modal")) {
        $("import-modal").style.display = "flex";
        window.initImportModalInputFormatters(); // Kích hoạt formatter ngay khi mở
      }
    } catch (error) {
      console.error("Chi tiết lỗi openImportModal:", error);
      if (typeof window.showToast === "function") {
        window.showToast("Không thể tải danh sách vật tư", "error");
      }
    }
  };

  window.closeImportModal = () => ($("import-modal").style.display = "none");

  // 3. Lưu Lô Nhập Kho mới
  window.saveImport = async () => {
    const ingId = $("imp-ing-id").value;
    const qty = parseFloat($("imp-qty").value);
    const totalPurchasePrice = window.unformatNumber(
      $("imp-purchase-price").value,
    ); // Lấy TỔNG giá mua của lô hàng
    const expiry = $("imp-expiry").value;
    const note = $("imp-note").value.trim();

    if (!ingId || !qty || qty <= 0) {
      if (typeof window.showToast === "function")
        window.showToast(
          "Vui lòng chọn vật tư và nhập số lượng hợp lệ!",
          "error",
        );
      return; // Dừng nếu thiếu thông tin cơ bản
    }

    const isConfirmed = await window.showConfirm(
      "Xác nhận nhập kho",
      `Bạn chắc chắn muốn nhập ${qty} vào kho?`,
    );
    if (!isConfirmed) return;

    try {
      await API.db_execute(
        `INSERT INTO inventory_batches (ingredient_id, qty_imported, qty_remaining, import_date, expiry_date, purchase_price, note) 
         VALUES (?, ?, ?, DATE('now'), ?, ?, ?)`,
        [ingId, qty, qty, expiry || null, totalPurchasePrice, note], // purchase_price lưu tổng giá mua của lô
      );

      // Cập nhật unit_price của nguyên liệu trong bảng ingredients theo giá mua mới nhất
      const unitPriceForIngredient = totalPurchasePrice / qty;
      await API.db_execute(
        "UPDATE ingredients SET unit_price = ? WHERE id = ?",
        [unitPriceForIngredient, ingId], // unit_price của vật tư là giá đơn vị
      );

      if (typeof window.showToast === "function")
        window.showToast("Nhập kho thành công!", "success");
      window.closeImportModal();

      // Kiểm tra xem module ingredients đã được load chưa trước khi gọi hàm
      if (typeof window.loadIngredients === "function") {
        window.loadIngredients();
      }
      window.loadInventory();
    } catch (error) {
      console.error(error);
      if (typeof window.showToast === "function")
        window.showToast("Lỗi khi lưu vào CSDL", "error");
    }
  };

  // 4. Xem chi tiết các lô hàng
  window.viewBatchHistory = async (ingredientId, ingredientName) => {
    $("batch-ingredient-name").innerText = `Vật tư: ${ingredientName}`;
    const tbody = $("batch-list-body");

    try {
      const batches = await API.db_query(
        `SELECT * FROM inventory_batches WHERE ingredient_id = ? ORDER BY import_date DESC, expiry_date ASC`, // Sắp xếp theo ngày nhập mới nhất
        [ingredientId],
      );

      if (!batches || batches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:#888;">Chưa có lịch sử nhập lô nào.</td></tr>`;
      } else {
        tbody.innerHTML = batches
          .map((b) => {
            const isExpired =
              b.expiry_date && new Date(b.expiry_date) < new Date();
            const trStyle =
              isExpired && b.qty_remaining > 0
                ? "background-color: #f8d7da; color: #721c24;"
                : "";
            const batchUnitPrice =
              b.qty_imported > 0 ? b.purchase_price / b.qty_imported : 0;

            const qtyStyle =
              b.qty_remaining === 0
                ? "text-decoration: line-through; color: #aaa;"
                : "font-weight:bold;";

            return `
            <tr style="${trStyle}">
              <td>${b.import_date || "--"}</td>
              <td>${b.qty_imported}</td>
              <td>${window.formatNumber(b.purchase_price)} đ / ${window.formatNumber(batchUnitPrice)} đ</td>
              <td style="${qtyStyle}">${b.qty_remaining}</td>
              <td>${b.expiry_date || "Không có"}</td>
              <td>${b.note || ""}</td>
            </tr>
          `;
          })
          .join("");
      }

      $("batch-modal").style.display = "flex";
    } catch (error) {
      if (typeof window.showToast === "function")
        window.showToast("Lỗi khi tải lịch sử lô hàng", "error");
    }
  };

  // Khởi tạo listeners cho việc định dạng input giá mua
  window.initImportModalInputFormatters = () => {
    const el = $("imp-purchase-price");
    if (!el) return;

    // Tránh gắn nhiều listener nếu modal mở đi mở lại
    if (!el.dataset.listenerAttached) {
      el.addEventListener("input", () => {
        window.formatInputOnType(el);
      });
      el.dataset.listenerAttached = "true";
    }
  };

  // Tự động theo dõi DOM để init formatters (giống recipes.js/menu.js)
  const observer = new MutationObserver(() => {
    if ($("imp-purchase-price")) window.initImportModalInputFormatters();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.closeBatchModal = () => ($("batch-modal").style.display = "none");
})();
