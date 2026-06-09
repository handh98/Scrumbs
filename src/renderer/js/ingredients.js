(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  window.currentEditId ??= null;
  window.allIngredients ??= [];
  window.currentPage ??= 1;
  window.currentIngType ??= "ingredient";

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
    window.currentIngType = targetType;
    window.currentPage = 1;
    window.ingredientsSourceData = null; // Clear typed cache

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
    window.toggleLoader(true);
    window.currentKeyword ??= "";

    try {
      if (!window.ingredientsSourceData) {
        const raw = await API.db_query(
          `SELECT id, name, price, qty, unit, unit_price, note, type
           FROM ingredients 
           WHERE type = ? AND is_active = 1
           ORDER BY id DESC`,
          [window.currentIngType],
        );
        raw.forEach((i) => (i._normalizedName = window.removeAccents(i.name)));
        window.ingredientsSourceData = raw;
      }

      const kw = window.removeAccents(window.currentKeyword);
      window.allIngredients = window.ingredientsSourceData.filter((i) =>
        i._normalizedName.includes(kw),
      );

      if (window.currentPage > 1 && window.allIngredients?.length) {
        window.currentPage =
          Math.min(
            window.currentPage,
            Math.ceil(window.allIngredients.length / itemsPerPage),
          ) || 1;
      }

      if (window.allIngredients && window.allIngredients.length > 0) {
        const pagingResult = window.getPagination(
          window.allIngredients,
          itemsPerPage,
          window.currentPage,
          (newPage) => {
            window.currentPage = newPage;
            loadIngredients();
          },
        );

        const startIndex = (window.currentPage - 1) * itemsPerPage;
        tbody.innerHTML = pagingResult.data
          .map((item, index) => {
            const globalIndex = startIndex + index + 1;
            const displayPrice = window.formatNumber(item.unit_price);
            const currentNote = item.note?.trim() || "";

            return `
            <tr>
              <td class="text-center">${globalIndex}</td>
              <td class="text-center"><b>${item.name}</b></td>
              <td class="text-center" style="font-weight:bold; color:var(--deep-pink); white-space: nowrap;">
                ${displayPrice} đ <small style="color:#bcaaa4; font-weight:normal;">/${item.unit || "đv"}</small>
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
      window.toggleLoader(false);
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

    if (!name) return window.showToast?.("Vui lòng nhập tên!", "warning");

    // Chỉ bắt buộc nhập số lượng và tính unitPrice khi thêm mới
    if (!window.currentEditId && qty <= 0) {
      return window.showToast?.(
        "Khối lượng/Số lượng phải lớn hơn 0!",
        "warning",
      );
    }

    const unitPrice = qty > 0 ? parseFloat((price / qty).toFixed(2)) : 0;

    window.toggleLoader(true);
    try {
      window.ingredientsSourceData = null; // Invalidate cache

      // Tối ưu: Kiểm tra trùng tên bằng SQL thay vì filter JS
      const checkSql = window.currentEditId
        ? "SELECT id FROM ingredients WHERE LOWER(name) = ? AND id != ? LIMIT 1"
        : "SELECT id FROM ingredients WHERE LOWER(name) = ? LIMIT 1";
      const checkParams = window.currentEditId
        ? [name.toLowerCase(), window.currentEditId]
        : [name.toLowerCase()];
      const duplicateRows = await API.db_query(checkSql, checkParams);

      if (duplicateRows?.length > 0) {
        return window.showToast?.(
          "Tên này đã tồn tại trong hệ thống!",
          "warning",
        );
      }

      if (window.currentEditId) {
        await API.db_execute(
          "UPDATE ingredients SET name=?, price=?, qty=?, unit=?, unit_price=?, note=?, type=? WHERE id=?",
          [name, price, qty, unit, unitPrice, note, type, window.currentEditId],
        );
        window.currentEditId = null;
        window.showToast?.("Cập nhật thành công!", "success");
      } else {
        await API.db_execute(
          "INSERT INTO ingredients (name, price, qty, unit, unit_price, note, type) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [name, price, qty, unit, unitPrice, note, type],
        );
        window.showToast?.("Thêm thành công!", "success");
      }

      resetForm();
      await loadIngredients();
    } catch (error) {
      console.error("Lỗi khi lưu DB:", error);
      window.showToast?.("Lỗi cơ sở dữ liệu!", "error");
    } finally {
      window.toggleLoader(false);
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
      window.currentEditId = item.id;
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
      if (window.currentIngType === "package") {
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
          `Bạn có chắc muốn xóa ${window.currentIngType === "package" ? "bao bì" : "nguyên liệu"} này?`,
        ))
      )
        return;

      window.ingredientsSourceData = null; // Invalidate cache
      await API.db_execute(
        "UPDATE ingredients SET is_active = 0 WHERE id = ?",
        [id],
      );
      window.showToast?.(
        `Đã xóa ${window.currentIngType === "package" ? "bao bì" : "nguyên liệu"}!`,
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
    window.currentKeyword = $("ing-search")?.value.trim() || "";
    window.currentPage = 1;
    loadIngredients();
  }, 300);

  function resetForm() {
    const els = getFormElements();
    if (els.name) els.name.value = "";
    if (els.price) els.price.value = "";
    if (els.qty) els.qty.value = "";
    if (els.note) els.note.value = "";
    if (els.unit) {
      const isPackage = window.currentIngType === "package";
      els.unit.value = isPackage ? "cái" : "gam";
      els.unit.disabled = isPackage;
    }
    if (els.display) els.display.innerText = "0 đ";

    window.currentEditId = null;
    if (els.formTitle)
      els.formTitle.innerText =
        window.currentIngType === "package"
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
    [els.price, els.qty].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", () => {
        window.formatInputOnType(el);
        calculateUnitPrice();
      });
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
