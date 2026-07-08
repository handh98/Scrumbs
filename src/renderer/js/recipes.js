(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => document.querySelectorAll(selector);

  let recipePlaceholderUrl = null;

  window.recipeState = {
    currentId: null,
    allData: [],
    currentPage: 1,
    keyword: "",
    activeTab: "all",
    ingredientsList: [],
    currentImageFile: null,
    recipeImageDeleted: false,
    originalOutput: 1,
    scaleFactor: 1,
    currentModalMode: "view",
    currentViewedRecipe: null,
    pickerType: "ingredient",
    selectedPickerItem: null,
    pickerDataRaw: [],
  };

  const escAttr = window.escAttr;
  const jsQuote = (s) =>
    String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n");

  window.calculateCostRecursive = async (recipeId, visited = new Set()) => {
    if (visited.has(recipeId)) return 0;
    visited.add(recipeId);
    try {
      const items = await API.db_query(
        "SELECT * FROM recipe_ingredients WHERE recipe_id = ?",
        [recipeId],
      );
      let totalCost = 0;
      for (let item of items) {
        if (item.type === "recipe" && item.sub_recipe_id) {
          const subCost = await window.calculateCostRecursive(
            item.sub_recipe_id,
            new Set(visited),
          );
          totalCost += subCost * item.qty;
        } else {
          const [ing] = await API.db_query(
            "SELECT unit_price FROM ingredients WHERE id = ?",
            [item.ingredient_id],
          );
          totalCost += (ing?.unit_price || 0) * item.qty;
        }
      }
      return totalCost;
    } catch (error) {
      console.error("Lỗi tính giá vốn đệ quy:", error);
      return 0;
    }
  };

  function hasRecipeImage() {
    return (
      !window.recipeState.recipeImageDeleted &&
      !!(
        window.recipeState.currentImageFile ||
        window.recipeState.currentViewedRecipe?.image_path
      )
    );
  }

  // KHÔI PHỤC HÀM UPDATE IMAGE ĐỂ KHÔNG BỊ TRẮNG TRANG
  function updateImageUI() {
    const isView = window.recipeState.currentModalMode === "view";
    const hasImg = hasRecipeImage();

    if ($("btn-clear-image")) {
      $("btn-clear-image").style.display = !isView && hasImg ? "flex" : "none";
    }
    if ($("upload-overlay")) {
      $("upload-overlay").style.display = !isView && !hasImg ? "flex" : "none";
    }

    const imgContainer = $("recipe-image-preview-container");
    if (imgContainer) {
      imgContainer.style.display = "flex";
      if (!hasImg && recipePlaceholderUrl) {
        $("recipe-image-preview").src = recipePlaceholderUrl;
      }
    }
  }

  function toggleInputStates() {
    const modal = $("recipe-modal");
    if (!modal) return;
    const isView = window.recipeState.currentModalMode === "view";
    modal.classList.toggle("view-mode", isView);

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

    ["rec-name", "rec-cook-time", "rec-type", "rec-note"].forEach((id) => {
      const el = $(id);
      if (el) {
        el.disabled = isView;
        if (el.tagName === "TEXTAREA") {
          el.style.resize = isView ? "none" : "";
        }
      }
    });

    if ($("rec-output-text")) $("rec-output-text").disabled = false;

    modal.querySelectorAll("#steps-list-container textarea").forEach((ta) => {
      ta.disabled = isView;
      ta.style.resize = isView ? "none" : "";
    });
    if ($("recipe-image-upload")) $("recipe-image-upload").disabled = isView;

    updateImageUI();
  }

  async function loadRecipes() {
    await window.showLoader(true);
    try {
      const tbody = $("recipe-list-body");
      if (!tbody) return;

      const activeTab = window.recipeState.activeTab || "all";
      let sql = "SELECT * FROM recipes WHERE is_active = 1";
      const sqlParams = [];
      if (activeTab !== "all") {
        sql += " AND recipe_type = ?";
        sqlParams.push(activeTab);
      }
      sql += " ORDER BY id DESC";

      let rawData = await API.db_query(sql, sqlParams);

      if (window.recipeState.keyword) {
        const kw = window.removeAccents(window.recipeState.keyword);
        rawData = rawData.filter(
          (item) =>
            window.removeAccents(item.name).includes(kw) ||
            window.removeAccents(item.note || "").includes(kw),
        );
      }

      if (!rawData.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center p-xl">🍁 Không tìm thấy công thức bánh nào.</td></tr>`;
        if ($("recipes-pagination")) $("recipes-pagination").innerHTML = "";
        return;
      }

      if (!recipePlaceholderUrl) {
        const placeholderPath = await API.getAssetPath("placeholder.png");
        recipePlaceholderUrl = `app-img:///${placeholderPath.replace(/\\/g, "/")}`;
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

      window.recipeState.allData = pagingResult.data;
      if ($("recipes-pagination"))
        $("recipes-pagination").innerHTML = pagingResult.html;

      let html = "";
      for (let i = 0; i < pagingResult.data.length; i++) {
        const item = pagingResult.data[i];
        const stt = (window.recipeState.currentPage - 1) * itemsPerPage + i + 1;
        const img = item.image_path
          ? `app-img:///${item.image_path.replace(/\\/g, "/")}`
          : recipePlaceholderUrl;
        const cost = await window.calculateCostRecursive(item.id);

        html += `
          <tr>
            <td class="text-center">${stt}</td>
            <td class="font-weight-bold row-flex gap-sm"><img src="${img}" class="recipe-thumb"> <div>${escAttr(item.name)}</div></td>
            <td class="text-center">${item.cook_time ? item.cook_time + " phút" : "---"}</td>
            <td class="text-center">${item.output || "1"}</td>
            <td class="text-danger font-weight-bold text-center">${window.formatNumber(Math.round(cost))} đ</td>
            <td class="note-column">${escAttr(item.note || "")}</td>
            <td class="action-column text-center">
                <button class="btn-secondary btn-view" onclick="window.openRecipeModal('view', ${item.id})">
                  <img src="src/renderer/assets/view.svg" class="icon" />
                </button>
                <button class="btn-secondary btn-edit" onclick="window.openRecipeModal('edit', ${item.id})">
                  <img src="src/renderer/assets/edit.svg" class="icon" />
                </button>
                <button class="btn-secondary btn-delete" onclick="window.deleteRecipe(${item.id}, '${jsQuote(item.name)}')">
                  <img src="src/renderer/assets/trash.svg" class="icon" />
                </button>
            </td>
          </tr>`;
      }
      tbody.innerHTML = html;
    } catch (e) {
      console.error(e);
    } finally {
      window.showLoader(false);
    }
  }

  const searchRecipes = window.debounce(() => {
    window.recipeState.keyword = $("recipe-search")?.value.trim() || "";
    window.recipeState.currentPage = 1;
    loadRecipes();
  }, 300);

  window.switchRecipeTab = (type) => {
    window.recipeState.activeTab = type;
    window.recipeState.currentPage = 1;
    const container = document.querySelector(".tab-container");
    if (container) {
      container
        .querySelectorAll(".tab-btn")
        .forEach((btn) =>
          btn.classList.toggle(
            "active",
            btn.getAttribute("data-type") === type,
          ),
        );
    }
    loadRecipes();
  };

  window.switchPickerType = (type, preventShow = false) => {
    window.recipeState.pickerType = type;
    if ($("ing-search-picker")) $("ing-search-picker").value = "";
    if ($("selected-ing-unit-lbl")) $("selected-ing-unit-lbl").innerText = "--";
    window.recipeState.selectedPickerItem = null;

    if (!preventShow) {
      window.showAllIngredientsPicker();
    } else {
      if ($("ing-picker-dropdown"))
        $("ing-picker-dropdown").style.display = "none";
    }
  };

  window.showAllIngredientsPicker = async () => {
    if ($("ing-picker-dropdown"))
      $("ing-picker-dropdown").style.display = "block";
    await window.filterIngredientPicker();
  };

  window.filterIngredientPicker = async () => {
    const kw = window.removeAccents($("ing-search-picker")?.value.trim() || "");
    const type = window.recipeState.pickerType;
    let data;

    if (type === "ingredient") {
      data = await API.db_query(
        "SELECT id, name, unit, unit_price FROM ingredients WHERE is_active = 1",
      );
    } else {
      data = await API.db_query(
        "SELECT id, name, 'cái' as unit FROM recipes WHERE is_active = 1 AND id != ?",
        [window.recipeState.currentId || 0],
      );
    }

    window.recipeState.pickerDataRaw = data;
    const filtered = data.filter((i) =>
      window.removeAccents(i.name).includes(kw),
    );

    const dropdown = $("ing-picker-dropdown");
    if (!dropdown) return;
    if (filtered.length === 0) {
      dropdown.innerHTML = `<div style="padding: 8px; color: gray;">Không tìm thấy kết quả</div>`;
    } else {
      dropdown.innerHTML = filtered
        .map(
          (i) => `
        <div style="padding: 8px; cursor: pointer; border-bottom: 1px solid #eee;"
             onmousedown="window.selectPickerItem(${i.id}, '${escAttr(i.name)}', '${i.unit}', ${i.unit_price || 0})">
          ${escAttr(i.name)} (${i.unit})
        </div>
      `,
        )
        .join("");
    }
  };

  window.selectPickerItem = async (id, name, unit, unit_price) => {
    let price = unit_price;
    if (window.recipeState.pickerType === "recipe") {
      price = await window.calculateCostRecursive(id);
    }

    window.recipeState.selectedPickerItem = {
      id,
      name,
      unit,
      price,
      type: window.recipeState.pickerType,
    };
    $("ing-search-picker").value = name;
    $("selected-ing-unit-lbl").innerText = unit;
    $("ing-picker-dropdown").style.display = "none";
    $("ing-qty-picker").focus();
  };

  document.addEventListener("mousedown", (e) => {
    const dropdown = $("ing-picker-dropdown");
    const input = $("ing-search-picker");
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
      dropdown.style.display = "none";
    }
  });

  window.addIngredientToRecipe = () => {
    const qty = parseFloat($("ing-qty-picker").value);
    const item = window.recipeState.selectedPickerItem;

    if (!item)
      return window.showToast?.("Vui lòng chọn thành phần!", "warning");
    if (isNaN(qty) || qty <= 0)
      return window.showToast?.("Nhập định lượng > 0!", "warning");

    window.recipeState.ingredientsList.push({
      type: item.type,
      id: item.type === "ingredient" ? item.id : null,
      sub_recipe_id: item.type === "recipe" ? item.id : null,
      name: item.name,
      qty: qty,
      unit: item.unit,
      unit_price: item.price,
    });

    $("ing-search-picker").value = "";
    $("ing-qty-picker").value = "";
    $("selected-ing-unit-lbl").innerText = "--";
    window.recipeState.selectedPickerItem = null;

    renderIngredientsStructure();
  };

  async function openRecipeModal(mode, recipeId = null) {
    if (!recipePlaceholderUrl) {
      const p = await API.getAssetPath("placeholder.png");
      recipePlaceholderUrl = `app-img:///${p.replace(/\\/g, "/")}`;
    }

    window.recipeState.currentModalMode = mode || "view";
    window.recipeState.currentId = recipeId;
    window.recipeState.scaleFactor = 1;
    window.recipeState.currentImageFile = null;
    window.recipeState.recipeImageDeleted = false;
    window.recipeState.ingredientsList = [];
    window.recipeState.currentViewedRecipe = null;

    const radioIng = document.querySelector(
      'input[name="item_type_picker"][value="ingredient"]',
    );
    if (radioIng) radioIng.checked = true;

    window.switchPickerType("ingredient", true);

    [
      "rec-name",
      "rec-cook-time",
      "rec-output-text",
      "rec-note",
      "steps-list-container",
      "recipe-image-upload",
      "ing-search-picker",
      "ing-qty-picker",
    ].forEach((id) => {
      if ($(id))
        $(id)[id === "steps-list-container" ? "innerHTML" : "value"] = "";
    });

    if ($("recipe-image-preview"))
      $("recipe-image-preview").src = recipePlaceholderUrl;
    if ($("modal-title"))
      $("modal-title").innerText =
        mode === "view" ? "Chi Tiết" : mode === "edit" ? "Sửa" : "Thêm Mới";

    toggleInputStates();
    await window.showLoader(true);

    try {
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
          window.recipeState.originalOutput = parseInt(recipe.output) || 1;
          $("rec-note").value = recipe.note || "";

          if (recipe.image_path)
            $("recipe-image-preview").src =
              `app-img:///${recipe.image_path.replace(/\\/g, "/")}`;

          if (recipe.steps_json) {
            try {
              const steps = JSON.parse(recipe.steps_json);
              if (Array.isArray(steps))
                steps.forEach((step) => window.addStepRow(step));
            } catch (e) {
              console.warn("Lỗi parse JSON các bước làm:", e);
            }
          }

          const items = await API.db_query(
            `
            SELECT ri.ingredient_id AS id, ri.qty, ri.type, ri.sub_recipe_id,
                   CASE WHEN ri.type = 'recipe' THEN mr.name ELSE i.name END as name,
                   CASE WHEN ri.type = 'recipe' THEN 'cái' ELSE i.unit END as unit,
                   i.unit_price as raw_price
            FROM recipe_ingredients ri
            LEFT JOIN ingredients i ON ri.ingredient_id = i.id AND (ri.type = 'ingredient' OR ri.type IS NULL)
            LEFT JOIN recipes mr ON ri.sub_recipe_id = mr.id AND ri.type = 'recipe'
            WHERE ri.recipe_id = ?
          `,
            [recipeId],
          );

          for (let item of items) {
            let price = item.raw_price || 0;
            if (item.type === "recipe" && item.sub_recipe_id)
              price = await window.calculateCostRecursive(item.sub_recipe_id);
            window.recipeState.ingredientsList.push({
              type: item.type || "ingredient",
              id: item.id,
              sub_recipe_id: item.sub_recipe_id,
              name: item.name,
              qty: item.qty,
              unit: item.unit,
              unit_price: price,
            });
          }
        }
      } else {
        window.addStepRow("");
        if ($("rec-output-text")) $("rec-output-text").value = 1;
      }
      renderIngredientsStructure();
      updateImageUI();
      if ($("recipe-modal")) $("recipe-modal").classList.add("flex");
    } catch (e) {
      console.error(e);
    } finally {
      window.showLoader(false);
    }
  }

  function closeRecipeModal() {
    if ($("recipe-modal")) $("recipe-modal").classList.remove("flex");
  }

  function toggleRecipeMode() {
    window.recipeState.currentModalMode =
      window.recipeState.currentModalMode === "view" ? "edit" : "view";

    if (window.recipeState.currentModalMode === "edit") {
      $("rec-output-text").value = window.recipeState.originalOutput;
      window.recipeState.scaleFactor = 1;
    }

    toggleInputStates();
    renderIngredientsStructure();
    setTimeout(() => {
      document.querySelectorAll(".step-textarea").forEach((ta) => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      });
    }, 50);
  }

  window.updateRecipeScale = (targetVal) => {
    const target = parseFloat(targetVal) || 0;
    if (window.recipeState.currentModalMode === "view") {
      window.recipeState.scaleFactor =
        target > 0 && window.recipeState.originalOutput > 0
          ? target / window.recipeState.originalOutput
          : 1;
    } else {
      window.recipeState.originalOutput = target > 0 ? target : 1;
      window.recipeState.scaleFactor = 1;
    }
    renderIngredientsStructure();
  };

  function renderIngredientsStructure() {
    const tbody = $("recipe-ing-body");
    const totalDisplay = $("total-cost-display");
    if (!tbody) return;

    if (!window.recipeState.ingredientsList.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center p-lg" style="color: var(--neutral-700);">Chưa có thành phần nào!</td></tr>`;
      if (totalDisplay) totalDisplay.innerText = "0 đ";
      return;
    }

    let totalCost = 0;
    tbody.innerHTML = window.recipeState.ingredientsList
      .map((ing, idx) => {
        const displayQty = ing.qty * window.recipeState.scaleFactor;
        const cost = displayQty * ing.unit_price;
        totalCost += cost;
        const badge =
          ing.type === "recipe"
            ? `<span style="font-size:10px; color:#aaa">[Cốt nền]</span> `
            : ``;

        return `
        <tr>
          <td class="text-center">${idx + 1}</td>
          <td class="font-weight-bold">${badge}${escAttr(ing.name)}</td>
          <td class="text-center">
            ${
              window.recipeState.currentModalMode === "view"
                ? `<span class="scaled-qty">${window.formatNumber(displayQty)}</span>`
                : `<input type="number" class="input-compact text-center" style="width: 70px;" value="${ing.qty}" oninput="window.updateIngRowQty(${idx}, this.value)" min="0.01" step="any" />`
            }
          </td>
          <td class="text-center"><span class="badge-unit">${ing.unit}</span></td>
          <td class="text-right font-weight-bold">${window.formatNumber(Math.round(cost))} đ</td>
          <td class="text-center edit-visible"><button type="button" class="btn-delete-row" onclick="window.removeIngRow(${idx})">❌</button></td>
        </tr>`;
      })
      .join("");

    if (totalDisplay)
      totalDisplay.innerText =
        window.formatNumber(Math.round(totalCost)) + " đ";
  }

  window.updateIngRowQty = (index, value) => {
    const qty = parseFloat(value) || 0;
    if (window.recipeState.ingredientsList[index]) {
      window.recipeState.ingredientsList[index].qty = qty;

      const ing = window.recipeState.ingredientsList[index];
      const rowCost = ing.qty * ing.unit_price * window.recipeState.scaleFactor;

      const costCells = document.querySelectorAll("#recipe-ing-body tr");
      if (costCells[index]) {
        const costTd = costCells[index].querySelector("td:nth-child(5)");
        if (costTd)
          costTd.innerText = window.formatNumber(Math.round(rowCost)) + " đ";
      }

      let totalCost = 0;
      window.recipeState.ingredientsList.forEach((item) => {
        totalCost +=
          item.qty * item.unit_price * window.recipeState.scaleFactor;
      });
      const totalDisplay = $("total-cost-display");
      if (totalDisplay)
        totalDisplay.innerText =
          window.formatNumber(Math.round(totalCost)) + " đ";
    }
  };

  window.removeIngRow = (index) => {
    window.recipeState.ingredientsList.splice(index, 1);
    renderIngredientsStructure();
  };

  window.addStepRow = (text = "") => {
    const container = $("steps-list-container");
    if (!container) return;
    const isView = window.recipeState.currentModalMode === "view";
    const div = document.createElement("div");
    div.className = "step-row";
    div.innerHTML = `
      <span class="step-number">${container.children.length + 1}</span>
      <textarea class="step-textarea"
                ${isView ? "disabled" : ""}
                placeholder="Mô tả công việc..."
                oninput="this.style.height='auto'; this.style.height=(this.scrollHeight)+'px';"
                style="overflow: hidden;${isView ? " resize: none;" : ""}">${text}</textarea>
      <button type="button" class="btn-delete-row edit-visible" onclick="this.parentElement.remove(); window.reIndexSteps();">❌</button>
    `;
    container.appendChild(div);
    const ta = div.querySelector("textarea");
    if (ta)
      setTimeout(() => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      }, 10);
  };

  window.reIndexSteps = () => {
    $("steps-list-container")
      ?.querySelectorAll(".step-row")
      .forEach((row, idx) => {
        const numSpan = row.querySelector(".step-number");
        if (numSpan) numSpan.innerText = idx + 1;
      });
  };

  async function saveRecipe() {
    const name = $("rec-name")?.value.trim();
    if (!name)
      return window.showToast?.("Vui lòng nhập tên công thức!", "warning");

    const steps = Array.from($$(".step-textarea"))
      .map((i) => i.value.trim())
      .filter(Boolean);
    await window.showLoader(true);
    let targetId = window.recipeState.currentId;

    try {
      let imagePath = null;
      if (window.recipeState.currentImageFile)
        imagePath = await API.saveRecipeImage(
          window.recipeState.currentImageFile,
        );
      else if (
        window.recipeState.currentViewedRecipe?.image_path &&
        !window.recipeState.recipeImageDeleted
      )
        imagePath = window.recipeState.currentViewedRecipe.image_path;

      if (targetId) {
        await API.db_execute(
          "UPDATE recipes SET name=?, recipe_type=?, cook_time=?, output=?, steps_json=?, note=?, image_path=? WHERE id=?",
          [
            name,
            $("rec-type").value,
            parseInt($("rec-cook-time").value) || 0,
            parseInt($("rec-output-text").value) || 1,
            JSON.stringify(steps),
            $("rec-note").value,
            imagePath,
            targetId,
          ],
        );
        await API.db_execute(
          "DELETE FROM recipe_ingredients WHERE recipe_id=?",
          [targetId],
        );
      } else {
        await API.db_execute(
          "INSERT INTO recipes (name, recipe_type, cook_time, output, steps_json, note, image_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            name,
            $("rec-type").value,
            parseInt($("rec-cook-time").value) || 0,
            parseInt($("rec-output-text").value) || 1,
            JSON.stringify(steps),
            $("rec-note").value,
            imagePath,
          ],
        );
        const [{ id }] = await API.db_query("SELECT last_insert_rowid() AS id");
        targetId = id;
      }

      for (const ing of window.recipeState.ingredientsList) {
        await API.db_execute(
          "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty, type, sub_recipe_id) VALUES (?, ?, ?, ?, ?)",
          [targetId, ing.id, ing.qty, ing.type, ing.sub_recipe_id],
        );
      }

      window.showToast?.("Lưu thành công!", "success");
      loadRecipes();
      await window.showLoader(false);
      await openRecipeModal("view", targetId);
    } catch (e) {
      console.error("Lỗi lưu dữ liệu:", e);
      window.showToast?.("Lỗi lưu DB!", "error");
      await window.showLoader(false);
    }
  }

  async function deleteRecipe(id, name) {
    if (
      (await window.showConfirm) &&
      !(await window.showConfirm("Xóa", `Xóa công thức "${name}"?`))
    )
      return;
    await API.db_execute("UPDATE recipes SET is_active = 0 WHERE id = ?", [id]);
    loadRecipes();
  }

  window.handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      window.recipeState.currentImageFile = window.electronAPI
        .getPathForFile(file)
        .trim();
      window.recipeState.recipeImageDeleted = false;
      $("recipe-image-preview").src =
        `app-img:///` + window.recipeState.currentImageFile.replace(/\\/g, "/");
      updateImageUI();
    }
  };

  window.clearRecipeImage = () => {
    $("recipe-image-preview").src = recipePlaceholderUrl;
    if ($("recipe-image-upload")) $("recipe-image-upload").value = "";
    window.recipeState.currentImageFile = null;
    window.recipeState.recipeImageDeleted = true;
    updateImageUI();
  };

  window.exportRecipeToPdf = async () => {
    if (!window.recipeState.currentViewedRecipe) return;
    await window.showLoader(true);
    try {
      const totalCost = window.recipeState.ingredientsList.reduce(
        (sum, ing) => {
          return (
            sum + ing.qty * ing.unit_price * window.recipeState.scaleFactor
          );
        },
        0,
      );

      const pdfData = {
        name: window.recipeState.currentViewedRecipe.name,
        cookTime: window.recipeState.currentViewedRecipe.cook_time,
        output:
          window.recipeState.currentViewedRecipe.output *
          window.recipeState.scaleFactor,
        originalOutput: window.recipeState.originalOutput || 1,
        scaleFactor: window.recipeState.scaleFactor,
        totalCost: totalCost,
        note: window.recipeState.currentViewedRecipe.note || "",
        steps: Array.from($$(".step-textarea"))
          .map((i) => i.value.trim())
          .filter(Boolean),
        ingredients: window.recipeState.ingredientsList.map((ing) => ({
          name: ing.name,
          qty: ing.qty * window.recipeState.scaleFactor,
          unit: ing.unit,
          unitPrice: ing.unit_price,
          cost: ing.qty * ing.unit_price * window.recipeState.scaleFactor,
        })),
      };

      const r = await API.exportRecipePdf(pdfData);
      if (r.success) window.showToast?.("Xuất PDF thành công!", "success");
    } catch (e) {
      console.error("Lỗi xuất PDF:", e);
      window.showToast?.("Lỗi xuất PDF!", "error");
    } finally {
      window.showLoader(false);
    }
  };

  Object.assign(window, {
    loadRecipes,
    searchRecipes,
    openRecipeModal,
    closeRecipeModal,
    toggleRecipeMode,
    saveRecipe,
    deleteRecipe,
  });
  if (typeof window.loadRecipes === "function")
    setTimeout(() => window.loadRecipes(), 100);
})();
