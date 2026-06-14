(function () {
  const itemsPerPage = 5;
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
  window.currentViewedRecipe ??= null; // Lưu công thức đang xem để xuất PDF
  window.activeRecipeTab ??= "all";
  window.currentRecipeImageFile ??= null; // Lưu file ảnh tạm thời đã chọn
  window.recipeOriginalOutput ??= 1;
  window.recipeScaleFactor ??= 1;

  let currentModalMode = "view"; // "view" | "edit" | "add"

  function toggleInputStates() {
    const modal = $("recipe-modal");
    if (!modal) return;

    const isView = currentModalMode === "view";

    // Toggle CSS class
    modal.classList.toggle("view-mode", isView);

    // Xử lý nút Toggle Mode
    const toggleBtn = $("btn-toggle-mode");
    if (toggleBtn) {
      toggleBtn.style.display =
        currentModalMode === "add" ? "none" : "inline-flex";
      toggleBtn.innerHTML = isView ? "Chỉnh Sửa" : "Xem Chi Tiết";
    }

    // Nút Lưu & Nút xuất PDF
    if ($("btn-save-recipe"))
      $("btn-save-recipe").style.display = isView ? "none" : "inline-flex";
    if ($("export-pdf-btn"))
      $("export-pdf-btn").style.display = isView ? "inline-flex" : "none";

    // Vùng chọn nguyên liệu (Picker) và các nút thêm bước
    const pickerSection =
      $("ing-picker-section") || document.querySelector(".ing-picker-section");
    if (pickerSection) pickerSection.style.display = isView ? "none" : "block";

    const addStepBtn =
      $("btn-add-step") || document.querySelector(".btn-add-step");
    if (addStepBtn) addStepBtn.style.display = isView ? "none" : "inline-flex";

    // Vùng upload ảnh: Ẩn input chọn file khi ở chế độ xem
    if ($("recipe-image-upload"))
      $("recipe-image-upload").style.display = isView ? "none" : "block";
    if ($("btn-clear-image"))
      $("btn-clear-image").style.display = isView ? "none" : "flex";

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

      // Lấy toàn bộ công thức đang hoạt động theo Tab
      // Việc lọc không dấu (accent-insensitive) sẽ thực hiện ở JS để đảm bảo mượt mà và chính xác
      let sql = `
         SELECT r.*, f.ingredients
         FROM recipes r
         LEFT JOIN recipes_fts f ON r.id = f.rowid
         WHERE r.is_active = 1
      `;
      const sqlParams = [];
      if (activeTab !== "all") {
        sql += " AND r.recipe_type = ?";
        sqlParams.push(activeTab);
      }
      sql += " ORDER BY r.id DESC";

      const rawData = await API.db_query(sql, sqlParams);

      // Lọc không dấu trong JS (Giống trang Vật tư - Inventory giúp tìm "cot" ra "cốt")
      const kw = window.removeAccents(window.recipeKeyword);
      const filteredData = rawData.filter((item) => {
        return (
          window.removeAccents(item.name).includes(kw) ||
          (item.ingredients &&
            window.removeAccents(item.ingredients).includes(kw))
        );
      });

      if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="no-data text-center">🍁 Chưa có công thức bánh nào. Hãy nhấn "Thêm công thức mới"!</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        filteredData,
        itemsPerPage,
        window.currentPageRecipes,
        (newPage) => {
          window.currentPageRecipes = newPage;
          loadRecipes();
        },
      );

      window.allRecipes = pagingResult.data;

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;

      tbody.innerHTML = pagingResult.data
        .map((item, index) => {
          const stt =
            (window.currentPageRecipes - 1) * itemsPerPage + index + 1;
          const safeName = item.name.replace(/'/g, "\\'");
          const note = item.note?.trim() || "...";

          const imageDisplay = item.image_path
            ? `<img src="app-img:///${item.image_path.replace(/\\/g, "/")}" alt="${item.name}" class="recipe-thumb">`
            : `<div class="recipe-thumb-placeholder"></div>`;

          // Highlight tên bánh dựa trên từ khóa
          const nameDisplay = window.recipeKeyword
            ? window.highlightMatch(item.name, window.recipeKeyword)
            : item.name;

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
            <td class="font-weight-bold" style="display: flex; align-items: center; gap: 10px;">${imageDisplay} <div>${nameDisplay}${matchHtml}</div></td>
            <td class="text-center">${item.cook_time ? item.cook_time + " phút" : "---"}</td>
            <td class="text-center">${item.output || "1"}</td>
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

      // Kích hoạt hiệu ứng fade-in mượt mà khi đổi Tab hoặc phân trang
      tbody.classList.remove("fade-in");
      void tbody.offsetWidth; // Trigger reflow để restart animation
      tbody.classList.add("fade-in");

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
  }, 250);

  async function openRecipeModal(mode, recipeId = null) {
    currentModalMode = mode || "view";
    window.currentRecipeId = recipeId;
    window.recipeScaleFactor = 1;
    window.currentRecipeImageFile = null; // Reset ảnh đã chọn

    // Reset Form
    [
      "rec-name",
      "rec-cook-time",
      "rec-output-text",
      "rec-note",
      "steps-list-container",
      "ing-search-picker", // Thêm vào để clear ô tìm kiếm nguyên liệu
      "ing-qty-picker", // Thêm vào để clear ô số lượng nguyên liệu
      "recipe-image-upload", // Reset ô chọn file
    ].forEach((id) => {
      if ($(id))
        $(id)[id === "steps-list-container" ? "innerHTML" : "value"] = "";
    });
    window.recipeIngredientsList = [];
    window.selectedPickerIng = null; // Reset trạng thái nguyên liệu đã chọn
    if ($("selected-ing-unit-lbl"))
      $("selected-ing-unit-lbl").innerText = "Đơn vị: --";

    // Reset ảnh preview
    if ($("recipe-image-preview")) $("recipe-image-preview").src = "";
    if ($("recipe-image-preview-container"))
      $("recipe-image-preview-container").style.display = "none";

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
          window.currentViewedRecipe = recipe; // Lưu công thức vào biến toàn cục
          $("rec-name").value = recipe.name || "";
          if ($("rec-type"))
            $("rec-type").value = recipe.recipe_type || "general";
          $("rec-cook-time").value = recipe.cook_time || "";
          $("rec-output-text").value =
            recipe.output && parseInt(recipe.output) > 0 ? recipe.output : 1;
          window.recipeOriginalOutput =
            parseInt($("rec-output-text").value) || 1;
          $("rec-note").value = recipe.note || "";

          // Hiển thị ảnh nếu có
          if (recipe.image_path) {
            const imgPreview = $("recipe-image-preview");
            if (imgPreview)
              imgPreview.src = `app-img:///${recipe.image_path.replace(/\\/g, "/")}`;
            const imgContainer = $("recipe-image-preview-container");
            if (imgContainer)
              imgContainer.style.display = recipe.image_path ? "flex" : "none";
          }

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
        const displayQty = ing.qty * window.recipeScaleFactor;
        const cost = displayQty * ing.unit_price;
        totalCost += cost;
        return `
        <tr>
          <td>${idx + 1}</td>
          <td class="font-weight-bold">${ing.name}</td>
          <td>${currentModalMode === "view" ? `<span class="scaled-qty">${window.formatNumber(displayQty)}</span>` : `<input type="number" class="table-qty-input" value="${ing.qty}" oninput="window.updateIngRowQty(${ing.id}, this.value)" onfocus="this.select()" min="0.01" step="any" />`}</td>
          <td><span class="badge-unit">${ing.unit}</span></td>
          <td class="text-right font-weight-bold">${window.formatNumber(Math.round(cost))} đ</td>
          <td class="text-center edit-visible"><button type="button" class="btn-delete-row" onclick="window.removeIngRow(${ing.id})">❌</button></td>
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

      let imagePathToSave = null;
      const oldImagePath = window.currentViewedRecipe?.image_path || null;

      if (window.currentRecipeImageFile) {
        // Gửi ảnh lên Main Process để lưu vào thư mục cố định
        imagePathToSave = await API.saveRecipeImage(
          window.currentRecipeImageFile,
        );
      } else if (window.currentViewedRecipe?.image_path) {
        // Giữ lại ảnh cũ nếu không có ảnh mới được chọn
        // Chỉ giữ lại nếu không phải là chế độ "add" và không có file mới được chọn
        if (currentModalMode !== "add") {
          imagePathToSave = window.currentViewedRecipe.image_path;
        }
      }

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

      // Nếu có ảnh cũ và ảnh mới khác ảnh cũ (hoặc ảnh mới là null), thì xóa ảnh cũ
      if (oldImagePath && oldImagePath !== imagePathToSave) {
        await API.deleteRecipeImageFile(oldImagePath);
      }

      if (targetRecipeId) {
        await API.db_execute(
          "UPDATE recipes SET name=?, recipe_type=?, cook_time=?, output=?, steps_json=?, note=?, image_path=? WHERE id=?",
          [
            name,
            type,
            cookTime,
            outputValue,
            stepsJson,
            note,
            imagePathToSave,
            targetRecipeId,
          ],
        );
        await API.db_execute(
          "DELETE FROM recipe_ingredients WHERE recipe_id=?",
          [targetRecipeId],
        );
      } else {
        await API.db_execute(
          "INSERT INTO recipes (name, recipe_type, cook_time, output, steps_json, note, image_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [name, type, cookTime, outputValue, stepsJson, note, imagePathToSave],
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

      window.currentRecipeImageFile = null; // Clear selected image after saving
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
      <textarea class="step-textarea" placeholder="Mô tả nội dung..." rows="1" ${currentModalMode === "view" ? "disabled" : ""}>${text}</textarea>
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
    renderIngredientsStructure(); // Vẽ lại bảng để cập nhật nút xóa và input
  }

  window.updateRecipeScale = (targetVal) => {
    const target = parseFloat(targetVal) || 0;
    if (target > 0 && window.recipeOriginalOutput > 0) {
      window.recipeScaleFactor = target / window.recipeOriginalOutput;
    } else {
      window.recipeScaleFactor = 1;
    }
    renderIngredientsStructure();
  };

  window.handleImageSelect = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      const imgPreview = $("recipe-image-preview");
      const imgContainer = $("recipe-image-preview-container");

      if (imgContainer) {
        imgContainer.style.display = "flex";
        imgContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      try {
        // Lấy đường dẫn thực tế để lưu vào DB sau này
        const realPath = window.electronAPI.getPathForFile(file);

        if (realPath && !realPath.includes("fakepath")) {
          window.currentRecipeImageFile = realPath;

          // Ưu tiên hiển thị bằng protocol app-img để vượt qua rào cản OneDrive/Base64
          if (imgPreview) {
            // Chuyển dấu xuyệt ngược Windows thành xuyệt xuôi để tạo URL hợp lệ
            const webPath = realPath.replace(/\\/g, "/");
            const imageUrl = `app-img:///` + webPath;
            imgPreview.src = imageUrl;

            imgPreview.onerror = () => {
              // Ngăn chặn báo lỗi giả khi người dùng nhấn nút Xóa ảnh (gán src="")
              if (
                !imgPreview.getAttribute("src") ||
                imgPreview.getAttribute("src") === ""
              ) {
                return;
              }
              console.warn(
                "⚠️ Protocol app-img lỗi, đang dùng FileReader fallback...",
              );
              // Fallback: Sử dụng FileReader nếu protocol thất bại (do OneDrive hoặc lỗi path)
              const reader = new FileReader();
              reader.onload = (e) => {
                imgPreview.src = e.target.result;
              };
              reader.onerror = () => {
                console.error(
                  "❌ Không thể nạp ảnh preview bằng cả protocol và FileReader.",
                );
              };
              reader.readAsDataURL(file);
            };
          }
        } else {
          console.error("❌ Vẫn bị fakepath hoặc không lấy được đường dẫn!");
        }
      } catch (err) {
        console.error("Không thể lấy đường dẫn tệp:", err);
      }
    } else {
      window.clearRecipeImage();
    }
  };

  window.clearRecipeImage = () => {
    const imgPreview = $("recipe-image-preview");
    const oldImagePath = window.currentViewedRecipe?.image_path || null;

    // Xóa file vật lý khỏi ổ đĩa ngay khi nhấn xóa để giải phóng bộ nhớ
    if (oldImagePath) {
      API.deleteRecipeImageFile(oldImagePath); // Gửi yêu cầu xóa file ảnh cũ
      window.currentViewedRecipe.image_path = null; // Cập nhật trạng thái trong đối tượng recipe đang xem
    }
    if (imgPreview) {
      imgPreview.onerror = null; // Gỡ bỏ listener để không kích hoạt cảnh báo lỗi khi gán src rỗng
      imgPreview.src = "";
    }
    const imgContainer = $("recipe-image-preview-container");
    if (imgContainer) imgContainer.style.display = "none";
    const fileInput = $("recipe-image-upload");
    if (fileInput) fileInput.value = ""; // Xóa file đã chọn
    window.currentRecipeImageFile = null; // Reset biến lưu file
    // Nếu đang ở chế độ chỉnh sửa, xóa đường dẫn ảnh cũ khỏi đối tượng recipe đang xem
    if (window.currentViewedRecipe)
      window.currentViewedRecipe.image_path = null;
  };

  async function exportRecipeToPdf() {
    if (!window.currentViewedRecipe) {
      window.showToast?.("Không có công thức để xuất PDF!", "warning");
      return;
    }

    window.toggleLoader(true);
    try {
      const recipe = window.currentViewedRecipe;
      const ingredients = window.recipeIngredientsList;
      const steps = Array.from($$(".step-textarea"))
        .map((input) => input.value.trim())
        .filter(Boolean);

      const totalCostText = $("total-cost-display")?.innerText || "0 đ";
      const totalCost = window.unformatNumber(totalCostText);

      const pdfData = {
        name: recipe.name,
        cookTime: recipe.cook_time,
        output: recipe.output * window.recipeScaleFactor,
        originalOutput: recipe.output,
        note: recipe.note,
        steps: steps,
        ingredients: ingredients.map((ing) => ({
          name: ing.name,
          qty: ing.qty * window.recipeScaleFactor,
          unit: ing.unit,
          unitPrice: ing.unit_price,
          cost: ing.qty * ing.unit_price * window.recipeScaleFactor,
        })),
        totalCost: totalCost,
        scaleFactor: window.recipeScaleFactor,
      };

      const result = await API.exportRecipePdf(pdfData);
      if (result.success) window.showToast?.("Xuất PDF thành công!", "success");
    } catch (error) {
      console.error("Lỗi xuất PDF:", error);
      window.showToast?.("Lỗi khi xuất PDF công thức!", "error");
    } finally {
      window.toggleLoader(false);
    }
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
    handleImageSelect,
    clearRecipeImage,
    exportRecipeToPdf,
  });
})();
