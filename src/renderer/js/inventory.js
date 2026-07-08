(function () {
  const itemsPerPage = 8;
  const API = window.electronAPI;

  const $ = (id) => document.getElementById(id);

  window.invState = {
    currentPage: 1,
    keyword: "",
    activeTab: "all",
    editingIngId: null,
  };

  window.bulkImportState = {
    items: [],
    availableIngredients: [],
  };

  // --- LẮNG NGHE PHÍM ENTER ĐỂ NHẬP NHANH ---
  document.addEventListener("keydown", (e) => {
    const modal = $("ingredient-modal");
    if (modal && modal.classList.contains("flex") && e.key === "Enter") {
      if (
        document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "SELECT"
      ) {
        window.saveIngredient(true); // Nhấn Enter tự động Lưu & Tiếp tục
      }
    }
  });

  // ==========================================
  // 1. RENDER BẢNG CHÍNH
  // ==========================================
  window.loadInventory = async () => {
    await window.showLoader(true);
    try {
      const tbody = $("inventory-list-body");
      const paginationContainer = $("inventory-pagination");
      if (!tbody) return;

      const searchInput = $("inventory-search");
      if (searchInput) window.invState.keyword = searchInput.value.trim();

      let sql = `
        SELECT
          i.id, i.name, i.unit, i.unit_price, i.type, i.note,
          COALESCE(SUM(b.qty_remaining), 0) as total_qty
        FROM ingredients i
        LEFT JOIN inventory_batches b ON i.id = b.ingredient_id AND b.qty_remaining > 0
        WHERE i.is_active = 1
      `;
      const params = [];

      if (window.invState.activeTab !== "all") {
        sql += " AND i.type = ?";
        params.push(window.invState.activeTab);
      }
      sql += " GROUP BY i.id ORDER BY total_qty ASC, i.id DESC";

      const rawData = await API.db_query(sql, params);
      const kw = window.removeAccents(window.invState.keyword);
      const data = rawData.filter((i) =>
        window.removeAccents(i.name).includes(kw),
      );

      if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="no-data text-center">Không tìm thấy vật tư nào phù hợp.</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        data,
        itemsPerPage,
        window.invState.currentPage,
        (newPage) => {
          window.invState.currentPage = newPage;
          window.loadInventory();
        },
      );

      tbody.innerHTML = pagingResult.data
        .map((item, index) => {
          const stt =
            (window.invState.currentPage - 1) * itemsPerPage + index + 1;
          const typeBadge =
            item.type === "package"
              ? `<span class="badge" style="background: var(--neutral-300); color: var(--neutral-800);">Bao bì</span>`
              : `<span class="badge" style="background: var(--color-sidebar-background); color: var(--color-text-info);">Nguyên liệu</span>`;

          let statusHtml;
          if (item.total_qty <= 0)
            statusHtml = `<span class="status-badge status-empty">Hết hàng</span>`;
          else if (item.total_qty < 10)
            statusHtml = `<span class="status-badge status-low">Sắp hết</span>`;
          else
            statusHtml = `<span class="status-badge status-ok">Đủ hàng</span>`;

          return `
        <tr>
          <td class="text-center">${stt}</td>
          <td>
            <div style="font-weight: bold; color: var(--color-primary-text); font-size: 14px;">${item.name}</div>
            <div style="margin-top: 4px;">${typeBadge}</div>
          </td>
          <td><b style="color: var(--color-highlight-danger);">${window.formatNumber(Math.round(item.unit_price))}đ</b> / ${item.unit}</td>
          <td><b style="font-size: 16px;">${window.formatNumber(item.total_qty)}</b> ${item.unit}</td>
          <td class="text-center">${statusHtml}</td>
          <td class="action-column text-center">
            <button class="btn-secondary has-tooltip" data-note="Sửa định nghĩa" onclick="window.openIngredientModal('edit', ${item.id})"><img src="src/renderer/assets/edit.svg" class="icon"/></button>
            <button class="btn-secondary has-tooltip" data-note="Lịch sử lô hàng" onclick="window.viewBatchHistory(${item.id}, '${item.name.replace(/'/g, "\\'")}')"><img src="src/renderer/assets/document.svg" class="icon"/></button>
            <button class="btn-secondary has-tooltip" style="border-color: var(--color-highlight-danger);" data-note="Xuất hủy/Hao hụt" onclick="window.openWasteModal(${item.id}, '${item.name.replace(/'/g, "\\'")}', '${item.unit}', ${item.total_qty})"><img src="src/renderer/assets/trash.svg" class="icon"/></button>
          </td>
        </tr>`;
        })
        .join("");

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;
      window.TooltipComponent?.init();
    } catch (error) {
      console.error(error);
    } finally {
      await window.showLoader(false);
    }
  };

  window.searchInventory = window.debounce(() => {
    window.invState.keyword = $("inventory-search")?.value.trim() || "";
    window.invState.currentPage = 1;
    window.loadInventory();
  }, 300);

  window.switchInvTab = (type) => {
    window.invState.activeTab = type;
    window.invState.currentPage = 1;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === type);
    });
    window.loadInventory();
  };

  // ==========================================
  // 2. CRUD ĐỊNH NGHĨA VẬT TƯ (HỖ TRỢ NHẬP NHANH)
  // ==========================================
  window.openIngredientModal = async (mode = "add", id = null) => {
    window.invState.editingIngId = id;
    const modal = $("ingredient-modal");

    $("ing-name").value = "";
    $("ing-unit-price").value = "";
    $("ing-note").value = "";
    $("ing-type").value =
      window.invState.activeTab !== "all"
        ? window.invState.activeTab
        : "ingredient";
    window.onIngTypeChange();

    if (mode === "edit" && id) {
      $("ing-modal-title").innerText = "Sửa Thông Tin Vật Tư";
      const [item] = await API.db_query(
        "SELECT * FROM ingredients WHERE id = ?",
        [id],
      );
      if (item) {
        $("ing-type").value = item.type;
        window.onIngTypeChange();
        $("ing-name").value = item.name;
        $("ing-unit").value = item.unit;
        $("ing-unit-price").value = window.formatNumber(item.unit_price);
        $("ing-note").value = item.note || "";
      }
    } else {
      $("ing-modal-title").innerText = "Thêm Vật Tư Mới";
    }

    modal.classList.add("flex");

    // Tự động trỏ chuột vào tên vật tư để gõ ngay
    setTimeout(() => {
      $("ing-name").focus();
    }, 100);
  };

  window.closeIngredientModal = () =>
    $("ingredient-modal").classList.remove("flex");

  window.onIngTypeChange = () => {
    const type = $("ing-type").value;
    $("ing-unit").value = type === "package" ? "cái" : "gam";
  };

  window.saveIngredient = async (isContinue = false) => {
    const name = $("ing-name").value.trim();
    const type = $("ing-type").value;
    const unit = $("ing-unit").value;
    const unitPrice = window.unformatNumber($("ing-unit-price").value) || 0;
    const note = $("ing-note").value.trim();

    if (!name)
      return window.showToast?.("Vui lòng nhập tên vật tư!", "warning");

    await window.showLoader(true);
    try {
      const checkSql = window.invState.editingIngId
        ? "SELECT id FROM ingredients WHERE LOWER(name) = ? AND id != ?"
        : "SELECT id FROM ingredients WHERE LOWER(name) = ?";
      const dups = await API.db_query(
        checkSql,
        window.invState.editingIngId
          ? [name.toLowerCase(), window.invState.editingIngId]
          : [name.toLowerCase()],
      );

      if (dups.length)
        return window.showToast?.("Tên vật tư đã tồn tại!", "error");

      if (window.invState.editingIngId) {
        await API.db_execute(
          "UPDATE ingredients SET name=?, type=?, unit=?, unit_price=?, note=? WHERE id=?",
          [name, type, unit, unitPrice, note, window.invState.editingIngId],
        );
        window.showToast?.("Cập nhật thành công!", "success");
      } else {
        await API.db_execute(
          "INSERT INTO ingredients (name, type, unit, unit_price, note) VALUES (?, ?, ?, ?, ?)",
          [name, type, unit, unitPrice, note],
        );
        window.showToast?.("Đã lưu định nghĩa vật tư!", "success");
      }

      window.invalidateAndReload("fillingOptions", null);
      window.invalidateAndReload("menuSourceData", null);
      window.loadInventory();

      if (isContinue && !window.invState.editingIngId) {
        // Chế độ nhập liên tục: Xóa tên, giá, giữ Unit và Type
        $("ing-name").value = "";
        $("ing-unit-price").value = "";
        setTimeout(() => $("ing-name").focus(), 50);
      } else {
        window.closeIngredientModal();
      }
    } catch (error) {
      console.error(error);
      window.showToast?.("Lỗi lưu vật tư!", "error");
    } finally {
      await window.showLoader(false);
    }
  };

  // ==========================================
  // 3. TẠO PHIẾU NHẬP KHO HÀNG LOẠT (BULK IMPORT)
  // ==========================================
  window.openBulkImportModal = async () => {
    await window.showLoader(true);
    try {
      const rawIngs = await API.db_query(
        "SELECT id, name, unit FROM ingredients WHERE is_active = 1 ORDER BY name ASC",
      );
      window.bulkImportState.availableIngredients = rawIngs.map((i) => ({
        ...i,
        _normalizedName: window.removeAccents(i.name),
      }));

      $("bi-supplier").value = "";
      $("bi-payment-status").value = "Đã thanh toán";
      $("bi-note").value = "";

      const todayStr = new Date().toISOString().split("T")[0];
      if ($("bi-date")) $("bi-date").value = todayStr;

      window.bulkImportState.items = [];
      window.bulkImportState.items.push({
        id: null,
        name: "",
        unit: "đv",
        qty: 1,
        priceText: "",
        expiry: "",
      });

      window.renderBulkImportRows();
      $("bulk-import-modal").classList.add("flex");
    } catch (error) {
      console.error(error);
      window.showToast?.("Lỗi tải dữ liệu", "error");
    } finally {
      await window.showLoader(false);
    }
  };

  window.closeBulkImportModal = () =>
    $("bulk-import-modal").classList.remove("flex");

  window.addBulkImportRow = () => {
    window.bulkImportState.items.push({
      id: null,
      name: "",
      unit: "đv",
      qty: 1,
      priceText: "",
      expiry: "",
    });
    window.renderBulkImportRows();
  };

  window.removeBulkImportRow = (index) => {
    window.bulkImportState.items.splice(index, 1);
    if (window.bulkImportState.items.length === 0) window.addBulkImportRow(); // Luôn giữ 1 hàng
    window.renderBulkImportRows();
  };

  window.updateBulkImportRow = (index, field, value) => {
    window.bulkImportState.items[index][field] = value;
    if (field === "priceText") window.updateBulkImportTotals();
  };

  window.renderBulkImportRows = () => {
    const tbody = $("bulk-import-body");
    if (!tbody) return;

    tbody.innerHTML = window.bulkImportState.items
      .map(
        (item, index) => `
      <tr>
        <td style="position: relative;">
          <input type="text" class="w-full" placeholder="🔍 Gõ tên vật tư..." value="${item.name}"
                 autocomplete="off" spellcheck="false"
                 oninput="window.filterBulkIngPicker(this, ${index})"
                 onfocus="window.filterBulkIngPicker(this, ${index})"
                 onblur="setTimeout(() => { const d = this.nextElementSibling; if(d) d.style.display='none'; }, 200)">
          <div class="picker-dropdown" style="display: none; width: 100%; top: 100%; left: 0;"></div>
        </td>
        <td class="text-center">
          <div class="flex items-center justify-center gap-xs">
            <input type="number" class="text-center" style="width: 70px;" value="${item.qty}" min="0.1" step="0.1" inputmode="decimal"
                   oninput="window.updateBulkImportRow(${index}, 'qty', this.value)">
            <span style="font-size: 13px; color: var(--neutral-600); white-space: nowrap; width: 25px;">${item.unit}</span>
          </div>
        </td>
        <td>
          <input type="text" class="w-full text-right" placeholder="0" value="${item.priceText}" inputmode="numeric"
                 oninput="window.formatInputOnType(this); window.updateBulkImportRow(${index}, 'priceText', this.value)">
        </td>
        <td>
          <input type="date" class="w-full" style="font-size: 13px;" value="${item.expiry}"
                 onchange="window.updateBulkImportRow(${index}, 'expiry', this.value)">
        </td>
        <td class="text-center">
          <button type="button" class="btn-delete-row" tabindex="-1" onclick="window.removeBulkImportRow(${index})">❌</button>
        </td>
      </tr>
    `,
      )
      .join("");

    window.updateBulkImportTotals();
  };

  window.updateBulkImportTotals = () => {
    let totalItems = 0;
    let totalAmount = 0;
    window.bulkImportState.items.forEach((item) => {
      if (item.id) totalItems++;
      totalAmount += window.unformatNumber(item.priceText) || 0;
    });
    if ($("bi-total-items")) $("bi-total-items").innerText = totalItems;
    if ($("bi-total-amount"))
      $("bi-total-amount").innerText = window.formatNumber(totalAmount) + " đ";
  };

  window.filterBulkIngPicker = (inputEl, index) => {
    const dropdown = inputEl.nextElementSibling;
    const txt = inputEl.value.trim();
    const normalizedTxt = window.removeAccents(txt);

    if (txt !== window.bulkImportState.items[index].name) {
      window.bulkImportState.items[index].id = null;
    }

    const filtered = window.bulkImportState.availableIngredients
      .filter((i) => i._normalizedName.includes(normalizedTxt))
      .slice(0, 15);

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="picker-no-result">Không tìm thấy vật tư</div>`;
    } else {
      dropdown.innerHTML = filtered
        .map(
          (item) => `
        <div class="picker-item" onmousedown="window.selectBulkIngPicker(${index}, ${item.id}, '${item.name.replace(/'/g, "\\'")}', '${item.unit}')">
          <span class="picker-item-name">${window.escHtml(item.name)}</span>
        </div>
      `,
        )
        .join("");
    }
    dropdown.style.display = "block";
  };

  window.selectBulkIngPicker = (index, id, name, unit) => {
    window.bulkImportState.items[index].id = id;
    window.bulkImportState.items[index].name = name;
    window.bulkImportState.items[index].unit = unit;
    window.renderBulkImportRows();
  };

  window.formatInventoryNote = (supplier, paymentStatus, originalNote) => {
    const s = supplier ? `[NCC: ${supplier}]` : `[NCC: Khách lẻ]`;
    const p = paymentStatus ? `[TT: ${paymentStatus}]` : `[TT: Đã thanh toán]`;
    return `${s} ${p} ${originalNote}`.trim();
  };

  window.saveBulkImport = async () => {
    const supplier = $("bi-supplier").value.trim();
    const paymentStatus = $("bi-payment-status").value;
    const rawNote = $("bi-note").value.trim();
    const finalNote = window.formatInventoryNote(
      supplier,
      paymentStatus,
      rawNote,
    );

    const importDate =
      $("bi-date")?.value || new Date().toISOString().split("T")[0];

    const validItems = window.bulkImportState.items
      .map((item) => {
        const parsedQty = parseFloat(item.qty);
        const parsedPrice = window.unformatNumber(item.priceText);
        return { ...item, qty: parsedQty, price: parsedPrice };
      })
      .filter((item) => item.id !== null && item.qty > 0 && !isNaN(item.price));

    if (validItems.length === 0) {
      return window.showToast?.(
        "Vui lòng nhập ít nhất 1 mặt hàng hợp lệ!",
        "warning",
      );
    }

    const totalBill = validItems.reduce((sum, item) => sum + item.price, 0);
    const confirm = await window.showConfirm(
      "Xác nhận phiếu nhập",
      `Chốt nhập ${validItems.length} mặt hàng. Tổng thanh toán: ${window.formatNumber(totalBill)}đ?`,
    );
    if (!confirm) return;

    await window.showLoader(true);
    try {
      await API.db_execute("BEGIN TRANSACTION");

      for (const item of validItems) {
        const [currentData] = await API.db_query(
          `
          SELECT unit_price,
                 (SELECT COALESCE(SUM(qty_remaining), 0) FROM inventory_batches WHERE ingredient_id = ? AND qty_remaining > 0) as old_qty
          FROM ingredients WHERE id = ?
        `,
          [item.id, item.id],
        );

        const oldQty = currentData.old_qty || 0;
        const oldPrice = currentData.unit_price || 0;
        const oldTotalValue = oldQty * oldPrice;
        const newTotalValue = oldTotalValue + item.price;
        const newTotalQty = oldQty + item.qty;
        const wac = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

        await API.db_execute(
          `INSERT INTO inventory_batches (ingredient_id, qty_imported, qty_remaining, import_date, expiry_date, purchase_price, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.qty,
            item.qty,
            importDate,
            item.expiry || null,
            item.price,
            finalNote,
          ],
        );

        await API.db_execute(
          "UPDATE ingredients SET unit_price = ? WHERE id = ?",
          [wac, item.id],
        );
      }

      await API.db_execute("COMMIT");
      window.showToast?.("Tạo phiếu nhập thành công!", "success");
      window.closeBulkImportModal();
      window.loadInventory();
    } catch (error) {
      await API.db_execute("ROLLBACK");
      console.error(error);
      window.showToast?.("Lỗi nhập kho: " + error.message, "error");
    } finally {
      await window.showLoader(false);
    }
  };

  // ==========================================
  // 4. XUẤT HỦY / HAO HỤT KHỎI KHO
  // ==========================================
  window.openWasteModal = (id, name, unit, currentTotalQty) => {
    if (currentTotalQty <= 0)
      return window.showToast?.(
        "Vật tư này đã hết, không thể xuất hủy!",
        "warning",
      );
    $("waste-ing-id").value = id;
    $("waste-ing-name").value = `${name} (${unit})`;
    $("waste-qty").value = "";
    $("waste-qty").max = currentTotalQty;
    $("waste-reason").value = "Hết hạn sử dụng";
    $("waste-modal").classList.add("flex");
  };

  window.closeWasteModal = () => $("waste-modal").classList.remove("flex");

  window.saveWastage = async () => {
    const ingId = $("waste-ing-id").value;
    const wasteQty = parseFloat($("waste-qty").value);
    const reason = $("waste-reason").value;
    const maxQty = parseFloat($("waste-qty").max);

    if (!wasteQty || wasteQty <= 0)
      return window.showToast?.("Số lượng hủy phải lớn hơn 0!", "warning");
    if (wasteQty > maxQty)
      return window.showToast?.(
        `Trong kho chỉ còn ${maxQty}, không thể hủy ${wasteQty}!`,
        "error",
      );

    const confirm = await window.showConfirm(
      "CẢNH BÁO",
      `Bạn đang thực hiện thao tác XUẤT HỦY ${wasteQty} đơn vị do: ${reason}. Thao tác này sẽ trừ trực tiếp vào kho. Tiếp tục?`,
    );
    if (!confirm) return;

    await window.showLoader(true);
    try {
      let remainingToDeduct = wasteQty;
      const batches = await API.db_query(
        "SELECT id, qty_remaining, note FROM inventory_batches WHERE ingredient_id = ? AND qty_remaining > 0 ORDER BY expiry_date ASC, import_date ASC",
        [ingId],
      );

      for (const batch of batches) {
        if (remainingToDeduct <= 0) break;
        const wasteNoteAppender = `\n[🗑️ Xuất hủy ${Math.min(batch.qty_remaining, remainingToDeduct)} đv: ${reason} lúc ${new Date().toLocaleDateString("vi-VN")}]`;
        const newNote = (batch.note || "") + wasteNoteAppender;

        if (batch.qty_remaining >= remainingToDeduct) {
          await API.db_execute(
            "UPDATE inventory_batches SET qty_remaining = qty_remaining - ?, note = ? WHERE id = ?",
            [remainingToDeduct, newNote, batch.id],
          );
          remainingToDeduct = 0;
        } else {
          remainingToDeduct -= batch.qty_remaining;
          await API.db_execute(
            "UPDATE inventory_batches SET qty_remaining = 0, note = ? WHERE id = ?",
            [newNote, batch.id],
          );
        }
      }
      window.showToast?.("Đã ghi nhận xuất hủy thành công!", "success");
      window.closeWasteModal();
      window.loadInventory();
    } catch (err) {
      console.error(err);
      window.showToast?.("Lỗi khi xử lý xuất hủy!", "error");
    } finally {
      await window.showLoader(false);
    }
  };

  // ==========================================
  // 5. LỊCH SỬ LÔ HÀNG
  // ==========================================
  window.viewBatchHistory = async (ingredientId, ingredientName) => {
    $("batch-ingredient-name").innerText = `Lịch sử lô hàng: ${ingredientName}`;
    const tbody = $("batch-list-body");

    await window.showLoader(true);
    try {
      const batches = await API.db_query(
        "SELECT * FROM inventory_batches WHERE ingredient_id = ? ORDER BY import_date DESC, id DESC",
        [ingredientId],
      );

      if (!batches.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center no-data">Chưa có lịch sử.</td></tr>`;
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
                : "font-weight:bold; color: var(--color-highlight-danger); font-size: 16px;";
            const formattedNote = window
              .escHtml(b.note || "")
              .replace(/\n/g, "<br>");

            return `
            <tr style="${trStyle}">
              <td>${b.import_date || "--"}</td>
              <td class="text-center">${window.formatNumber(b.qty_imported)}</td>
              <td class="text-center text-highlight">${window.formatNumber(Math.round(batchUnitPrice))}đ</td>
              <td class="text-center" style="${qtyStyle}">${window.formatNumber(b.qty_remaining)}</td>
              <td class="text-center">${b.expiry_date ? b.expiry_date.split("-").reverse().join("/") : "---"}</td>
              <td style="font-size: 12px; line-height: 1.4;">${formattedNote}</td>
            </tr>`;
          })
          .join("");
      }
      $("batch-modal").classList.add("flex");
    } catch (err) {
      console.error(err);
      window.showToast?.("Lỗi tải lịch sử", "error");
    } finally {
      await window.showLoader(false);
    }
  };

  window.closeBatchModal = () => $("batch-modal").classList.remove("flex");

  // Khởi chạy ngầm tải dữ liệu bảng chính khi vừa load file
  if (typeof window.loadInventory === "function") {
    setTimeout(() => window.loadInventory(), 100);
  }
})();
