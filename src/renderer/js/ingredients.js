(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  // Quy hoạch State để tránh lỗi NaN và xung đột biến
  window.ingredientState = {
    editingId: null,
    filteredData: [],
    sourceData: null,
    currentPage: 1,
    type: "ingredient",
    keyword: "",
  };

  function getFormElements() {
    return {
      name: $("ing-name"),
      price: $("ing-total-price"),
      qty: $("ing-total-qty"),
      note: $("ing-note"),
      type: $("ing-type"),
      unit: $("ing-unit"),
      display: $("unit-price-display"),
      formTitle: $("form-title"),
      saveBtn: $("save-btn"),
    };
  }

  function calculateUnitPrice() {
    const els = getFormElements();
    if (!els.price || !els.qty || !els.display) return;

    const price = window.unformatNumber(els.price.value);
    const qty = window.unformatNumber(els.qty.value);

    if (price >= 0 && qty > 0) {
      const unitPrice = price / qty;
      els.display.innerText = window.formatNumber(unitPrice.toFixed(2)) + " đ";
    } else {
      els.display.innerText = "0 đ";
    }
  }

  async function handleGlobalTabSwitch(targetType) {
    window.ingredientState.type = targetType;
    window.ingredientState.currentPage = 1;
    window.ingredientState.sourceData = null; // Clear typed cache

    const tabIngredient = $("tab-btn-ingredient");
    const tabPackage = $("tab-btn-package");
    const lblName = $("lbl-ing-name");
    const thDynamicName = $("th-dynamic-name");
    const els = getFormElements();

    const isPackage = targetType === "package";

    if (tabPackage) tabPackage.classList.toggle("active", isPackage);
    if (tabIngredient) tabIngredient.classList.toggle("active", !isPackage);

    if (els.formTitle)
      els.formTitle.innerText = isPackage
        ? "Thêm Vật Tư Đóng Gói"
        : "Thêm Nguyên Liệu";
    if (lblName)
      lblName.innerHTML = isPackage
        ? `Tên vật tư đóng gói <span class="required">*</span>`
        : `Tên nguyên liệu <span class="required">*</span>`;
    if (thDynamicName)
      thDynamicName.innerText = isPackage
        ? "Tên vật tư đóng gói"
        : "Tên nguyên liệu";
    if (els.type) els.type.value = targetType;

    resetForm();
    await loadIngredients();
  }

  async function loadIngredients() {
    const tbody = $("ing-list-body");
    const paginationContainer = $("pagination-container");
    if (!tbody) return;

    try {
      await window.showLoader(true);

      // ĐỒNG BỘ UI VỚI STATE (Đảm bảo ô tìm kiếm khớp với bộ lọc đang chạy)
      const searchInput = $("ing-search");
      if (searchInput) {
        window.ingredientState.keyword = searchInput.value.trim();
      }

      // Đồng bộ Tab đang hiển thị với loại dữ liệu đang nạp
      const tabIngredient = $("tab-btn-ingredient");
      const tabPackage = $("tab-btn-package");
      if (tabIngredient && tabPackage) {
        const isPackage = window.ingredientState.type === "package";
        tabPackage.classList.toggle("active", isPackage);
        tabIngredient.classList.toggle("active", !isPackage);
      }

      if (!window.ingredientState.sourceData) {
        const raw = await API.db_query(
          `SELECT id, name, price, qty, unit, unit_price, note, type
           FROM ingredients
           WHERE type = ? AND is_active = 1
           ORDER BY id DESC`,
          [window.ingredientState.type],
        );
        raw.forEach((i) => (i._normalizedName = window.removeAccents(i.name)));
        window.ingredientState.sourceData = raw;
      }

      const kw = window.removeAccents(window.ingredientState.keyword);
      window.ingredientState.filteredData =
        window.ingredientState.sourceData.filter((i) =>
          i._normalizedName.includes(kw),
        );

      // Kích hoạt hiệu ứng fade-in mượt mà khi đổi Tab hoặc phân trang
      tbody.classList.remove("fade-in");
      void tbody.offsetWidth; // Trigger reflow để restart animation
      tbody.classList.add("fade-in");

      const pagingResult = window.getPagination(
        window.ingredientState.filteredData || [],
        itemsPerPage,
        window.ingredientState.currentPage,
        (newPage) => {
          window.ingredientState.currentPage = newPage;
          loadIngredients();
        },
      );

      if (
        window.ingredientState.filteredData &&
        window.ingredientState.filteredData.length > 0
      ) {
        const startIndex =
          (window.ingredientState.currentPage - 1) * itemsPerPage;
        tbody.innerHTML = pagingResult.data
          .map((item, index) => {
            const globalIndex = startIndex + index + 1;
            const displayPrice = window.formatNumber(item.unit_price);
            const currentNote = item.note?.trim() || "";

            return `
            <tr>
              <td class="text-center">${globalIndex}</td>
              <td class="text-center"><b>${item.name}</b></td>
              <td class="text-center" style="font-weight:bold; color:var(--color-highlight-danger); white-space: nowrap;">
                ${displayPrice} đ <small style="color:var(--color-text-muted); font-weight:normal;">/${item.unit || "đv"}</small>
              </td>
              <td class="text-center note-column has-tooltip" data-note="${currentNote || "..."}">
                ${currentNote || "..."}
              </td>
              <td class="action-column">
                <button class="btn-secondary btn-edit" onclick="editIng(${item.id})"><img src="src/renderer/assets/edit.svg" class="icon" /></button>
                <button class="btn-secondary btn-delete" onclick="deleteIng(${item.id})"><img src="src/renderer/assets/trash.svg" class="icon" /></button>
              </td>
            </tr>`;
          })
          .join("");

        if (paginationContainer)
          paginationContainer.innerHTML = pagingResult.html;
        window.TooltipComponent?.init();
      } else {
        tbody.innerHTML = `<tr><td colspan="5" class="no-data">Không có dữ liệu vật tư nào...</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
      }
    } catch (err) {
      console.error("Lỗi nạp dữ liệu vật tư:", err);
    } finally {
      window.showLoader(false);
    }
  }

  async function saveIngredient() {
    const els = getFormElements();
    if (!els.name || !els.price || !els.qty || !els.type || !els.unit) return;

    const name = els.name.value.trim();
    const type = els.type.value;
    const note = els.note.value.trim();
    const unit = els.unit.value;

    // Dùng hàm unformatNumber để đưa về số trước khi lưu
    const price = window.unformatNumber(els.price.value);
    const qty = window.unformatNumber(els.qty.value);

    // Validation
    const errors = window.validateFields(
      { name, price, qty, unit },
      {
        name: {
          required: true,
          minLength: 2,
          maxLength: 100,
          requiredMsg: "Tên nguyên liệu không được trống",
          minLengthMsg: "Tên phải có ít nhất 2 ký tự",
          maxLengthMsg: "Tên không được vượt quá 100 ký tự",
        },
        price: {
          required: true,
          min: 0,
          minMsg: "Giá không được âm",
        },
        qty: {
          required: !window.ingredientState.editingId,
          min: window.ingredientState.editingId ? -1 : 0,
          minMsg: "Số lượng phải lớn hơn 0",
        },
        unit: {
          required: true,
          requiredMsg: "Vui lòng chọn đơn vị",
        },
      },
    );

    if (Object.keys(errors).length > 0) {
      const errorMsg = Object.values(errors).join("\n");
      window.showToast?.(errorMsg, "warning");
      return;
    }

    const unitPrice = qty > 0 ? parseFloat((price / qty).toFixed(2)) : 0;

    await window.showLoader(true);
    try {
      window.ingredientState.sourceData = null; // Invalidate cache

      // Tối ưu: Kiểm tra trùng tên bằng SQL thay vì filter JS
      const checkSql = window.ingredientState.editingId
        ? "SELECT id FROM ingredients WHERE LOWER(name) = ? AND id != ? LIMIT 1"
        : "SELECT id FROM ingredients WHERE LOWER(name) = ? LIMIT 1";
      const checkParams = window.ingredientState.editingId
        ? [name.toLowerCase(), window.ingredientState.editingId]
        : [name.toLowerCase()];
      const duplicateRows = await API.db_query(checkSql, checkParams);

      if (duplicateRows?.length > 0) {
        return window.showToast?.(
          "Tên này đã tồn tại trong hệ thống!",
          "warning",
        );
      }

      if (window.ingredientState.editingId) {
        await API.db_execute(
          "UPDATE ingredients SET name=?, price=?, qty=?, unit=?, unit_price=?, note=?, type=? WHERE id=?",
          [
            name,
            price,
            qty,
            unit,
            unitPrice,
            note,
            type,
            window.ingredientState.editingId,
          ],
        );
        window.ingredientState.editingId = null;
        window.showToast?.("Cập nhật thành công!", "success");
      } else {
        await API.db_execute(
          "INSERT INTO ingredients (name, price, qty, unit, unit_price, note, type) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [name, price, qty, unit, unitPrice, note, type],
        );
        window.showToast?.("Thêm thành công!", "success");
      }

      // Đợi load dữ liệu xong mới thực hiện các bước tiếp theo.
      // loadIngredients() cũng gọi showLoader, nhưng giờ đã có counter xử lý.
      await loadIngredients();
    } catch (error) {
      console.error("Lỗi khi lưu DB:", error);
      window.showToast?.(
        `Lỗi cơ sở dữ liệu: ${error.message || "Không xác định"}`,
        "error",
      );
    } finally {
      await window.showLoader(false);
      // Đảm bảo mọi hiệu ứng UI đã hoàn tất trước khi reset form và focus
      setTimeout(() => resetForm(), 400);
    }
  }

  async function editIng(id) {
    try {
      const rows = await API.db_query(
        "SELECT * FROM ingredients WHERE id = ?",
        [id],
      );
      if (!rows?.length) return;

      const item = rows[0];
      window.ingredientState.editingId = item.id;
      const els = getFormElements();

      if (els.name) els.name.value = item.name || "";
      if (els.price) els.price.value = window.formatNumber(item.price);
      if (els.qty) els.qty.value = window.formatNumber(item.qty);

      if (els.note) els.note.value = item.note || "";
      if (els.type) els.type.value = item.type || "ingredient";
      if (els.unit) {
        els.unit.value = item.unit || (item.type === "package" ? "cái" : "gam");
        els.unit.disabled = item.type === "package";
      }

      if (els.formTitle)
        els.formTitle.innerText =
          item.type === "package" ? "Sửa Vật Tư Đóng Gói" : "Sửa Nguyên Liệu";
      if (els.saveBtn) {
        els.saveBtn.classList.add("btn-save-edit");
        els.saveBtn.innerText = "Lưu thay đổi";
      }

      calculateUnitPrice();
      if (els.name) els.name.focus();
    } catch (error) {
      console.error("Lỗi lấy thông tin sửa:", error);
    }
  }

  async function deleteIng(id) {
    try {
      if (window.ingredientState.type === "package") {
        const pkgCheck = await API.db_query(
          `SELECT m.name FROM menu_items m
           JOIN menu_packaging mp ON m.id = mp.menu_item_id
           WHERE mp.ingredient_id = ? AND m.is_active = 1`,
          [id],
        );
        if (pkgCheck?.length)
          return window.showToast?.(
            `Bao bì đang dùng trong món: ${pkgCheck.map((m) => m.name).join(", ")}`,
            "warning",
          );
      } else {
        const recipeCheck = await API.db_query(
          `SELECT r.name FROM recipes r
           JOIN recipe_ingredients ri ON r.id = ri.recipe_id
           WHERE ri.ingredient_id = ? AND r.is_active = 1
           UNION
           SELECT m.name FROM menu_items m
           JOIN menu_ingredients mi ON m.id = mi.menu_item_id
           WHERE mi.ingredient_id = ? AND m.is_active = 1`,
          [id, id],
        );
        if (recipeCheck?.length)
          return window.showToast?.(
            `Nguyên liệu đang được dùng trong: ${recipeCheck.map((r) => r.name).join(", ")}`,
            "warning",
          );
      }

      if (
        window.showConfirm &&
        !(await window.showConfirm(
          "Xác nhận xóa",
          `Bạn có chắc muốn xóa ${window.ingredientState.type === "package" ? "bao bì" : "nguyên liệu"} này?`,
        ))
      )
        return;

      window.ingredientState.sourceData = null; // Invalidate cache
      await API.db_execute(
        "UPDATE ingredients SET is_active = 0 WHERE id = ?",
        [id],
      );
      window.showToast?.(
        `Đã xóa ${window.ingredientState.type === "package" ? "bao bì" : "nguyên liệu"}!`,
        "success",
      );
      window.invalidateAndReload("fillingOptions", null); // Invalidate filling options cache
      window.invalidateAndReload("menuSourceData", null); // Invalidate menu list cache
      await loadIngredients();
    } catch (error) {
      console.error("Lỗi thực thi xóa:", error);
    }
  }

  const searchIng = window.debounce(() => {
    window.ingredientState.keyword = $("ing-search")?.value.trim() || "";
    window.ingredientState.currentPage = 1;
    loadIngredients();
  }, 300);

  function resetForm() {
    const els = getFormElements();
    if (els.name) els.name.value = "";
    if (els.price) els.price.value = "";
    if (els.qty) els.qty.value = "";
    if (els.note) els.note.value = "";
    if (els.unit) {
      const isPackage = window.ingredientState.type === "package";
      els.unit.value = isPackage ? "cái" : "gam";
      els.unit.disabled = isPackage;
    }
    if (els.display) els.display.innerText = "0 đ";

    window.ingredientState.editingId = null;
    if (els.formTitle)
      els.formTitle.innerText =
        window.ingredientState.type === "package"
          ? "Thêm Vật Tư Đóng Gói"
          : "Thêm Nguyên Liệu";
    if (els.saveBtn) {
      els.saveBtn.classList.remove("btn-save-edit");
      els.saveBtn.innerText = "Lưu thông tin";
    }
    if (els.name) els.name.focus();
  }

  // Khởi tạo listeners cho việc định dạng input tự động
  function initInputFormatters() {
    const els = getFormElements();
    const inputs = [els.price, els.qty];

    inputs.forEach((el) => {
      if (!el) return;
      if (el.dataset.listenerAttached) return; // Tránh gắn trùng listener

      el.addEventListener("input", () => {
        window.formatInputOnType(el);
        calculateUnitPrice();
      });
      el.dataset.listenerAttached = "true";
    });
  }

  Object.assign(window, {
    loadIngredients,
    calculateUnitPrice,
    saveIngredient,
    editIng,
    deleteIng,
    searchIng,
    resetForm,
    handleGlobalTabSwitch,
  });

  // Lắng nghe sự thay đổi DOM để init formatters khi trang được load
  const observer = new MutationObserver(() => {
    if ($("ing-total-price")) {
      initInputFormatters();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
