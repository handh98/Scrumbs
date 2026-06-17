(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  // Khởi tạo Global States
  window.currentPageMenu ??= 1;
  window.menuKeyword ??= "";
  window.recipeOptions ??= [];
  window.pkgOptions ??= [];
  window.rawIngredientOptions ??= [];
  window.fillingOptions ??= [];
  window.menuSourceData ??= null;

  // ==========================================
  // --- HỆ THỐNG CUSTOM PICKER CHUNG ---
  // ==========================================

  window.renderPickerDropdown = (container, options, keyword, type) => {
    const dropdown = container.querySelector(".picker-dropdown");
    if (!dropdown) return;

    // Thu thập các ID đã được chọn trong các hàng cùng loại
    const rowSelector =
      type === "recipe"
        ? ".recipe-row"
        : type === "pkg"
          ? ".pkg-row"
          : ".raw-row";
    const selectedIds = Array.from($$(rowSelector))
      .map((row) => parseInt(row.querySelector(".picker-id-hidden")?.value))
      .filter((id) => !isNaN(id));

    // Lấy ID hiện tại của container này để vẫn cho phép hiển thị chính nó trong list
    const currentId = parseInt(
      container.querySelector(".picker-id-hidden")?.value,
    );

    const normalizedKeyword = window.removeAccents(keyword);
    const filtered = options.filter((o) => {
      const matchesKeyword = (
        o._normalizedName || (o._normalizedName = window.removeAccents(o.name))
      ).includes(normalizedKeyword);

      const isNotSelected = !selectedIds.includes(o.id) || o.id === currentId;

      return matchesKeyword && isNotSelected;
    });

    if (!filtered.length) {
      dropdown.innerHTML =
        '<div class="picker-no-result">Không tìm thấy dữ liệu</div>';
      return;
    }

    dropdown.innerHTML = filtered
      .map((o) => {
        let price;
        if (type === "recipe") {
          price = o.unit_cost;
        } else {
          price = o.unit_price;
        }
        const unit = o.unit || "";
        const displayPrice = `${window.formatNumber(Math.round(price))}đ ${unit ? "/" + unit : ""}`;

        // Hiển thị nhãn loại công thức nếu có
        const typeBadge = o.recipe_type
          ? `<span class="picker-type-badge type-${o.recipe_type}">${o.recipe_type === "crust" ? "Vỏ" : o.recipe_type === "filling" ? "Nhân" : "Chung"}</span>`
          : "";

        return `
        <div class="picker-item" onclick="window.selectPickerOption('${type}', ${o.id}, '${o.name.replace(/'/g, "\\'")}', ${price}, '${unit}', this)">
            <div class="picker-item-main">
              <span class="picker-item-name">${o.name} ${typeBadge}</span>
              <span class="picker-item-price" style="color: var(--color-highlight-danger);">${displayPrice}</span>
            </div>
        </div>`;
      })
      .join("");
  };

  const getOptionsByType = (type) =>
    type === "recipe"
      ? window.recipeOptions
      : type === "pkg"
        ? window.pkgOptions
        : window.rawIngredientOptions;

  window.showPicker = (inputElem, type) => {
    const container = inputElem.closest(".picker-container");
    window.renderPickerDropdown(
      container,
      getOptionsByType(type),
      inputElem.value,
      type,
    );
    container.querySelector(".picker-dropdown").classList.add("block");
    container.querySelector(".picker-dropdown").classList.remove("hidden");
  };

  window.filterPicker = window.debounce((inputElem, type) => {
    const container = inputElem.closest(".picker-container");
    container.querySelector(".picker-id-hidden").value = "";
    container.querySelector(".picker-price-hidden").value = 0;

    const row = container.closest(".recipe-row, .raw-row, .pkg-row");
    if (type === "recipe" && row.querySelector(".recipe-cost-display"))
      row.querySelector(".recipe-cost-display").value = "";
    else if (type === "raw" && row.querySelector(".unit-label"))
      row.querySelector(".unit-label").innerText = "";

    window.calculateTotal();
    window.renderPickerDropdown(
      container,
      getOptionsByType(type),
      inputElem.value,
      type,
    );
    container.querySelector(".picker-dropdown").classList.add("block"); //
    container.querySelector(".picker-dropdown").classList.remove("hidden"); //
  }, 300);

  window.hidePickerDelay = (inputElem) => {
    setTimeout(() => {
      const dropdown = inputElem
        .closest(".picker-container")
        .querySelector(".picker-dropdown");
      if (dropdown) {
        dropdown.classList.add("hidden");
        dropdown.classList.remove("block");
      }
    }, 200);
  };

  window.selectPickerOption = (type, id, name, price, unit, itemElem) => {
    const container = itemElem.closest(".picker-container");
    const row = container.closest(".recipe-row, .raw-row, .pkg-row");

    container.querySelector(".picker-input").value = name;
    container.querySelector(".picker-id-hidden").value = id;
    container.querySelector(".picker-price-hidden").value = price;

    if (type === "recipe" && row.querySelector(".recipe-cost-display")) {
      row.querySelector(".recipe-cost-display").value =
        window.formatNumber(Math.round(price)) + "đ";
    } else if (type === "raw" && row.querySelector(".unit-label")) {
      row.querySelector(".unit-label").innerText = unit;
    }

    container.querySelector(".picker-dropdown").classList.add("hidden"); //
    container.querySelector(".picker-dropdown").classList.remove("block"); //

    window.calculateTotal();
  };

  // ==========================================
  // --- TẠO CÁC DÒNG (ROWS) ---
  // ==========================================

  window.addRecipeRow = (recipeId = "", ratio = 1) => {
    const found = window.recipeOptions.find((r) => r.id == recipeId) || {};
    const div = document.createElement("div");
    div.className = "recipe-row";
    div.innerHTML = `
        <div class="flex-2 picker-container">
            <input type="text" class="picker-input" placeholder="🔍 Nhập công thức..." value="${found.name || ""}"
                   onfocus="window.showPicker(this, 'recipe')" oninput="window.filterPicker(this, 'recipe')" onblur="window.hidePickerDelay(this)" autocomplete="off" />
            <div class="picker-dropdown"></div>
            <input type="hidden" class="picker-id-hidden" value="${recipeId}">
            <input type="hidden" class="picker-price-hidden" value="${found.unit_cost || 0}">
        </div>
        <div class="flex-1"><input class="recipe-ratio" type="number" step="0.1" min="0.1" value="${ratio}" oninput="window.calculateTotal()" placeholder="Tỉ lệ"></div>
        <div class="flex-1"><input type="text" class="recipe-cost-display" readonly value="${window.formatNumber(Math.round(found.unit_cost || 0)) + "đ"}"></div>
        <div class="col-action-wrap"><button type="button" class="btn-delete-row" onclick="this.closest('.recipe-row').remove(); window.calculateTotal();">❌</button></div>`;
    const container = $("recipe-container");
    if (container) container.appendChild(div);
  };

  window.addRawIngredientRow = (ingredientId = "", qty = 1) => {
    const found =
      window.rawIngredientOptions.find((r) => r.id == ingredientId) || {};
    const div = document.createElement("div");
    div.className = "raw-row";
    div.innerHTML = `
        <div class="flex-2 picker-container">
            <input type="text" class="picker-input" placeholder="🔍 Nhập nguyên liệu..." value="${found.name || ""}"
                   onfocus="window.showPicker(this, 'raw')" oninput="window.filterPicker(this, 'raw')" onblur="window.hidePickerDelay(this)" autocomplete="off" />
            <div class="picker-dropdown"></div>
            <input type="hidden" class="picker-id-hidden" value="${ingredientId}">
            <input type="hidden" class="picker-price-hidden" value="${found.unit_price || 0}">
        </div>
        <div class="flex-1 flex items-center">
            <input class="raw-qty" type="number" placeholder="SL" value="${qty}" min="0.1" step="0.1" oninput="window.calculateTotal()" style="width:70%;">
            <span class="unit-label" style="margin-left:8px; font-size:12px; color:var(--neutral-850);">${found.unit || "đv"}</span>
        </div>
        <div class="col-action-wrap"><button type="button" class="btn-delete-row" onclick="this.closest('.raw-row').remove(); window.calculateTotal();">❌</button></div>`;
    const container = $("raw-ingredient-container");
    if (container) container.appendChild(div);
  };

  window.addPkgRow = (ingredientId = "", qty = 1) => {
    const found = window.pkgOptions.find((p) => p.id == ingredientId) || {};
    const div = document.createElement("div");
    div.className = "pkg-row";
    div.innerHTML = `
        <div class="flex-2 picker-container">
            <input type="text" class="picker-input" placeholder="🔍 Nhập bao bì..." value="${found.name || ""}"
                   onfocus="window.showPicker(this, 'pkg')" oninput="window.filterPicker(this, 'pkg')" onblur="window.hidePickerDelay(this)" autocomplete="off" />
            <div class="picker-dropdown"></div>
            <input type="hidden" class="picker-id-hidden" value="${ingredientId}">
            <input type="hidden" class="picker-price-hidden" value="${found.unit_price || 0}">
        </div>
        <div class="flex-1"><input class="pkg-qty" type="number" placeholder="SL" value="${qty}" min="1" oninput="window.calculateTotal()"></div>
        <div class="col-action-wrap"><button type="button" class="btn-delete-row" onclick="this.closest('.pkg-row').remove(); window.calculateTotal();">❌</button></div>`;
    const container = $("pkg-container");
    if (container) container.appendChild(div);
  };

  window.addMenuFillingRow = (recipeId = "", isDefault = 0, qty = 1) => {
    const header = document.querySelector(".fillings-header");
    if (header) header.style.display = "flex";

    // Nếu không truyền qty (khi nhấn nút thêm mới), thử lấy tỉ lệ từ công thức vỏ đầu tiên
    if (qty === null) {
      const firstRecipeRatio = document.querySelector(".recipe-ratio")?.value;
      qty = firstRecipeRatio ? parseFloat(firstRecipeRatio) : 1;
    }

    // Tìm danh sách ID đã được chọn để chọn nhân khả dụng tiếp theo cho dòng mới
    const selectedIds = Array.from($$(".filling-row"))
      .map((row) => parseInt(row.querySelector(".filling-id-select")?.value))
      .filter((id) => !isNaN(id));

    const nextAvailable = window.fillingOptions.find(
      (f) => !selectedIds.includes(f.id),
    );

    if (!nextAvailable && !recipeId) {
      return window.showToast?.(
        "Đã hết nhân bánh có thể thêm vào món này!",
        "warning",
      );
    }

    const initialId = recipeId || nextAvailable.id;

    // Đảm bảo luôn có nhân mặc định: Nếu chưa có cái nào được chọn thì chọn cái này
    const hasDefault = !!document.querySelector(".is-default-radio:checked");
    const shouldCheck = isDefault || !hasDefault;

    const div = document.createElement("div");
    div.className = "filling-row row-flex";

    div.innerHTML = `
        <select class="flex-2 filling-id-select" onchange="window.updateFillingControlsState()"></select>
        <div class="flex-1">
          <input type="number" class="filling-qty" value="${qty}" min="0.1" step="0.1" placeholder="Tỉ lệ" title="Số lượng nhân cho món này">
        </div>
        <div class="flex-1 flex justify-center">
          <input type="radio" name="default-filling" class="is-default-radio" ${shouldCheck ? "checked" : ""}>
        </div>
        <div class="col-action-wrap"><button type="button" class="btn-delete-row" onclick="this.closest('.filling-row').remove(); window.updateFillingControlsState();">❌</button></div>`;

    const container = $("menu-fillings-container");
    if (container) {
      container.appendChild(div);
      const select = div.querySelector(".filling-id-select");
      // Lưu tạm ID vào dataset vì lúc này select chưa có options để nhận value
      select.dataset.pendingValue = initialId;
      window.updateFillingControlsState(); // Gọi cập nhật để render options chính xác
    }
  };

  // ==========================================
  // --- TÍNH TOÁN VÀ LƯU TRỮ ---
  // ==========================================

  // Hàm Helper gộp logic duyệt lấy Data mảng
  const extractRowData = (rowSelector, qtySelector) => {
    return Array.from($$(rowSelector))
      .map((row) => ({
        id: parseInt(row.querySelector(".picker-id-hidden")?.value),
        price:
          parseFloat(row.querySelector(".picker-price-hidden")?.value) || 0,
        qty: parseFloat(row.querySelector(qtySelector)?.value) || 0,
      }))
      .filter((item) => !isNaN(item.id));
  };

  window.calculateTotal = () => {
    const baseCost = extractRowData(".recipe-row", ".recipe-ratio").reduce(
      (s, i) => s + i.price * i.qty,
      0,
    );
    const rawTotal = extractRowData(".raw-row", ".raw-qty").reduce(
      (s, i) => s + i.price * i.qty,
      0,
    );
    const pkgTotal = extractRowData(".pkg-row", ".pkg-qty").reduce(
      (s, i) => s + i.price * i.qty,
      0,
    );

    const getVal = (id) => window.unformatNumber($(id)?.value || "0");
    const totalCost =
      baseCost +
      rawTotal +
      pkgTotal +
      getVal("m-elec") +
      getVal("m-depr") +
      getVal("m-labor");

    // Cập nhật hiển thị tổng vốn và chi phí
    if ($("m-total-cost-display"))
      $("m-total-cost-display").innerText = window.formatNumber(
        Math.round(totalCost),
      );

    const finalPrice = getVal("m-final-price");

    if (finalPrice > 0) {
      // Công thức tính % lợi nhuận: ((Giá bán - Giá vốn) / Giá bán) * 100
      const margin = ((finalPrice - totalCost) / finalPrice) * 100;
      if ($("m-margin")) $("m-margin").value = margin.toFixed(4);
    } else if ($("m-margin")) {
      $("m-margin").value = "0";
    }
  };

  window.saveMenu = async () => {
    const modal = $("menu-modal");
    const mode = modal.getAttribute("data-mode") || "add";
    const editId = parseInt(modal.getAttribute("data-editing-id"));
    const menuName = $("m-name").value.trim();

    if (!menuName)
      return window.showToast?.("Vui lòng nhập tên món ăn!", "error");

    const recipesList = extractRowData(".recipe-row", ".recipe-ratio").map(
      (r) => ({ id: r.id, ratio: r.qty }),
    );
    const rawList = extractRowData(".raw-row", ".raw-qty");
    const pkgList = extractRowData(".pkg-row", ".pkg-qty");

    const fillingList = Array.from($$(".filling-row")).map((row) => ({
      id: parseInt(row.querySelector(".filling-id-select").value),
      qty: parseFloat(row.querySelector(".filling-qty").value) || 1,
      is_default: row.querySelector(".is-default-radio").checked ? 1 : 0,
    }));
    // Nếu có nhân mà chưa chọn mặc định, lấy cái đầu tiên
    if (fillingList.length > 0 && !fillingList.some((f) => f.is_default))
      fillingList[0].is_default = 1;

    if (!recipesList.length)
      return window.showToast?.(
        "Món ăn cần có ít nhất 1 thành phần công thức hợp lệ!",
        "error",
      );

    const elec = window.unformatNumber($("m-elec").value);
    const depr = window.unformatNumber($("m-depr").value);
    const labor = window.unformatNumber($("m-labor").value);
    const finalPrice = window.unformatNumber($("m-final-price").value);
    const margin = window.unformatNumber($("m-margin").value);
    const note = $("m-note").value.trim();

    await window.showLoader(true);
    try {
      window.menuSourceData = null; // Invalidate cache

      // Kiểm tra trùng tên (không phân biệt hoa thường, bao gồm cả dấu tiếng Việt)
      // Chúng ta kiểm tra trên toàn bộ bảng để tránh lỗi UNIQUE của CSDL
      const allItems = await API.db_query("SELECT id, name FROM menu_items");
      const lowerMenuName = menuName.toLowerCase();
      const isDuplicateName = allItems.some(
        (item) =>
          item.name.toLowerCase() === lowerMenuName &&
          (mode === "edit" ? item.id !== editId : true),
      );

      if (isDuplicateName) {
        return window.showToast?.(
          "Tên món này đã tồn tại trong hệ thống!",
          "warning",
        );
      }

      // Kiểm tra trùng lặp tổ hợp công thức và nguyên liệu

      const currentRecipeIds = [...new Set(recipesList.map((r) => r.id))]
        .sort((a, b) => a - b)
        .join(",");
      const currentIngredientIds = [...new Set(rawList.map((r) => r.id))]
        .sort((a, b) => a - b)
        .join(",");

      const [allMenuRecipes, allMenuIngredients] = await Promise.all([
        API.db_query(
          `SELECT mr.menu_item_id, mr.recipe_id, m.name FROM menu_recipes mr JOIN menu_items m ON mr.menu_item_id = m.id WHERE m.is_active = 1`,
        ),
        API.db_query(
          `SELECT mi.menu_item_id, mi.ingredient_id, m.name FROM menu_ingredients mi JOIN menu_items m ON mi.menu_item_id = m.id WHERE m.is_active = 1`,
        ),
      ]);

      const menuRecipeMap = {};
      const menuIngMap = {};
      const menuNameMap = {};

      allMenuRecipes.forEach((row) => {
        (menuRecipeMap[row.menu_item_id] ??= new Set()).add(row.recipe_id);
        menuNameMap[row.menu_item_id] = row.name;
      });
      allMenuIngredients.forEach((row) => {
        (menuIngMap[row.menu_item_id] ??= new Set()).add(row.ingredient_id);
        menuNameMap[row.menu_item_id] = row.name;
      });

      const allActiveMenuIds = [
        ...new Set([...Object.keys(menuRecipeMap), ...Object.keys(menuIngMap)]),
      ];

      for (const mIdKey of allActiveMenuIds) {
        const mId = parseInt(mIdKey);
        if (mode === "edit" && mId === editId) continue;

        const existingRecString = Array.from(menuRecipeMap[mId] || [])
          .sort((a, b) => a - b)
          .join(",");
        const existingIngString = Array.from(menuIngMap[mId] || [])
          .sort((a, b) => a - b)
          .join(",");

        if (
          existingRecString === currentRecipeIds &&
          existingIngString === currentIngredientIds
        ) {
          return window.showToast?.(
            `Tổ hợp thành phần (công thức & nguyên liệu) bị trùng lặp với món "${menuNameMap[mId]}"!`,
            "warning",
          );
        }
      }

      let currentTargetId = editId;

      if (mode === "edit") {
        await API.db_execute(
          `UPDATE menu_items SET name=?, electricity=?, depreciation=?, labor=?, selling_price=?, profit_margin=?, note=? WHERE id=?`,
          [menuName, elec, depr, labor, finalPrice, margin, note, editId],
        );
        await API.db_execute("DELETE FROM menu_recipes WHERE menu_item_id=?", [
          editId,
        ]);
        await API.db_execute(
          "DELETE FROM menu_ingredients WHERE menu_item_id=?",
          [editId],
        );
        await API.db_execute(
          "DELETE FROM menu_packaging WHERE menu_item_id=?",
          [editId],
        );
        await API.db_execute("DELETE FROM menu_fillings WHERE menu_item_id=?", [
          editId,
        ]);
      } else {
        await API.db_execute(
          `INSERT INTO menu_items (name, electricity, depreciation, labor, selling_price, profit_margin, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [menuName, elec, depr, labor, finalPrice, margin, note],
        );
        const [{ id }] = await API.db_query("SELECT last_insert_rowid() AS id");
        currentTargetId = id;
      }

      for (const rec of recipesList)
        await API.db_execute(
          "INSERT INTO menu_recipes (menu_item_id, recipe_id, ratio) VALUES (?, ?, ?)",
          [currentTargetId, rec.id, rec.ratio],
        );
      for (const raw of rawList)
        await API.db_execute(
          "INSERT INTO menu_ingredients (menu_item_id, ingredient_id, qty) VALUES (?, ?, ?)",
          [currentTargetId, raw.id, raw.qty],
        );
      for (const pkg of pkgList)
        await API.db_execute(
          "INSERT INTO menu_packaging (menu_item_id, ingredient_id, qty) VALUES (?, ?, ?)",
          [currentTargetId, pkg.id, pkg.qty],
        );

      for (const fill of fillingList)
        await API.db_execute(
          "INSERT INTO menu_fillings (menu_item_id, recipe_id, is_default, qty) VALUES (?, ?, ?, ?)",
          [currentTargetId, fill.id, fill.is_default, fill.qty],
        );

      window.showToast?.(
        mode === "edit"
          ? "Cập nhật món thành công! 🎉"
          : "Lưu món mới thành công! 🎉",
        "success",
      );
    } catch (error) {
      console.error(error);
      window.showToast?.("Không thể lưu món ăn!", "error");
    } finally {
      await window.showLoader(false);
      window.closeMenuModal();
      window.loadMenu();
      setTimeout(() => $("menu-search")?.focus(), 400); // Tăng lên 400ms
    }
  };

  // ==========================================
  // --- LOAD DỮ LIỆU & MODAL ---
  // ==========================================

  window.loadMenu = async () => {
    try {
      const tbody = $("menu-list-body");
      const paginationContainer = $("menu-pagination");

      // ĐỒNG BỘ: Lấy từ khóa trực tiếp từ UI để đảm bảo logic luôn khớp với ô nhập liệu
      const searchInput = $("menu-search");
      if (searchInput) {
        window.menuKeyword = searchInput.value.trim();
      }

      const sql = `
        SELECT m.*,
            COALESCE((SELECT SUM(mr.ratio * (SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) / CAST(r.output AS REAL) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = mr.recipe_id)) FROM menu_recipes mr WHERE mr.menu_item_id = m.id), 0) AS total_recipe_cost,
            COALESCE((SELECT SUM(mp.qty * i.unit_price) FROM menu_packaging mp JOIN ingredients i ON mp.ingredient_id = i.id WHERE mp.menu_item_id = m.id), 0) AS total_pkg_cost,
            COALESCE((SELECT SUM(mig.qty * i.unit_price) FROM menu_ingredients mig JOIN ingredients i ON mig.ingredient_id = i.id WHERE mig.menu_item_id = m.id), 0) AS total_raw_cost,
            (SELECT COUNT(*) FROM menu_fillings WHERE menu_item_id = m.id) AS filling_count,
            (SELECT GROUP_CONCAT(r.name || ':' || CAST((CASE WHEN mf.price > 0 THEN mf.price ELSE CEIL(r.total_cost / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 END) * mf.qty AS INTEGER), '|') FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id WHERE mf.menu_item_id = m.id) AS filling_list
        FROM menu_items m WHERE m.is_active = 1 ORDER BY m.id DESC
      `;

      if (!window.menuSourceData) {
        const raw = await API.db_query(sql);
        raw.forEach((m) => (m._normalizedName = window.removeAccents(m.name)));
        window.menuSourceData = raw;
      }

      const kw = window.removeAccents(window.menuKeyword);
      const data = window.menuSourceData.filter((item) =>
        item._normalizedName.includes(kw),
      );

      if (window.currentPageMenu > 1 && data.length) {
        window.currentPageMenu =
          Math.min(
            window.currentPageMenu,
            Math.ceil(data.length / itemsPerPage),
          ) || 1;
      }

      if (!data?.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="no-data text-center">🌸 Chưa có món nào trong menu. Hãy nhấn "Thêm món" để bắt đầu!</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        data,
        itemsPerPage,
        window.currentPageMenu,
        (newPage) => {
          window.currentPageMenu = newPage;
          window.loadMenu();
        },
      );

      tbody.innerHTML = pagingResult.data
        .map((item, index) => {
          const globalIndex =
            (window.currentPageMenu - 1) * itemsPerPage + index + 1;
          const note = item.note?.trim() || "...";
          const sellingPrice = item.selling_price || 0; // Luôn lấy selling_price từ DB, nếu 0 thì hiển thị 0
          const margin = item.profit_margin || 0; // Lấy lợi nhuận trực tiếp từ DB

          const fillingBadge =
            item.filling_count > 0
              ? `<div style="font-size: 11px; color: #bcaaa4; margin-top: 2px;">(${item.filling_count} loại nhân)</div>`
              : "";

          let priceDisplay = `${window.formatNumber(Math.round(sellingPrice))}đ`;
          if (item.filling_list) {
            item.filling_list.split("|").forEach((fStr) => {
              const [fName, fPrice] = fStr.split(":");
              priceDisplay += `<div style="font-size: 11px; color: #bc5a1a; font-weight: normal; margin-top: 2px;">${fName}: +${window.formatNumber(fPrice)}đ</div>`;
            });
          }

          return `
          <tr>
            <td class="text-center">${globalIndex}</td>
            <td class="text-center text-500">${item.name}${fillingBadge}</td>
            <td class="text-center text-highlight">${priceDisplay}</td>
            <td class="text-center">${margin.toFixed(2)}%</td>
            <td class="text-center note-column has-tooltip" data-note="${note}">${note}</td>
            <td class="text-center action-column">
              <button class="btn-secondary btn-edit" onclick="window.editMenu(${item.id})" title="Chỉnh sửa"><img src="src/renderer/assets/edit.svg" class="icon" /></button>
              <button class="btn-secondary btn-delete" onclick="window.deleteMenu(${item.id}, '${item.name.replace(/'/g, "\\'")}')" title="Xóa"><img src="src/renderer/assets/trash.svg" class="icon" /></button>
            </td>
          </tr>`;
        })
        .join("");

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;
      window.TooltipComponent?.init();
    } catch (error) {
      console.error("Lỗi tải Menu:", error);
    }
  };

  window.searchMenu = window.debounce(() => {
    const searchVal = $("menu-search")?.value.trim() || "";
    window.menuKeyword = searchVal;
    window.currentPageMenu = 1;
    window.loadMenu();

    if (searchVal === "") window.loadMenu(); // Nạp lại ngay lập tức nếu xóa trắng
  }, 300);

  window.openMenuModal = async () => {
    window.recipeOptions = await API.db_query(
      `SELECT
        r.id,
        r.name,
        r.recipe_type,
        COALESCE(r.total_cost / MAX(1, CAST(r.output AS REAL)), 0) AS unit_cost
      FROM recipes r WHERE r.is_active = 1 AND r.recipe_type != 'filling'`,
    );
    window.fillingOptions = await API.db_query(
      `SELECT
        id,
        name,
        COALESCE(CEIL(total_cost / MAX(1.0, CAST(output AS REAL)) / 100.0) * 100, 0) AS unit_cost
      FROM recipes WHERE recipe_type = 'filling' AND is_active = 1`,
    );

    if (!window.recipeOptions.length)
      return window.showToast?.(
        "Vui lòng tạo ít nhất 1 công thức bánh trước!",
        "warning",
      );

    window.pkgOptions = await API.db_query(
      "SELECT id, name, unit_price FROM ingredients WHERE type = 'package' AND is_active = 1",
    );
    window.rawIngredientOptions = await API.db_query(
      "SELECT id, name, unit_price, unit FROM ingredients WHERE type = 'ingredient' AND is_active = 1",
    );

    const modal = $("menu-modal");
    modal.setAttribute("data-mode", "add");
    modal.removeAttribute("data-editing-id");
    $("modal-form-title").innerText = "Thiết lập món mới";
    $("modal-submit-btn").innerHTML =
      '<img src="src/renderer/assets/save.svg" class="icon" /> Lưu món';

    [
      "m-name",
      "m-note",
      "recipe-container",
      "raw-ingredient-container",
      "pkg-container",
      "menu-fillings-container",
    ].forEach((id) => {
      const el = $(id);
      if (el) {
        el[id.includes("container") ? "innerHTML" : "value"] = "";
      }
    });

    const fHeader = document.querySelector(".fillings-header");
    if (fHeader) fHeader.classList.add("hidden");

    ["m-elec", "m-depr", "m-labor", "m-margin", "m-final-price"].forEach(
      (id) => ($(id).value = 0),
    );
    if ($("m-final-price")) $("m-final-price").value = "0";
    if ($("m-total-cost-display")) $("m-total-cost-display").innerText = "0";

    // modal.style.display = "flex"; // Redundant with classList.add("flex")
    modal.classList.add("flex");
    window.addRecipeRow();
  };

  window.editMenu = async (id) => {
    try {
      const [item] = await API.db_query(
        `SELECT m.*,
            COALESCE((SELECT SUM(mr.ratio * (SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mr.recipe_id)) FROM menu_recipes mr WHERE mr.menu_item_id = m.id), 0) AS total_recipe_cost,
            COALESCE((SELECT SUM(mp.qty * i.unit_price) FROM menu_packaging mp JOIN ingredients i ON mp.ingredient_id = i.id WHERE mp.menu_item_id = m.id), 0) AS total_pkg_cost,
            COALESCE((SELECT SUM(mig.qty * i.unit_price) FROM menu_ingredients mig JOIN ingredients i ON mig.ingredient_id = i.id WHERE mig.menu_item_id = m.id), 0) AS total_raw_cost
        FROM menu_items m WHERE m.id = ?`,
        [id],
      );
      if (!item) return;

      await window.openMenuModal();

      const modal = $("menu-modal");
      modal.setAttribute("data-mode", "edit");
      modal.setAttribute("data-editing-id", id);
      $("modal-form-title").innerText = "Cập nhật giá món ăn";
      $("modal-submit-btn").innerHTML =
        '<img src="src/renderer/assets/save.svg" class="icon" /> Cập nhật';

      $("m-name").value = item.name;
      // m-margin là readonly, sẽ được calculateTotal tính lại từ giá bán
      $("m-note").value = item.note || "";
      $("m-elec").value = window.formatNumber(item.electricity || 0);
      $("m-depr").value = window.formatNumber(item.depreciation || 0);
      $("m-labor").value = window.formatNumber(item.labor || 0);

      if ($("m-final-price"))
        $("m-final-price").value = window.formatNumber(
          Math.round(item.selling_price || 0),
        ); // Luôn lấy selling_price từ DB, nếu 0 thì hiển thị 0

      const recipeContainer = $("recipe-container");
      if (recipeContainer) recipeContainer.innerHTML = "";
      const savedRecipes = await API.db_query(
        "SELECT recipe_id, ratio FROM menu_recipes WHERE menu_item_id = ?",
        [id],
      );
      savedRecipes.length
        ? savedRecipes.forEach((r) => window.addRecipeRow(r.recipe_id, r.ratio))
        : window.addRecipeRow();

      const rawContainer = $("raw-ingredient-container");
      if (rawContainer) rawContainer.innerHTML = "";
      const savedRaws = await API.db_query(
        "SELECT ingredient_id, qty FROM menu_ingredients WHERE menu_item_id = ?",
        [id],
      );
      savedRaws.forEach((r) =>
        window.addRawIngredientRow(r.ingredient_id, r.qty),
      );

      const pkgContainer = $("pkg-container");
      if (pkgContainer) pkgContainer.innerHTML = "";
      const savedPkgs = await API.db_query(
        "SELECT ingredient_id, qty FROM menu_packaging WHERE menu_item_id = ?",
        [id],
      );
      savedPkgs.forEach((p) => window.addPkgRow(p.ingredient_id, p.qty));

      const savedFillings = await API.db_query(
        "SELECT recipe_id, is_default, qty FROM menu_fillings WHERE menu_item_id = ?",
        [id],
      );
      savedFillings.forEach((f) =>
        window.addMenuFillingRow(f.recipe_id, f.is_default, f.qty),
      );

      // Cập nhật trạng thái của nút "Thêm nhân bánh" và header
      window.updateFillingControlsState();

      window.calculateTotal();
      // Đè lại giá trị margin từ DB để khớp với bảng, tránh lệch do giá vật tư thay đổi
      if ($("m-margin"))
        $("m-margin").value = (item.profit_margin || 0).toFixed(4);
    } catch (error) {
      console.error("Lỗi editMenu:", error);
    }
  };

  window.deleteMenu = async (id, name) => {
    try {
      const activeOrders = await API.db_query(
        "SELECT items_json FROM orders WHERE status IN ('pending', 'processing')",
      );
      const isUsed = activeOrders.some((order) => {
        try {
          return JSON.parse(order.items_json || "[]").some((i) => i.id === id);
        } catch {
          return false;
        }
      });

      if (isUsed)
        return window.showToast?.(
          "Không thể xóa: Đang nằm trong đơn hàng chờ xử lý!",
          "warning",
        );
      if (
        window.showConfirm &&
        !(await window.showConfirm(
          "Xóa món bánh",
          `Chắc chắn muốn xóa "${name}"?`,
        ))
      )
        return;

      window.menuSourceData = null; // Invalidate cache
      await API.db_execute("UPDATE menu_items SET is_active = 0 WHERE id = ?", [
        id,
      ]);
      window.showToast?.("Đã xóa món thành công!", "success");
      window.loadMenu();
    } catch (error) {
      console.error(error);
    }
  };

  window.closeMenuModal = () => {
    $("menu-modal").classList.remove("flex");
  };

  // Khởi tạo định dạng cho các ô nhập liệu số khi gõ
  function initMenuInputFormatters() {
    ["m-elec", "m-depr", "m-labor", "m-final-price"].forEach((id) => {
      const el = $(id);
      if (!el) return;

      // Tránh gắn nhiều listener nếu modal mở đi mở lại
      if (el.dataset.listenerAttached) return;

      el.addEventListener("input", () => {
        window.formatInputOnType(el);
        window.calculateTotal(); // Tính lại tổng ngay khi nhập
      });
      el.dataset.listenerAttached = "true";
    });
  }

  // Theo dõi DOM để gán sự kiện ngay khi Modal được nạp vào
  const observer = new MutationObserver(() => {
    // Luôn kiểm tra sự tồn tại của các input để init formatters
    // Không dùng disconnect() để đảm bảo khi mở lại modal vẫn hoạt động
    if ($("m-final-price")) initMenuInputFormatters();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Khởi tạo ngay nếu phần tử đã tồn tại trong DOM
  if ($("m-final-price")) initMenuInputFormatters();

  // Helper để cập nhật trạng thái của nút "Thêm nhân bánh" và header
  window.updateFillingControlsState = () => {
    const addFillingBtn = document.querySelector(
      "#menu-modal .form-section button[onclick='window.addMenuFillingRow()']",
    );
    const fillingsHeader = document.querySelector(".fillings-header");
    const currentFillingRows = $$(".filling-row");

    if (!addFillingBtn || !fillingsHeader) return;

    // 1. Lấy tất cả ID đang được chọn trên toàn bộ các dòng
    const allSelectedIds = Array.from(currentFillingRows)
      .map((row) => {
        const s = row.querySelector(".filling-id-select");
        return parseInt(s?.value) || parseInt(s?.dataset.pendingValue);
      })
      .filter((id) => !isNaN(id));

    // 2. Cập nhật lại danh sách option cho từng ô select
    currentFillingRows.forEach((row) => {
      const select = row.querySelector(".filling-id-select");
      if (!select) return;

      // Ưu tiên giá trị thực tế, nếu chưa có thì lấy từ dataset (cho hàng mới load)
      const currentVal =
        parseInt(select.value) || parseInt(select.dataset.pendingValue);
      // Danh sách khả dụng cho ô này = (Tất cả nhân - Nhân đã chọn ở các dòng KHÁC)
      const othersSelected = allSelectedIds.filter((id) => id !== currentVal);
      const availableOptions = window.fillingOptions.filter(
        (f) => !othersSelected.includes(f.id),
      );

      select.innerHTML = availableOptions
        .map(
          (f) =>
            `<option value="${f.id}" ${f.id === currentVal ? "selected" : ""}>${f.name} - ${window.formatNumber(f.unit_cost)}đ</option>`,
        )
        .join("");

      // Gán lại giá trị thực tế và xóa dữ liệu tạm
      if (!isNaN(currentVal)) {
        select.value = currentVal;
        delete select.dataset.pendingValue;
      }
    });

    // 3. Cập nhật trạng thái nút "Thêm nhân" và Header
    const unselectedOptions = window.fillingOptions.filter(
      (f) => !allSelectedIds.includes(f.id),
    );

    fillingsHeader.classList.toggle("hidden", currentFillingRows.length === 0);
    fillingsHeader.classList.toggle("flex", currentFillingRows.length !== 0);

    if (unselectedOptions.length === 0 && window.fillingOptions.length > 0) {
      addFillingBtn.disabled = true;
      addFillingBtn.innerText = "Hết nhân bánh để thêm";
    } else {
      addFillingBtn.disabled = false;
      addFillingBtn.innerText = "+ Thêm nhân bánh";
    }

    // Đảm bảo luôn có ít nhất 1 nhân mặc định nếu danh sách không trống
    const checkedRadio = document.querySelector(".is-default-radio:checked");
    if (!checkedRadio && currentFillingRows.length > 0) {
      currentFillingRows[0].querySelector(".is-default-radio").checked = true;
    }
  };

  document.addEventListener("DOMContentLoaded", window.loadMenu);
})();
