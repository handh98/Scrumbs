(function () {
  const itemsPerPage = 5;
  const API = window.electronAPI;
  let recipePlaceholderUrl = null;

  // Quy hoạch State vào một đối tượng duy nhất để dễ quản lý và debug
  window.recipeState = {
    currentId: null,
    allData: [],
    currentPage: 1,
    keyword: "",
    cachedIngredients: [],
    selectedPickerIng: null,
    ingredientsList: [],
    pickerDisplayedCount: 20,
    pickerFilteredList: [],
    activeTab: "all",
    currentImageFile: null,
    originalOutput: 1,
    scaleFactor: 1,
    currentModalMode: "view", // "view" | "edit" | "add"
    currentViewedRecipe: null,
  };

  // Helpers for safe HTML/attribute/JS insertion
  const escAttr = (s) =>
    String(s || "").replace(
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

  const jsQuote = (s) =>
    String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n");

  /**
   * Quản lý trạng thái hiển thị các thành phần trong Modal dựa trên Mode
   */
  function toggleInputStates() {
    const modal = $("recipe-modal");
    if (!modal) return;

    const isView = window.recipeState.currentModalMode === "view";
    modal.classList.toggle("view-mode", isView);

    // Hiệu ứng mượt mà
    const modalBody = modal.querySelector(".modal-body");
    if (modalBody) {
      modalBody.style.opacity = "0";
      setTimeout(() => {
        modalBody.style.opacity = "1";
      }, 50);
    }

    // Xử lý nút Toggle Mode
    const toggleBtn = $("btn-toggle-mode");
    if (toggleBtn) {
      toggleBtn.classList.toggle(
        "hidden",
        window.recipeState.currentModalMode === "add",
      );
      toggleBtn.classList.toggle(
        "inline-flex",
        window.recipeState.currentModalMode !== "add",
      );
      toggleBtn.innerHTML = isView ? "Chỉnh Sửa" : "Xem Chi Tiết";
    }

    if ($("btn-save-recipe"))
      $("btn-save-recipe").style.display = isView ? "none" : "inline-flex";
    if ($("export-pdf-btn")) {
      $("export-pdf-btn").classList.toggle("inline-flex", isView);
      $("export-pdf-btn").classList.toggle("hidden", !isView);
    }

    // Ẩn/hiện bộ chọn nguyên liệu và nút thêm bước
    [$("ing-picker-section"), $("btn-add-step")].forEach((el) => {
      if (el) {
        el.classList.toggle("hidden", isView);
        el.classList.toggle("inline-flex", !isView && el.id === "btn-add-step");
        el.classList.toggle("block", !isView && el.id === "ing-picker-section");
      }
    });

    [
      "rec-name",
      "rec-cook-time",
      "rec-output-text",
      "rec-note",
      "rec-type",
    ].forEach((id) => {
      const input = $(id);
      if (!input) return;

      const groupWrapper =
        input.closest(".form-group") || input.closest(".note-group");
      if (!groupWrapper) return;

      if (isView && id === "rec-name") {
        input.disabled = true;
        input.style.pointerEvents = "none";
        input.style.border = "none";
        input.style.background = "transparent";
        input.style.boxShadow = "none";
        input.style.padding = "0";
      } else {
        input.disabled = isView && id !== "rec-output-text";
        input.style.pointerEvents = "auto";
        input.style.background = ""; // Reset style từ view-mode
        input.style.padding = "";
      }
    });

    // Box chat textareas
    modal.querySelectorAll("#steps-list-container textarea").forEach((ta) => {
      ta.disabled = isView;
    });
  }

  async function loadRecipes() {
    // Đảm bảo thanh tab hiển thị nằm ngang (flex-row) bằng cách áp dụng class utility từ global.css
    const tabsBar =
      $("recipe-tabs") || // Ưu tiên tìm theo ID nếu có
      // Fallback tìm theo class nếu ID không tồn tại hoặc không được sử dụng
      // (đảm bảo tìm được phần tử chứa các tab)
      document.querySelector(".recipe-tabs-container") ||
      document.querySelector(".recipe-tabs");
    if (tabsBar) tabsBar.classList.add("tab-container");

    await window.showLoader(true);
    try {
      const tbody = $("recipe-list-body");
      const paginationContainer = $("recipes-pagination");
      if (!tbody) return;

      // Đồng bộ keyword từ UI để đảm bảo state luôn khớp với ô nhập liệu
      const searchInput = $("recipe-search");
      if (searchInput) {
        window.recipeState.keyword = searchInput.value.trim();
      }

      const activeTab = window.recipeState.activeTab || "all";

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

      const searchTerm = window.recipeState.keyword.trim();
      let rawData = [];
      const sqlArgs = [...sqlParams];

      if (searchTerm) {
        const searchTokens = window
          .removeAccents(searchTerm)
          .split(/\s+/)
          .filter(Boolean)
          .map((token) => `${token.replace(/"/g, '""')}*`)
          .join(" ");

        sql +=
          " AND (r.name LIKE ? OR f.ingredients MATCH ? OR r.recipe_type LIKE ? OR r.note LIKE ?)";
        sqlArgs.push(
          `%${searchTerm}%`,
          searchTokens,
          `%${searchTerm}%`,
          `%${searchTerm}%`,
        );
      }

      rawData = await API.db_query(sql, sqlArgs);

      if (!rawData || rawData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="no-data text-center">🍁 Chưa có công thức bánh nào. Hãy nhấn "Thêm công thức mới"!</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        rawData,
        itemsPerPage,
        window.recipeState.currentPage,
        (newPage) => {
          window.recipeState.currentPage = newPage;
          loadRecipes();
        },
      );

      // Lấy đường dẫn placeholder một lần duy nhất để dùng cho tất cả các hàng
      if (!recipePlaceholderUrl) {
        const placeholderPath = await API.getAssetPath("placeholder.png");
        recipePlaceholderUrl = `app-img:///${placeholderPath.replace(/\\/g, "/")}`;
      }

      window.recipeState.allData = pagingResult.data;

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;

      tbody.innerHTML = pagingResult.data
        .map((item, index) => {
          const stt =
            (window.recipeState.currentPage - 1) * itemsPerPage + index + 1;
          const jsSafeName = jsQuote(item.name);
          const note = item.note?.trim() || "";
          const noteAttr = escAttr(note);
          const imageAlt = escAttr(item.name);

          const imageDisplay = item.image_path
            ? `<img src="app-img:///${item.image_path.replace(/\\/g, "/")}" alt="${imageAlt}" class="recipe-thumb">`
            : `<img src="${recipePlaceholderUrl}" alt="No image" class="recipe-thumb">`;

          // Highlight tên bánh dựa trên từ khóa
          const nameDisplay = window.recipeState.keyword
            ? window.highlightMatch(item.name, window.recipeState.keyword)
            : escAttr(item.name);

          // Logic hiển thị nguyên liệu khớp từ khóa
          let matchHtml = "";
          if (window.recipeState.keyword && item.ingredients) {
            const kw = window.removeAccents(window.recipeState.keyword);
            const matchedIngs = item.ingredients
              .split("|")
              .filter((name) => window.removeAccents(name).includes(kw));

            if (matchedIngs.length > 0) {
              matchHtml = `<div class="matched-ingredients-tags">
                ${matchedIngs.map((name) => `<span class="ing-match-tag">${escAttr(name)}</span>`).join("")}
              </div>`;
            }
          }

          return `
          <tr>
            <td class="text-center">${stt}</td>
            <td class="font-weight-bold row-flex gap-sm">${imageDisplay} <div>${nameDisplay}${matchHtml}</div></td>
            <td class="text-center">${item.cook_time ? item.cook_time + " phút" : "---"}</td>
            <td class="text-center">${item.output || "1"}</td>
            <td class="text-danger font-weight-bold text-center">${window.formatNumber(Math.round(item.total_cost))} đ</td>
            <td class="text-center note-column has-tooltip" data-note="${noteAttr}">${escAttr(note)}</td>
            <td class="action-column text-center">
                <button class="btn-secondary btn-view" onclick="window.openRecipeModal('view', ${item.id})" title="Xem chi tiết"><img src="src/renderer/assets/view.svg" alt="View" class="icon" /></button>
                <button class="btn-secondary btn-edit" onclick="window.openRecipeModal('edit', ${item.id})" title="Sửa"><img src="src/renderer/assets/edit.svg" alt="Edit" class="icon" /></button>
                <button class="btn-secondary btn-delete" onclick="window.deleteRecipe(${item.id}, '${jsSafeName}')" title="Xóa"><img src="src/renderer/assets/trash.svg" alt="Trash" class="icon" /></button>
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
      window.showLoader(false);
    }
  }

  const searchRecipes = window.debounce(() => {
    const searchVal = $("recipe-search")?.value.trim() || "";
    window.recipeState.keyword = searchVal;
    window.recipeState.currentPage = 1;
    loadRecipes();
  }, 250);

  async function openRecipeModal(mode, recipeId = null) {
    window.recipeState.currentModalMode = mode || "view";
    window.recipeState.currentId = recipeId;
    window.recipeState.scaleFactor = 1;
    window.recipeState.currentImageFile = null; // Reset ảnh đã chọn
    window.recipeState.ingredientsList = [];
    window.recipeState.currentViewedRecipe = null;

    [
      "rec-name",
      "rec-cook-time",
      "rec-output-text",
      "rec-note",
      "steps-list-container",
      "ing-search-picker",
      "ing-qty-picker",
      "recipe-image-upload",
    ].forEach((id) => {
      if ($(id))
        $(id)[id === "steps-list-container" ? "innerHTML" : "value"] = "";
    });

    window.recipeState.selectedPickerIng = null;
    if ($("selected-ing-unit-lbl"))
      $("selected-ing-unit-lbl").innerText = "Đơn vị: --";

    if ($("recipe-image-preview")) $("recipe-image-preview").src = "";
    if ($("recipe-image-preview-container"))
      $("recipe-image-preview-container").style.display = "none";

    const modalTitle = $("modal-title");
    if (modalTitle) {
      modalTitle.innerText =
        window.recipeState.currentModalMode === "view"
          ? "Chi Tiết Công Thức"
          : window.recipeState.currentModalMode === "edit"
            ? "Chỉnh Sửa Công Thức"
            : "Thêm Công Thức Mới";
    }

    toggleInputStates();

    // Đảm bảo các tiêu đề section luôn có class để CSS grid nhận diện trong view-mode
    const labels = document.querySelectorAll("#recipe-modal .modal-body > h4");
    if (labels.length >= 2) {
      labels[0].className = "section-label";
      labels[1].className = "section-label";
    }

    await window.showLoader(true);
    try {
      window.recipeState.cachedIngredients = await API.db_query(
        "SELECT id, name, unit, unit_price FROM ingredients WHERE is_active = 1 AND type = 'ingredient' ORDER BY name ASC", //
      );

      if (recipeId) {
        const [recipe] = await API.db_query(
          "SELECT * FROM recipes WHERE id = ?",
          [recipeId],
        );
        if (recipe) {
          window.recipeState.currentViewedRecipe = recipe;
          $("rec-name").value = recipe.name || "";
          if ($("rec-type"))
            $("rec-type").value = recipe.recipe_type || "general";
          $("rec-cook-time").value = recipe.cook_time || "";
          $("rec-output-text").value = parseInt(recipe.output) || 1;
          window.recipeState.originalOutput =
            parseInt($("rec-output-text").value) || 1;
          $("rec-note").value = recipe.note || "";

          const pPath = await API.getAssetPath("placeholder.png");
          const placeholderUrl = `app-img:///${pPath.replace(/\\/g, "/")}`;

          const imgPreview = $("recipe-image-preview");
          const imgContainer = $("recipe-image-preview-container");
          if (imgPreview && imgContainer) {
            if (recipe.image_path) {
              imgPreview.src = `app-img:///${recipe.image_path.replace(/\\/g, "/")}`;
              imgContainer.classList.add("flex");
              imgContainer.classList.remove("hidden");
            } else if (window.recipeState.currentModalMode === "view") {
              imgPreview.src = placeholderUrl;
              imgContainer.classList.add("flex");
              imgContainer.classList.remove("hidden");
            } else {
              imgContainer.classList.add("hidden");
              imgContainer.classList.remove("flex");
            }
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

          window.recipeState.ingredientsList = components.map((c) => ({
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
      if ($("recipe-modal")) $("recipe-modal").classList.add("flex");
    } catch (error) {
      console.error("Lỗi mở modal:", error);
      window.showToast?.("Gặp lỗi khi tải dữ liệu.", "error");
    } finally {
      window.showLoader(false);
    }
  }

  function closeRecipeModal() {
    if ($("recipe-modal")) $("recipe-modal").classList.remove("flex");
    window.recipeState.currentId = null;
    // Đảm bảo các trường picker cũng được reset khi đóng modal
    if ($("ing-search-picker")) $("ing-search-picker").value = "";
    window.recipeState.ingredientsList = [];
    window.recipeState.selectedPickerIng = null;
  }

  function renderIngredientsStructure() {
    const tbody = $("recipe-ing-body");
    const totalDisplay = $("total-cost-display");
    if (!tbody) return;

    if (!window.recipeState.ingredientsList?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center p-lg" style="color: var(--neutral-700);">Chưa có nguyên liệu nào được thêm!</td></tr>`; //
      if (totalDisplay) totalDisplay.innerText = "0 đ";
      return;
    }

    let totalCost = 0;
    tbody.innerHTML = window.recipeState.ingredientsList
      .map((ing, idx) => {
        const displayQty = ing.qty * window.recipeState.scaleFactor;
        const cost = displayQty * ing.unit_price; //
        totalCost += cost;
        return `
        <tr>
          <td class="text-center" style="width: 40px; color: var(--color-text-muted);">${idx + 1}</td>
          <td class="font-weight-bold">${ing.name}</td>
          <td>${window.recipeState.currentModalMode === "view" ? `<span class="scaled-qty">${window.formatNumber(displayQty)}</span>` : `<input type="number" class="table-qty-input" value="${ing.qty}" oninput="window.updateIngRowQty(${ing.id}, this.value)" onfocus="this.select()" min="0.01" step="any" />`}</td>
          <td><span class="badge-unit">${ing.unit}</span></td>
          <td class="text-right font-weight-bold edit-visible">${window.formatNumber(Math.round(cost))} đ</td>
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
    if (!window.recipeState.ingredientsList.length)
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

    await window.showLoader(true);
    let targetRecipeId = window.recipeState.currentId;
    try {
      window.recipeState.sourceData = null; // Invalidate cache

      let imagePathToSave = null;
      const oldImagePath =
        window.recipeState.currentViewedRecipe?.image_path || null;

      if (window.recipeState.currentImageFile) {
        // Gửi ảnh lên Main Process để lưu vào thư mục cố định
        imagePathToSave = await API.saveRecipeImage(
          window.recipeState.currentImageFile,
        );
      } else if (window.recipeState.currentViewedRecipe?.image_path) {
        if (window.recipeState.currentModalMode !== "add") {
          imagePathToSave = window.recipeState.currentViewedRecipe.image_path;
        }
      }

      // Kiểm tra trùng tên (không phân biệt hoa thường, bao gồm cả dấu tiếng Việt)
      // Kiểm tra trên toàn bộ bảng để đảm bảo tính duy nhất tuyệt đối
      const allItems = await API.db_query("SELECT id, name FROM recipes");
      const lowerName = name.toLowerCase();
      const isDuplicate = allItems.some(
        (item) =>
          item.name.toLowerCase() === lowerName &&
          (window.recipeState.currentId
            ? item.id !== window.recipeState.currentId
            : true),
      );

      if (isDuplicate) {
        return window.showToast?.(
          "Tên công thức bánh này đã tồn tại!",
          "warning",
        );
      }

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

      for (const ing of window.recipeState.ingredientsList) {
        await API.db_execute(
          "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty) VALUES (?, ?, ?)",
          [targetRecipeId, ing.id, ing.qty],
        );
      }

      window.showToast?.(
        window.recipeState.currentId
          ? "Cập nhật thành công!"
          : "Thêm mới thành công!",
        "success",
      );
      window.loadRecipes?.();
      window.invalidateAndReload("fillingOptions", null); // Invalidate filling options cache
      window.invalidateAndReload("menuSourceData", null); // Invalidate menu list cache

      window.recipeState.currentImageFile = null; // Clear selected image after saving
    } catch (error) {
      console.error("Lỗi lưu DB:", error);
      window.showToast?.("Lỗi cơ sở dữ liệu khi lưu công thức!", "error");
    } finally {
      const targetId = targetRecipeId || window.recipeState.currentId;
      await window.showLoader(false);

      // Đảm bảo Modal đóng/chuyển mode sau khi Loader đã thực sự biến mất
      setTimeout(async () => {
        if (targetId) {
          await openRecipeModal("view", targetId);
          $("rec-output-text")?.focus();
        } else {
          closeRecipeModal();
          $("recipe-search")?.focus();
        }
      }, 400); // Tăng lên 400ms
    }
  }
  async function deleteRecipe(id, name) {
    await window.showLoader(true); // Bật loader ngay khi bắt đầu
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
        window.showToast?.(
          `Không thể xóa: Công thức đang được dùng trong món: ${menuNames}`,
          "warning",
        );
        return; // Thoát sớm nếu công thức đang được sử dụng
      }

      if (
        window.showConfirm &&
        !(await window.showConfirm(
          "Xác nhận xóa",
          `Xóa công thức "${name}" khỏi danh sách?`,
        ))
      ) {
        return; // Thoát sớm nếu người dùng hủy
      }

      window.recipesSourceData = null; // Invalidate cache
      await API.db_execute("UPDATE recipes SET is_active = 0 WHERE id = ?", [
        id,
      ]);
      window.showToast?.("Đã xóa công thức!", "success");
      window.invalidateAndReload("fillingOptions", null); // Invalidate filling options cache
      window.invalidateAndReload("menuSourceData", null); // Invalidate menu list cache
      loadRecipes();
    } catch (error) {
      // Bắt lỗi cho toàn bộ quá trình xóa
      console.error("Lỗi khi xóa công thức:", error);
      window.showToast?.(`Không thể xóa công thức: ${error.message}`, "error");
    } finally {
      await window.showLoader(false); // Luôn tắt loader
    }
  }

  // --- Picker Helpers ---
  function showAllIngredientsPicker() {
    if (window.recipeState.currentModalMode === "view") return;
    window.recipeState.pickerFilteredList = [
      ...window.recipeState.cachedIngredients,
    ];
    window.recipeState.pickerDisplayedCount = 20;
    renderPickerDropdown();
  }

  const filterIngredientPicker = window.debounce(() => {
    const txt = $("ing-search-picker")?.value.trim() || "";
    const normalizedTxt = window.removeAccents(txt);
    window.recipeState.pickerFilteredList = txt
      ? window.recipeState.cachedIngredients.filter((i) =>
          (
            i._normalizedName ||
            (i._normalizedName = window.removeAccents(i.name))
          ).includes(normalizedTxt),
        )
      : [...window.recipeState.cachedIngredients];
    window.recipeState.pickerDisplayedCount = 20;
    renderPickerDropdown();
  }, 300);

  function renderPickerDropdown() {
    const dropdown = $("ing-picker-dropdown");
    if (!dropdown) return;

    const listToShow = window.recipeState.pickerFilteredList.slice(
      0,
      window.recipeState.pickerDisplayedCount,
    );
    if (!listToShow.length) {
      dropdown.innerHTML = `<div class="picker-no-result">Không tìm thấy vật tư</div>`;
    } else {
      dropdown.innerHTML = listToShow
        .map(
          (item) => `
        <div class="picker-item" onclick="window.selectIngFromPicker(${item.id})">
          <span class="picker-item-name">${escAttr(item.name)}</span>
          <span class="picker-item-price">${window.formatNumber(Math.round(item.unit_price))}đ/${escAttr(item.unit)}</span>
        </div>`,
        )
        .join("");
    }
    dropdown.style.display = "block";
  } //

  function handlePickerScroll(e) {
    const el = e.target;
    if (
      el.scrollTop + el.clientHeight >= el.scrollHeight - 10 &&
      window.recipeState.pickerDisplayedCount <
        window.recipeState.pickerFilteredList.length
    ) {
      window.recipeState.pickerDisplayedCount += 20;
      renderPickerDropdown();
    }
  }

  function selectIngFromPicker(id) {
    const target = window.recipeState.cachedIngredients.find(
      (i) => i.id === id,
    );
    if (!target) return;

    window.recipeState.selectedPickerIng = target;
    if ($("ing-search-picker")) $("ing-search-picker").value = target.name; //
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
    if (!window.recipeState.selectedPickerIng)
      return window.showToast?.("Vui lòng chọn một nguyên liệu!", "warning");
    const qtyInput = $("ing-qty-picker");
    const qty = parseFloat(qtyInput?.value) || 0;

    if (qty <= 0)
      return window.showToast?.("Số lượng định lượng phải > 0!", "warning");

    const existed = window.recipeState.ingredientsList.find(
      (i) => i.id === window.recipeState.selectedPickerIng.id,
    );
    if (existed) {
      existed.qty += qty;
      existed.cost = existed.qty * existed.unit_price;
    } else {
      window.recipeState.ingredientsList.push({
        ...window.recipeState.selectedPickerIng,
        qty,
        cost: qty * window.recipeState.selectedPickerIng.unit_price,
      });
    }

    renderIngredientsStructure();

    if ($("ing-search-picker")) $("ing-search-picker").value = "";
    if ($("selected-ing-unit-lbl"))
      $("selected-ing-unit-lbl").innerText = "Đơn vị: --";
    if (qtyInput) qtyInput.value = "";
    window.recipeState.selectedPickerIng = null;
    $("ing-search-picker")?.focus();
  }

  function updateIngRowQty(id, value) {
    const qty = parseFloat(value) || 0;
    const item = window.recipeState.ingredientsList.find((i) => i.id === id);
    if (item) {
      item.qty = qty;
      item.cost = qty * item.unit_price;
      const total = window.recipeState.ingredientsList.reduce(
        (sum, i) => sum + i.cost,
        0,
      );
      if ($("total-cost-display"))
        $("total-cost-display").innerText =
          `${window.formatNumber(Math.round(total))} đ`;
    }
  }

  function removeIngRow(id) {
    window.recipeState.ingredientsList =
      window.recipeState.ingredientsList.filter((i) => i.id !== id);
    renderIngredientsStructure();
  }

  function addStepRow(text = "") {
    const container = $("steps-list-container");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "step-row";

    const indexSpan = document.createElement("span");
    indexSpan.className = "step-number";
    indexSpan.innerText = String(container.children.length + 1);

    const textarea = document.createElement("textarea");
    textarea.className = "step-textarea";
    textarea.placeholder =
      window.recipeState.currentModalMode === "view"
        ? ""
        : "Mô tả công việc (VD: Đánh bông lòng trắng trứng...)";
    textarea.rows = 1;
    textarea.disabled = window.recipeState.currentModalMode === "view";
    textarea.value = text || "";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn-delete-step edit-visible";
    deleteButton.innerText = "❌";
    deleteButton.onclick = function () {
      this.parentElement.remove();
      window.reIndexSteps();
    };

    div.appendChild(indexSpan);
    div.appendChild(textarea);
    div.appendChild(deleteButton);
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
    window.recipeState.activeTab = type;
    window.recipeState.currentPage = 1;

    // Cập nhật trạng thái active cho UI
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type") === type);
    });

    loadRecipes();
  };

  function toggleRecipeMode() {
    window.recipeState.currentModalMode =
      window.recipeState.currentModalMode === "view" ? "edit" : "view";
    if ($("modal-title"))
      $("modal-title").innerText =
        window.recipeState.currentModalMode === "view"
          ? "Chi Tiết Công Thức"
          : "Chỉnh Sửa Công Thức";
    toggleInputStates();
    renderIngredientsStructure(); // Vẽ lại bảng để cập nhật nút xóa và input
  }

  window.updateRecipeScale = (targetVal) => {
    const target = parseFloat(targetVal) || 0;
    if (target > 0 && window.recipeState.originalOutput > 0) {
      window.recipeState.scaleFactor =
        target / window.recipeState.originalOutput;
    } else {
      window.recipeState.scaleFactor = 1;
    }
    renderIngredientsStructure();
  };

  function handleImageSelect(event) {
    const file = event.target.files?.[0];
    if (file) {
      const imgPreview = $("recipe-image-preview");
      const imgContainer = $("recipe-image-preview-container");

      if (imgContainer) {
        //
        imgContainer.style.display = "flex";
        imgContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      try {
        // Lấy đường dẫn thực tế để lưu vào DB sau này
        const realPath = window.electronAPI.getPathForFile(file).trim();

        if (realPath && !realPath.includes("fakepath")) {
          window.recipeState.currentImageFile = realPath;

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
  }

  function clearRecipeImage() {
    const imgPreview = $("recipe-image-preview");
    const oldImagePath =
      window.recipeState.currentViewedRecipe?.image_path || null;

    // Xóa file vật lý khỏi ổ đĩa ngay khi nhấn xóa để giải phóng bộ nhớ
    if (oldImagePath) {
      API.deleteRecipeImageFile(oldImagePath); // Gửi yêu cầu xóa file ảnh cũ
      if (window.recipeState.currentViewedRecipe)
        window.recipeState.currentViewedRecipe.image_path = null;
    }
    if (imgPreview) {
      imgPreview.onerror = null; // Gỡ bỏ listener để không kích hoạt cảnh báo lỗi khi gán src rỗng
      imgPreview.src = "";
    }
    const imgContainer = $("recipe-image-preview-container");
    if (imgContainer) imgContainer.classList.add("hidden");
    if (imgContainer) imgContainer.classList.remove("flex");
    const fileInput = $("recipe-image-upload");
    if (fileInput) fileInput.value = ""; // Xóa file đã chọn
    window.recipeState.currentImageFile = null; // Reset biến lưu file
  }

  async function exportRecipeToPdf() {
    if (!window.recipeState.currentViewedRecipe) {
      window.showToast?.("Không có công thức để xuất PDF!", "warning");
      return;
    }

    await window.showLoader(true);
    try {
      const recipe = window.recipeState.currentViewedRecipe;
      const ingredients = window.recipeState.ingredientsList;
      const steps = Array.from($$(".step-textarea"))
        .map((input) => input.value.trim())
        .filter(Boolean);

      const totalCostText = $("total-cost-display")?.innerText || "0 đ";
      const totalCost = window.unformatNumber(totalCostText);

      const pdfData = {
        name: recipe.name,
        cookTime: recipe.cook_time,
        output: recipe.output * window.recipeState.scaleFactor,
        originalOutput: recipe.output,
        note: recipe.note,
        steps: steps,
        ingredients: ingredients.map((ing) => ({
          name: ing.name,
          qty: ing.qty * window.recipeState.scaleFactor,
          unit: ing.unit,
          unitPrice: ing.unit_price,
          cost: ing.qty * ing.unit_price * window.recipeState.scaleFactor,
        })),
        totalCost: totalCost,
        scaleFactor: window.recipeState.scaleFactor,
      };

      const result = await API.exportRecipePdf(pdfData);
      if (result.success) window.showToast?.("Xuất PDF thành công!", "success");
    } catch (error) {
      console.error("Lỗi xuất PDF:", error);
      window.showToast?.("Lỗi khi xuất PDF công thức!", "error");
    } finally {
      window.showLoader(false);
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
