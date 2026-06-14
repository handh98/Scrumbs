(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  // Khởi tạo state toàn cục (Global State) gọn gàng với toán tử ??=
  window.currentRecipeId ??= null;
  window.allRecipes ??= [];
  window.currentPageRecipes ??= 1;
  window.recipeKeyword ??= "";
  window.cachedIngredients ??= [];
  window.selectedPickerIng ??= null;
  window.recipeIngredientsList ??= [];
  window.pickerDisplayedCount ??= 20;
  window.pickerFilteredList ??= [];
  window.recipesSourceData ??= null;
  window.activeRecipeTab ??= "all";

  let currentModalMode = "view"; // "view" | "edit" | "add"

  function toggleInputStates() {
    const modal = $("recipe-modal");
    if (!modal) return;

    // Toggle CSS class
    modal.classList.toggle("view-mode", currentModalMode === "view");

    // Xử lý nút Toggle Mode
    const toggleBtn = $("btn-toggle-mode");
    if (toggleBtn) {
      toggleBtn.style.display =
        currentModalMode === "add" ? "none" : "inline-flex";
      toggleBtn.innerHTML =
        currentModalMode === "view" ? "Chỉnh Sửa" : "Xem Chi Tiết";
    }

    const isView = currentModalMode === "view";

    // Tên bánh
    if ($("rec-name")) $("rec-name").disabled = isView;

    // Các trường dữ liệu cơ bản cần check ẩn/hiện nếu rỗng
    ["rec-cook-time", "rec-output-text", "rec-note", "rec-type"].forEach(
      (id) => {
        const input = $(id);
        if (!input) return;

        const groupWrapper =
          input.closest(".form-group") || input.closest(".note-group");
        if (!groupWrapper) return;

        input.disabled = isView;
        const isEmpty = !input.value?.trim() || input.value === "0";
        groupWrapper.classList.toggle("hide-empty", isView && isEmpty);
      },
    );

    // Box chat textareas
    modal.querySelectorAll(".steps-vertical-list textarea").forEach((ta) => {
      ta.disabled = isView;
      if (isView) {
        ta.style.height = "auto";
        setTimeout(() => (ta.style.height = ta.scrollHeight + "px"), 10);
      } else {
        ta.style.height = "";
      }
    });
  }

  async function loadRecipes() {
    window.toggleLoader(true);
    try {
      const tbody = $("recipe-list-body");
      const paginationContainer = $("recipes-pagination");
      if (!tbody) return;

      // Đồng bộ keyword từ UI để đảm bảo state luôn khớp với ô nhập liệu
      const searchInput = $("recipe-search");
      if (searchInput) {
        window.recipeKeyword = searchInput.value.trim();
      }

      const activeTab = window.activeRecipeTab || "all";
      let whereClause = " WHERE r.is_active = 1";
      let params = [];

      if (activeTab !== "all") {
        whereClause += " AND r.recipe_type = ?";
        params.push(activeTab);
      }

      if (window.recipeKeyword) {
        // Escape dấu ngoặc kép và bọc từ khóa để tránh lỗi cú pháp FTS5 khi có dấu cách
        const safeKeyword = window.recipeKeyword.trim().replace(/"/g, '""');
        whereClause += " AND fts MATCH ?"; // Sử dụng alias fts để đồng bộ với JOIN
        params.push(`${safeKeyword}*`);
      }

      const joinClause = window.recipeKeyword
        ? " INNER JOIN recipes_fts fts ON r.id = fts.rowid "
        : "";

      // 1. Lấy tổng số lượng bản ghi để phân trang
      const countRes = await API.db_query(
        `SELECT COUNT(*) as total FROM recipes r ${joinClause} ${whereClause}`,
        params,
      );
      const totalItems = countRes[0].total;
      const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

      if (window.currentPageRecipes > totalPages)
        window.currentPageRecipes = totalPages;

      // 2. Lấy dữ liệu trang hiện tại
      const offset = (window.currentPageRecipes - 1) * itemsPerPage;
      const sql = `
         SELECT r.* ${window.recipeKeyword ? ", fts.ingredients" : ""}
         FROM recipes r ${joinClause}
         ${whereClause}
         ORDER BY r.id DESC
         LIMIT ? OFFSET ?
      `;

      const data = await API.db_query(sql, [...params, itemsPerPage, offset]);
      window.allRecipes = data || [];

      if (window.allRecipes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="no-data text-center">🍁 Chưa có công thức bánh nào. Hãy nhấn "Thêm công thức mới"!</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        new Array(totalItems),
        itemsPerPage,
        window.currentPageRecipes,
        (newPage) => {
          window.currentPageRecipes = newPage;
          loadRecipes();
        },
      );

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;

      tbody.innerHTML = data
        .map((item, index) => {
          const stt =
            (window.currentPageRecipes - 1) * itemsPerPage + index + 1;
          const safeName = item.name.replace(/'/g, "\\'");
          const note = item.note?.trim() || "...";

          // Logic hiển thị nguyên liệu khớp từ khóa
          let matchHtml = "";
          if (window.recipeKeyword && item.ingredients) {
            const kw = window.removeAccents(window.recipeKeyword);
            const matchedIngs = item.ingredients
              .split("|")
              .filter((name) => window.removeAccents(name).includes(kw));

            if (matchedIngs.length > 0) {
              matchHtml = `<div class="matched-ingredients-tags">
                ${matchedIngs.map((name) => `<span class="ing-match-tag">${name}</span>`).join("")}
              </div>`;
            }
          }

          return `
          <tr>
            <td class="text-center">${stt}</td>
            <td class="text-center font-weight-bold">${item.name}${matchHtml}</td>
            <td class="text-center">${item.cook_time ? item.cook_time + " phút" : "---"}</td>
          <td class="text-center">${item.output || "---"}</td>
            <td class="text-danger font-weight-bold text-center">${window.formatNumber(Math.round(item.total_cost))} đ</td>
            <td class="text-center note-column has-tooltip" data-note="${note}">${note}</td>
            <td class="action-column text-center">
                <button class="btn-secondary btn-view" onclick="window.openRecipeModal('view', ${item.id})" title="Xem chi tiết"><img src="src/renderer/assets/view.svg" alt="View" class="icon" /></button>
                <button class="btn-secondary btn-edit" onclick="window.openRecipeModal('edit', ${item.id})" title="Sửa"><img src="src/renderer/assets/edit.svg" alt="Edit" class="icon" /></button>
                <button class="btn-secondary btn-delete" onclick="window.deleteRecipe(${item.id}, '${safeName}')" title="Xóa"><img src="src/renderer/assets/trash.svg" alt="Trash" class="icon" /></button>
            </td>
          </tr>`;
        })
        .join("");
      window.TooltipComponent?.init();
    } catch (error) {
      console.error("Lỗi tải công thức:", error);
      window.showToast?.("Không thể tải danh sách công thức.", "error");
    } finally {
      window.toggleLoader(false);
    }
  }

  const searchRecipes = window.debounce(() => {
    const searchVal = $("recipe-search")?.value.trim() || "";
    window.recipeKeyword = searchVal;
    window.currentPageRecipes = 1;
    loadRecipes();

    if (searchVal === "") loadRecipes(); // Đảm bảo nạp lại ngay khi xóa trắng
  }, 250);

  async function openRecipeModal(mode, recipeId = null) {
    currentModalMode = mode || "view";
    window.currentRecipeId = recipeId;

    // Reset Form
    [
      "rec-name",
      "rec-cook-time",
      "rec-output-text",
      "rec-note",
      "steps-list-container",
      "ing-search-picker", // Thêm vào để clear ô tìm kiếm nguyên liệu
      "ing-qty-picker", // Thêm vào để clear ô số lượng nguyên liệu
    ].forEach((id) => {
      if ($(id))
        $(id)[id === "steps-list-container" ? "innerHTML" : "value"] = "";
    });
    window.recipeIngredientsList = [];
    window.selectedPickerIng = null; // Reset trạng thái nguyên liệu đã chọn
    if ($("selected-ing-unit-lbl"))
      $("selected-ing-unit-lbl").innerText = "Đơn vị: --";

    const modalTitle = $("modal-title");
    if (modalTitle) {
      modalTitle.innerText =
        currentModalMode === "view"
          ? "Chi Tiết Công Thức"
          : currentModalMode === "edit"
            ? "Chỉnh Sửa Công Thức"
            : "Thêm Công Thức Mới";
    }

    toggleInputStates();

    window.toggleLoader(true);
    try {
      window.cachedIngredients = await API.db_query(
        "SELECT id, name, unit, unit_price FROM ingredients WHERE is_active = 1 AND type = 'ingredient' ORDER BY name ASC",
      );

      if (recipeId) {
        const [recipe] = await API.db_query(
          "SELECT * FROM recipes WHERE id = ?",
          [recipeId],
        );
        if (recipe) {
          $("rec-name").value = recipe.name || "";
          if ($("rec-type"))
            $("rec-type").value = recipe.recipe_type || "general";
          $("rec-cook-time").value = recipe.cook_time || "";
          $("rec-output-text").value =
            recipe.output && parseInt(recipe.output) > 0 ? recipe.output : 1;
          $("rec-note").value = recipe.note || "";

          if (recipe.steps_json) {
            try {
              JSON.parse(recipe.steps_json).forEach((step) =>
                window.addStepRow(step),
              );
            } catch (e) {
              console.error("Lỗi parse bước làm:", e);
            }
          }

          const components = await API.db_query(
            `SELECT ri.ingredient_id AS id, i.name, ri.qty, i.unit, i.unit_price 
             FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?`,
            [recipeId],
          );

          window.recipeIngredientsList = components.map((c) => ({
            ...c,
            cost: c.qty * c.unit_price,
          }));
        }
      } else {
        window.addStepRow("");
        if ($("rec-output-text")) {
          $("rec-output-text").value = 1; // Mặc định là 1 khi thêm mới
        }
      }

      renderIngredientsStructure();
      toggleInputStates();
      if ($("recipe-modal")) $("recipe-modal").style.display = "flex";
    } catch (error) {
      console.error("Lỗi mở modal:", error);
      window.showToast?.("Gặp lỗi khi tải dữ liệu.", "error");
    } finally {
      window.toggleLoader(false);
    }
  }

  function closeRecipeModal() {
    if ($("recipe-modal")) $("recipe-modal").style.display = "none";
    window.currentRecipeId = null;
    // Đảm bảo các trường picker cũng được reset khi đóng modal
    if ($("ing-search-picker")) $("ing-search-picker").value = "";
    window.recipeIngredientsList = [];
    window.selectedPickerIng = null;
  }

  function renderIngredientsStructure() {
    const tbody = $("recipe-ing-body");
    const totalDisplay = $("total-cost-display");
    if (!tbody) return;

    if (!window.recipeIngredientsList?.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #999;">Chưa có nguyên liệu nào được thêm!</td></tr>`;
      if (totalDisplay) totalDisplay.innerText = "0 đ";
      return;
    }

    let totalCost = 0;
    tbody.innerHTML = window.recipeIngredientsList
      .map((ing, idx) => {
        const cost = ing.qty * ing.unit_price;
        totalCost += cost;
        return `
        <tr>
          <td>${idx + 1}</td>
          <td class="font-weight-bold">${ing.name}</td>
          <td>${currentModalMode === "view" ? `<span>${ing.qty}</span>` : `<input type="number" class="table-qty-input" value="${ing.qty}" oninput="window.updateIngRowQty(${ing.id}, this.value)" onfocus="this.select()" min="0.01" step="any" />`}</td>
          <td><span class="badge-unit">${ing.unit}</span></td>
          <td class="text-right font-weight-bold">${window.formatNumber(Math.round(cost))} đ</td>
          <td class="edit-visible"><button type="button" class="btn-delete-row" onclick="window.removeIngRow(${ing.id})">❌</button></td>
        </tr>`;
      })
      .join("");

    if (totalDisplay)
      totalDisplay.innerText =
        window.formatNumber(Math.round(totalCost)) + " đ";
  }

  async function saveRecipe() {
    const val = (id) => $(id)?.value.trim() || "";
    const name = val("rec-name");
    const type = $("rec-type")?.value || "general";
    const cookTime = parseInt(val("rec-cook-time")) || 0;
    const outputValue = parseInt(val("rec-output-text")) || 1;
    const note = val("rec-note");

    if (!name) return window.showToast?.("Vui lòng nhập tên bánh!", "warning");
    if (!window.recipeIngredientsList.length)
      return window.showToast?.(
        "Vui lòng chọn ít nhất một nguyên liệu!",
        "warning",
      );

    if (outputValue <= 0) {
      return window.showToast?.(
        "Vui lòng nhập định lượng sản phẩm (phải lớn hơn 0)!",
        "warning",
      );
    }

    const steps = Array.from($$(".step-textarea"))
      .map((input) => input.value.trim())
      .filter(Boolean);
    const stepsJson = JSON.stringify(steps);

    window.toggleLoader(true);
    try {
      window.recipesSourceData = null; // Invalidate cache

      // Kiểm tra trùng tên (không phân biệt hoa thường, bao gồm cả dấu tiếng Việt)
      // Kiểm tra trên toàn bộ bảng để đảm bảo tính duy nhất tuyệt đối
      const allItems = await API.db_query("SELECT id, name FROM recipes");
      const lowerName = name.toLowerCase();
      const isDuplicate = allItems.some(
        (item) =>
          item.name.toLowerCase() === lowerName &&
          (window.currentRecipeId ? item.id !== window.currentRecipeId : true),
      );

      if (isDuplicate) {
        return window.showToast?.(
          "Tên công thức bánh này đã tồn tại!",
          "warning",
        );
      }

      let targetRecipeId = window.currentRecipeId;

      if (targetRecipeId) {
        await API.db_execute(
          "UPDATE recipes SET name=?, recipe_type=?, cook_time=?, output=?, steps_json=?, note=? WHERE id=?",
          [name, type, cookTime, outputValue, stepsJson, note, targetRecipeId],
        );
        await API.db_execute(
          "DELETE FROM recipe_ingredients WHERE recipe_id=?",
          [targetRecipeId],
        );
      } else {
        await API.db_execute(
          "INSERT INTO recipes (name, recipe_type, cook_time, output, steps_json, note) VALUES (?, ?, ?, ?, ?, ?)",
          [name, type, cookTime, outputValue, stepsJson, note],
        );
        const [{ id }] = await API.db_query("SELECT last_insert_rowid() AS id");
        targetRecipeId = id;
      }

      for (const ing of window.recipeIngredientsList) {
        await API.db_execute(
          "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty) VALUES (?, ?, ?)",
          [targetRecipeId, ing.id, ing.qty],
        );
      }

      window.showToast?.(
        window.currentRecipeId
          ? "Cập nhật thành công!"
          : "Thêm mới thành công!",
        "success",
      );
      window.loadRecipes?.();
      window.invalidateAndReload("fillingOptions", null); // Invalidate filling options cache
      window.invalidateAndReload("menuSourceData", null); // Invalidate menu list cache

      if (window.currentRecipeId)
        window.openRecipeModal("view", targetRecipeId);
      else closeRecipeModal();
    } catch (error) {
      console.error("Lỗi lưu DB:", error);
      window.showToast?.("Tên công thức bị trùng hoặc sự cố DB!", "error");
    } finally {
      window.toggleLoader(false);
    }
  }

  async function deleteRecipe(id, name) {
    try {
      // Kiểm tra xem công thức có đang được sử dụng trong menu nào không
      const menuCheck = await API.db_query(
        `SELECT m.name FROM menu_items m 
         JOIN menu_recipes mr ON m.id = mr.menu_item_id 
         WHERE mr.recipe_id = ? AND m.is_active = 1`,
        [id],
      );

      if (menuCheck?.length > 0) {
        const menuNames = menuCheck.map((m) => m.name).join(", ");
        return window.showToast?.(
          `Không thể xóa: Công thức đang được dùng trong món: ${menuNames}`,
          "warning",
        );
      }
    } catch (err) {
      console.error("Lỗi kiểm tra ràng buộc menu:", err);
    }

    if (
      window.showConfirm &&
      !(await window.showConfirm(
        "Xác nhận xóa",
        `Xóa công thức "${name}" khỏi danh sách?`,
      ))
    )
      return;
    try {
      window.recipesSourceData = null; // Invalidate cache
      await API.db_execute("UPDATE recipes SET is_active = 0 WHERE id = ?", [
        id,
      ]);
      window.showToast?.("Đã xóa công thức!", "success");
      window.invalidateAndReload("fillingOptions", null); // Invalidate filling options cache
      window.invalidateAndReload("menuSourceData", null); // Invalidate menu list cache
      loadRecipes();
    } catch (error) {
      console.error("Lỗi xóa:", error);
      window.showToast?.("Không thể thực hiện tác vụ này.", "error");
    }
  }

  // --- Picker Helpers ---
  function showAllIngredientsPicker() {
    if (currentModalMode === "view") return;
    window.pickerFilteredList = [...window.cachedIngredients];
    window.pickerDisplayedCount = 20;
    renderPickerDropdown();
  }

  const filterIngredientPicker = window.debounce(() => {
    const txt = $("ing-search-picker")?.value.trim() || "";
    const normalizedTxt = window.removeAccents(txt);
    window.pickerFilteredList = txt
      ? window.cachedIngredients.filter((i) =>
          (
            i._normalizedName ||
            (i._normalizedName = window.removeAccents(i.name))
          ).includes(normalizedTxt),
        )
      : [...window.cachedIngredients];
    window.pickerDisplayedCount = 20;
    renderPickerDropdown();
  }, 300);

  function renderPickerDropdown() {
    const dropdown = $("ing-picker-dropdown");
    if (!dropdown) return;

    const listToShow = window.pickerFilteredList.slice(
      0,
      window.pickerDisplayedCount,
    );
    if (!listToShow.length) {
      dropdown.innerHTML = `<div class="picker-no-result">Không tìm thấy vật tư</div>`;
    } else {
      dropdown.innerHTML = listToShow
        .map(
          (item) => `
        <div class="picker-item" onclick="window.selectIngFromPicker(${item.id})">
          <span class="picker-item-name">${item.name}</span>
          <span class="picker-item-price">${window.formatNumber(Math.round(item.unit_price))}đ/${item.unit}</span>
        </div>`,
        )
        .join("");
    }
    dropdown.style.display = "block";
  }

  function handlePickerScroll(e) {
    const el = e.target;
    if (
      el.scrollTop + el.clientHeight >= el.scrollHeight - 10 &&
      window.pickerDisplayedCount < window.pickerFilteredList.length
    ) {
      window.pickerDisplayedCount += 20;
      renderPickerDropdown();
    }
  }

  function selectIngFromPicker(id) {
    const target = window.cachedIngredients.find((i) => i.id === id);
    if (!target) return;

    window.selectedPickerIng = target;
    if ($("ing-search-picker")) $("ing-search-picker").value = target.name;
    if ($("selected-ing-unit-lbl"))
      $("selected-ing-unit-lbl").innerText = `Đơn vị: ${target.unit}`;
    if ($("ing-picker-dropdown"))
      $("ing-picker-dropdown").style.display = "none";

    const qtyInput = $("ing-qty-picker");
    if (qtyInput) {
      qtyInput.focus();
      qtyInput.select(); // Bôi đen để nhập đè ngay lập tức
    }
  }

  function addIngredientToRecipe() {
    if (!window.selectedPickerIng)
      return window.showToast?.("Vui lòng chọn một nguyên liệu!", "warning");
    const qtyInput = $("ing-qty-picker");
    const qty = parseFloat(qtyInput?.value) || 0;

    if (qty <= 0)
      return window.showToast?.("Số lượng định lượng phải > 0!", "warning");

    const existed = window.recipeIngredientsList.find(
      (i) => i.id === window.selectedPickerIng.id,
    );
    if (existed) {
      existed.qty += qty;
      existed.cost = existed.qty * existed.unit_price;
    } else {
      window.recipeIngredientsList.push({
        ...window.selectedPickerIng,
        qty,
        cost: qty * window.selectedPickerIng.unit_price,
      });
    }

    renderIngredientsStructure();

    if ($("ing-search-picker")) $("ing-search-picker").value = "";
    if ($("selected-ing-unit-lbl"))
      $("selected-ing-unit-lbl").innerText = "Đơn vị: --";
    if (qtyInput) qtyInput.value = "";
    window.selectedPickerIng = null;
    $("ing-search-picker")?.focus();
  }

  function updateIngRowQty(id, value) {
    const qty = parseFloat(value) || 0;
    const item = window.recipeIngredientsList.find((i) => i.id === id);
    if (item) {
      item.qty = qty;
      item.cost = qty * item.unit_price;
      const total = window.recipeIngredientsList.reduce(
        (sum, i) => sum + i.cost,
        0,
      );
      if ($("total-cost-display"))
        $("total-cost-display").innerText =
          `${window.formatNumber(Math.round(total))} đ`;
    }
  }

  function removeIngRow(id) {
    window.recipeIngredientsList = window.recipeIngredientsList.filter(
      (i) => i.id !== id,
    );
    renderIngredientsStructure();
  }

  function addStepRow(text = "") {
    const container = $("steps-list-container");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "step-row";
    div.innerHTML = `
      <span class="step-number">${container.children.length + 1}</span>
      <textarea class="step-textarea" placeholder="Mô tả nội dung..." rows="2" ${currentModalMode === "view" ? "disabled" : ""}>${text}</textarea>
      <button type="button" class="btn-delete-step edit-visible" onclick="this.parentElement.remove(); window.reIndexSteps();">❌</button>
    `;
    container.appendChild(div);
  }

  function reIndexSteps() {
    $("steps-list-container")
      ?.querySelectorAll(".step-row")
      .forEach((row, idx) => {
        const numSpan = row.querySelector(".step-number");
        if (numSpan) numSpan.innerText = idx + 1;
      });
  }

  document.addEventListener("click", (e) => {
    const picker = $("ing-search-picker");
    const drop = $("ing-picker-dropdown");
    if (
      drop &&
      picker &&
      !picker.contains(e.target) &&
      !drop.contains(e.target)
    )
      drop.style.display = "none";
  });

  // Lắng nghe phím Enter để điều hướng nhanh
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.target.id === "ing-qty-picker") {
        e.preventDefault();
        window.addIngredientToRecipe();
      } else if (e.target.id === "ing-search-picker") {
        // Nếu đang ở ô tìm kiếm, Enter sẽ chọn kết quả đầu tiên trong dropdown
        const firstItem = $("ing-picker-dropdown")?.querySelector(
          ".picker-item",
        );
        if (firstItem) {
          e.preventDefault();
          firstItem.click();
        }
      }
    }
  });

  window.switchRecipeTab = (type) => {
    window.activeRecipeTab = type;
    window.currentPageRecipes = 1;

    // Cập nhật trạng thái active cho UI
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === type);
    });

    loadRecipes();
  };

  function toggleRecipeMode() {
    currentModalMode = currentModalMode === "view" ? "edit" : "view";
    if ($("modal-title"))
      $("modal-title").innerText =
        currentModalMode === "view"
          ? "Chi Tiết Công Thức"
          : "Chỉnh Sửa Công Thức";
    toggleInputStates();
  }

  Object.assign(window, {
    loadRecipes,
    searchRecipes,
    openRecipeModal,
    closeRecipeModal,
    toggleRecipeMode,
    showAllIngredientsPicker,
    filterIngredientPicker,
    handlePickerScroll,
    selectIngFromPicker,
    addIngredientToRecipe,
    updateIngRowQty,
    removeIngRow,
    addStepRow,
    reIndexSteps,
    saveRecipe,
    deleteRecipe,
  });
})();
