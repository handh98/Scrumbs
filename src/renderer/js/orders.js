(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  window.orderState = {
    currentPage: 1,
    keyword: "",
    items: [],
    menuItems: [],
    selectedCustomerId: null,
    selectedMenuPicker: null,
    currentItemFillings: [],
    customersCache: null,
    startDate: "",
    endDate: "",
  };

  const fetchAvailableMenuItems = async () => {
    const priceQuery = `
      SELECT m.id, m.name, COALESCE(m.selling_price, 0) AS price,
        COALESCE((
          COALESCE((SELECT SUM(mr.ratio * (SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) / CAST(r.output AS REAL) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = mr.recipe_id)) FROM menu_recipes mr WHERE mr.menu_item_id = m.id), 0) +
          COALESCE((SELECT SUM(mp.qty * i.unit_price) FROM menu_packaging mp JOIN ingredients i ON mp.ingredient_id = i.id WHERE mp.menu_item_id = m.id), 0) +
          COALESCE((SELECT SUM(mig.qty * i.unit_price) FROM menu_ingredients mig JOIN ingredients i ON mig.ingredient_id = i.id WHERE mig.menu_item_id = m.id), 0) +
          m.electricity + m.depreciation + m.labor
        ), 0) AS base_cost
      FROM menu_items m WHERE m.is_active = 1
    `;
    const items = await API.db_query(priceQuery);
    return items.map((item) => ({
      ...item,
      price: Math.round(item.price),
      base_cost: item.base_cost,
      _normalizedName: window.removeAccents(item.name),
    }));
  };

  window.loadOrders = async () => {
    await window.showLoader(true);
    try {
      const tbody = $("order-list-body");
      const paginationContainer = $("order-pagination");
      if (!tbody) return;

      const searchInput = $("order-search");
      if (searchInput) window.orderState.keyword = searchInput.value.trim();

      const startDateInput = $("filter-start-date");
      const endDateInput = $("filter-end-date");
      if (startDateInput) window.orderState.startDate = startDateInput.value;
      if (endDateInput) window.orderState.endDate = endDateInput.value;

      const statusFilter = $("filter-status")?.value || "all";
      const kw = window.orderState.keyword
        ? `%${window.orderState.keyword}%`
        : null;

      let whereClause = "";
      let params = [];
      if (statusFilter !== "all") {
        whereClause += " WHERE o.status = ?";
        params.push(statusFilter);
      }
      if (window.orderState.startDate) {
        whereClause +=
          (whereClause ? " AND" : " WHERE") + " o.delivery_date >= ?";
        params.push(window.orderState.startDate);
      }
      if (window.orderState.endDate) {
        whereClause +=
          (whereClause ? " AND" : " WHERE") + " o.delivery_date <= ?";
        params.push(window.orderState.endDate);
      }
      if (kw) {
        whereClause +=
          (whereClause ? " AND" : " WHERE") +
          " orders.customer_id IN (SELECT rowid FROM customers_fts WHERE customers_fts MATCH ?)";
        const searchQuery = window
          .removeAccents(window.orderState.keyword)
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => `${t.replace(/"/g, '""')}*`)
          .join(" ");
        params.push(searchQuery);
      }

      const sql = `SELECT o.*, c.name as cust_name, c.phone as cust_phone FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ${whereClause} ORDER BY o.delivery_date DESC, o.id DESC`;
      const orders = await API.db_query(sql, params).catch(() => []);

      if (!orders.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="no-data text-center">Không có đơn hàng nào phù hợp.</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        orders,
        itemsPerPage,
        window.orderState.currentPage,
        (newPage) => {
          window.orderState.currentPage = newPage;
          window.loadOrders();
        },
      );

      tbody.innerHTML = pagingResult.data
        .map((o) => {
          // Khóa không cho Edit thông tin khách/món ăn nếu đơn đang làm hoặc đã xong
          const isEditingLocked =
            o.status === "processing" ||
            o.status === "completed" ||
            o.status === "cancelled";
          return `
          <tr>
            <td class="text-center"><b>#${o.id}</b></td>
            <td><div><b>${o.cust_name || "Khách vãng lai"}</b></div><div class="text-muted" style="font-size: 12px;">${o.cust_phone || "---"}</div></td>
            <td class="text-center"><b>${o.delivery_date}</b></td>
            <td class="text-center">
              <select class="status-quick-select" data-original="${o.status}" onchange="window.updateOrderStatusQuick(${o.id}, this.value, this)">
                <option value="pending" ${o.status === "pending" ? "selected" : ""}>Chờ xử lý</option>
                <option value="processing" ${o.status === "processing" ? "selected" : ""}>Đang làm</option>
                <option value="completed" ${o.status === "completed" ? "selected" : ""}>Hoàn thành</option>
                <option value="cancelled" ${o.status === "cancelled" ? "selected" : ""}>Hủy đơn</option>
              </select>
            </td>
            <td class="text-center text-primary"><b>${window.formatNumber(o.total_amount)} đ</b></td>
            <td class="text-center note-column has-tooltip" data-note="${o.note?.trim() || "..."}">${o.note?.trim() || "..."}</td>
            <td class="text-center action-column">
              <button class="btn-secondary" title="Xem chi tiết" onclick="window.openOrderModal('view', ${o.id})"><img src="src/renderer/assets/view.svg" class="icon" /></button>
              ${isEditingLocked ? "" : `<button class="btn-secondary" title="Sửa" onclick="window.openOrderModal('edit', ${o.id})"><img src="src/renderer/assets/edit.svg" class="icon" /></button>`}
            </td>
          </tr>
        `;
        })
        .join("");

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;
    } catch (error) {
      console.error(error);
      window.showToast?.("Lỗi tải đơn hàng!", "error");
    } finally {
      await window.showLoader(false);
    }
  };

  // --- LOGIC TRỪ / HOÀN KHO THỜI GIAN THỰC ---
  window.updateOrderStatusQuick = async (id, newStatus, selectEl) => {
    const oldStatus = selectEl.getAttribute("data-original");
    if (oldStatus === newStatus) return;

    try {
      const confirmMsg =
        newStatus === "cancelled"
          ? "Xác nhận HỦY đơn hàng? Kho sẽ được hoàn trả (nếu đã trừ)."
          : newStatus === "processing"
            ? "Đơn sẽ được mang đi làm. KHO SẼ BỊ TRỪ NGAY LẬP TỨC. Tiếp tục?"
            : `Chuyển trạng thái sang ${newStatus}?`;

      if (
        window.showConfirm &&
        !(await window.showConfirm("Xác nhận trạng thái", confirmMsg))
      ) {
        selectEl.value = oldStatus;
        return;
      }

      await window.showLoader(true);

      // Nếu chuyển từ Pending -> Processing/Completed: TRỪ KHO
      if (
        oldStatus === "pending" &&
        (newStatus === "processing" || newStatus === "completed")
      ) {
        await window.deductInventoryFromOrder(id);
      }

      // Nếu đơn đang làm/đã xong bị Hủy hoặc Trả về Pending: HOÀN KHO
      if (
        (oldStatus === "processing" || oldStatus === "completed") &&
        (newStatus === "cancelled" || newStatus === "pending")
      ) {
        await window.restoreInventoryFromOrder(id);
      }

      // Cập nhật trạng thái trong DB
      await API.db_run("UPDATE orders SET status = ? WHERE id = ?", [
        newStatus,
        id,
      ]);

      selectEl.setAttribute("data-original", newStatus);
      await window.showLoader(false);
      window.loadOrders();
    } catch (err) {
      console.error("Lỗi cập nhật trạng thái đơn hàng:", err);
      selectEl.value = oldStatus;
      await window.showLoader(false);
    }
  };

  // --- CRUD MODAL ĐƠN HÀNG ---
  window.openOrderModal = async (mode = "add", id = null) => {
    const modal = $("order-modal");
    if (!modal) return;

    window.orderState.customersCache = null;
    modal.setAttribute("data-mode", mode);
    modal.setAttribute("data-editing-id", id || "");

    const btnCancel = modal.querySelector(".modal-footer .btn-secondary");
    if (btnCancel) btnCancel.innerText = mode === "view" ? "Đóng" : "Hủy bỏ";

    [
      "o-customer",
      "o-phone",
      "o-address",
      "o-date",
      "o-note",
      "o-menu-search",
    ].forEach((elId) => {
      if ($(elId)) $(elId).value = "";
    });
    $("o-item-qty").value = 1;
    $("o-status").value = "pending";
    window.orderState.items = [];
    window.orderState.selectedCustomerId = null;
    window.orderState.selectedMenuPicker = null;

    await window.showLoader(true);
    try {
      window.orderState.menuItems = await fetchAvailableMenuItems();

      if (mode !== "add" && id) {
        const data = await API.db_query(
          `SELECT orders.*, customers.name AS cust_name, customers.phone AS cust_phone, customers.address AS cust_address FROM orders LEFT JOIN customers ON orders.customer_id = customers.id WHERE orders.id = ?`,
          [id],
        );
        if (data?.length) {
          const order = data[0];
          window.orderState.selectedCustomerId = order.customer_id;
          $("o-customer").value = order.cust_name || "";
          $("o-phone").value = order.cust_phone || "";
          $("o-address").value = order.cust_address || "";
          $("o-date").value = order.delivery_date || "";
          $("o-status").value = order.status || "pending";
          $("o-note").value = order.note || "";

          const parsedItems = order.items_json
            ? JSON.parse(order.items_json)
            : [];
          for (const item of parsedItems) {
            const allFillingsForMenuItem = await API.db_query(
              `SELECT r.id, r.name, mf.is_default, (CASE WHEN mf.price > 0 THEN mf.price ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id) END) * mf.qty AS price, (SELECT SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id) * mf.qty AS cost FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id WHERE mf.menu_item_id = ?`,
              [item.menu_id],
            );
            window.orderState.items.push({
              ...item,
              all_fillings: allFillingsForMenuItem,
            });
          }

          // LOCK CHẶT NẾU ĐƠN ĐÃ LÀM HOẶC HOÀN THÀNH
          const isReadOnly =
            mode === "view" ||
            order.status === "processing" ||
            order.status === "completed" ||
            order.status === "cancelled";
          modal.toggleAttribute("data-readonly", isReadOnly);
          $("order-modal-title").innerText = isReadOnly
            ? "Chi Tiết Đơn Hàng"
            : "Chỉnh Sửa Đơn Hàng";
        }
      } else {
        modal.removeAttribute("data-readonly");
        $("order-modal-title").innerText = "Tạo Đơn Hàng Mới";
      }

      const isReadOnly = modal.hasAttribute("data-readonly");
      [
        "o-customer",
        "o-phone",
        "o-address",
        "o-date",
        "o-note",
        "o-menu-search",
        "o-item-qty",
      ].forEach((elId) => {
        if ($(elId)) $(elId).disabled = isReadOnly;
      });
      $("o-status").disabled = true;

      const btnAddItem = document.querySelector(".btn-add-item");
      if (btnAddItem) btnAddItem.disabled = isReadOnly;
      const pickerRow = document.querySelector(".ingredient-picker-row");
      if (pickerRow) pickerRow.style.display = isReadOnly ? "none" : "";
      if ($("btn-save-order"))
        $("btn-save-order").style.display = isReadOnly ? "none" : "block";

      window.renderOrderItems();
      modal.classList.add("flex");
    } catch (error) {
      console.error(error);
      window.showToast?.("Lỗi", "error");
    } finally {
      window.showLoader(false);
    }
  };

  window.closeOrderModal = () => {
    $("order-modal").classList.remove("flex");
    $("customer-dropdown").classList.remove("show");
    $("menu-dropdown").classList.remove("show");
  };

  // --- CÁC HÀM UI PICKER GIỮ NGUYÊN ---
  window.applyDateFilter = window.debounce(() => {
    const startDateInput = $("filter-start-date");
    const endDateInput = $("filter-end-date");
    if (startDateInput && endDateInput) {
      endDateInput.min = startDateInput.value;
      startDateInput.max = endDateInput.value;
    }
    window.orderState.currentPage = 1;
    window.loadOrders();
  }, 300);
  window.resetDateFilter = () => {
    const startInput = $("filter-start-date");
    const endInput = $("filter-end-date");
    if (startInput) {
      startInput.value = "";
      startInput.max = "";
    }
    if (endInput) {
      endInput.value = "";
      endInput.min = "";
    }
    window.orderState.startDate = "";
    window.orderState.endDate = "";
    window.orderState.currentPage = 1;
    window.loadOrders();
  };
  window.onCustomerInput = window.debounce(async () => {
    if ($("order-modal")?.hasAttribute("data-readonly")) return;
    const txt = $("o-customer")?.value.trim() || "";
    const dropdown = $("customer-dropdown");
    window.orderState.selectedCustomerId = null;
    if (!txt) return dropdown.classList.remove("show");
    if (!window.orderState.customersCache) {
      const raw = await API.db_query(
        "SELECT * FROM customers WHERE is_active = 1",
      );
      raw.forEach((c) => (c._normalizedName = window.removeAccents(c.name)));
      window.orderState.customersCache = raw;
    }
    const normalizedTxt = window.removeAccents(txt);
    const customers = window.orderState.customersCache
      .filter(
        (c) =>
          c._normalizedName.includes(normalizedTxt) ||
          (c.phone && c.phone.includes(txt)),
      )
      .slice(0, 5);
    if (!customers?.length) return dropdown.classList.remove("show");
    dropdown.innerHTML = customers
      .map(
        (c) =>
          `<div class="dropdown-item" onmousedown="window.selectCustomerRow(${c.id}, '${c.name.replace(/'/g, "\\'")}', '${(c.phone || "").replace(/'/g, "\\'")}', '${(c.address || "").replace(/'/g, "\\'")}')"><b>${c.name}</b> - ${c.phone || "Chưa có SĐT"}</div>`,
      )
      .join("");
    dropdown.classList.add("show");
  }, 300);
  window.selectCustomerRow = (id, name, phone, address) => {
    $("o-customer").value = name;
    $("o-phone").value = phone;
    $("o-address").value = address;
    window.orderState.selectedCustomerId = id;
    $("customer-dropdown").classList.remove("show");
  };
  document.addEventListener("DOMContentLoaded", () => {
    const custInput = $("o-customer");
    if (custInput && !$("o-customer").dataset.blurBound) {
      $("o-customer").dataset.blurBound = "1";
      custInput.addEventListener("blur", () =>
        $("customer-dropdown")?.classList.remove("show"),
      );
    }
  });

  window.onMenuSearchInput = window.debounce(() => {
    const txt = $("o-menu-search")?.value.trim() || "";
    const normalizedTxt = window.removeAccents(txt);
    const dropdown = $("menu-dropdown");
    const filtered = window.orderState.menuItems.filter((m) =>
      m._normalizedName.includes(normalizedTxt),
    );
    dropdown.innerHTML = filtered.length
      ? filtered
          .map(
            (m) =>
              `<div class="dropdown-item" onmousedown="window.selectMenuPickerItem(${m.id}, '${m.name.replace(/'/g, "\\'")}', ${m.price || 0})">${m.name} - ${window.formatNumber(m.price || 0)}đ</div>`,
          )
          .join("")
      : `<div class="dropdown-item no-match">Không tìm thấy bánh</div>`;
    dropdown.classList.add("show");
  }, 300);

  window.selectMenuPickerItem = async (id, name, price) => {
    $("o-menu-search").value = name;
    const selectedItem = window.orderState.menuItems.find((m) => m.id === id);
    const base_cost = selectedItem ? selectedItem.base_cost : 0;
    window.orderState.selectedMenuPicker = { id, name, price, base_cost };
    $("menu-dropdown").classList.remove("show");
    window.orderState.currentItemFillings = await API.db_query(
      `SELECT r.id, r.name, mf.is_default, (CASE WHEN mf.price > 0 THEN mf.price ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id) END) * mf.qty AS price, (SELECT SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id) * mf.qty AS cost FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id WHERE mf.menu_item_id = ?`,
      [id],
    );
    const fillingPicker = $("o-filling-picker");
    if (fillingPicker) {
      let optionsHtml = `<option value="0" data-filling-price="0" data-filling-cost="0">Không nhân - 0đ</option>`;
      optionsHtml += window.orderState.currentItemFillings
        .map(
          (f) =>
            `<option value="${f.id}" ${f.is_default ? "selected" : ""} data-filling-price="${f.price}" data-filling-cost="${f.cost}">${f.name} - ${window.formatNumber(f.price)}đ</option>`,
        )
        .join("");
      fillingPicker.innerHTML = optionsHtml;
      const defaultFilling = window.orderState.currentItemFillings.find(
        (f) => f.is_default,
      );
      fillingPicker.value = defaultFilling ? defaultFilling.id : "0";
    }
  };

  window.addOrderItem = () => {
    const qtyInput = $("o-item-qty");
    const fillingPicker = $("o-filling-picker");
    const qty = parseInt(qtyInput?.value) || 0;
    if (!window.orderState.selectedMenuPicker || qty <= 0)
      return window.showToast?.("Vui lòng chọn bánh!", "warning");
    let fillingId = 0;
    let fillingName = "Không nhân";
    let fillingPrice = 0;
    let fillingCost = 0;
    if (fillingPicker && fillingPicker.value !== "0") {
      fillingId = parseInt(fillingPicker.value);
      const selectedOption = fillingPicker.options[fillingPicker.selectedIndex];
      fillingName = selectedOption
        ? selectedOption.text.split(" - ")[0].trim()
        : "";
      fillingPrice = parseFloat(selectedOption?.dataset.fillingPrice) || 0;
      fillingCost = parseFloat(selectedOption?.dataset.fillingCost) || 0;
    }
    const baseCake = window.orderState.selectedMenuPicker;
    const existing = window.orderState.items.find(
      (i) => i.menu_id === baseCake.id && i.filling_id === fillingId,
    );
    if (existing) {
      existing.qty += qty;
      existing.subtotal =
        existing.qty * (existing.base_price + existing.filling_price);
    } else {
      window.orderState.items.push({
        menu_id: baseCake.id,
        base_name: baseCake.name,
        base_price: baseCake.price,
        base_cost: baseCake.base_cost || 0,
        filling_id: fillingId,
        filling_name: fillingName,
        filling_price: fillingPrice,
        filling_cost: fillingCost || 0,
        all_fillings: [...window.orderState.currentItemFillings],
        qty,
        subtotal: qty * (baseCake.price + fillingPrice),
      });
    }
    $("o-menu-search").value = "";
    if (fillingPicker)
      fillingPicker.innerHTML = '<option value="0">Không nhân - 0đ</option>';
    qtyInput.value = 1;
    window.orderState.selectedMenuPicker = null;
    window.renderOrderItems();
  };
  window.updateOrderItemQty = (index, newQty) => {
    const qty = parseInt(newQty) || 0;
    if (qty < 0) return;
    const item = window.orderState.items[index];
    item.qty = qty;
    item.subtotal = qty * (item.base_price + item.filling_price);
    window.renderOrderItems();
  };
  window.updateOrderItemFilling = (index, newFillingId) => {
    const item = window.orderState.items[index];
    if (!item) return;
    newFillingId = parseInt(newFillingId);
    if (newFillingId === 0) {
      item.filling_id = 0;
      item.filling_name = "Không nhân";
      item.filling_price = 0;
      item.filling_cost = 0;
    } else {
      const f = item.all_fillings.find((fill) => fill.id === newFillingId);
      if (f) {
        item.filling_id = f.id;
        item.filling_name = f.name;
        item.filling_price = f.price;
        item.filling_cost = f.cost;
      }
    }
    item.subtotal = item.qty * (item.base_price + item.filling_price);
    window.renderOrderItems();
  };
  window.removeOrderItem = (index) => {
    window.orderState.items.splice(index, 1);
    window.renderOrderItems();
  };

  window.renderOrderItems = () => {
    const isReadOnly = $("order-modal")?.hasAttribute("data-readonly");
    const thDel = document.querySelector(".modal-col-del");
    if (thDel) thDel.innerText = isReadOnly ? "" : "Xóa";
    const total = window.orderState.items.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );
    $("order-items-body").innerHTML = window.orderState.items.length
      ? window.orderState.items
          .map((item, index) => {
            const unitPrice = item.base_price + item.filling_price;
            let fillingSelectHtml = '<div class="text-center">---</div>';
            if (item.all_fillings && item.all_fillings.length > 0) {
              fillingSelectHtml = `<select class="item-filling-select" onchange="window.updateOrderItemFilling(${index}, this.value)" ${isReadOnly ? "disabled" : ""}>`;
              fillingSelectHtml += `<option value="0" ${item.filling_id === 0 ? "selected" : ""}>Không nhân - 0đ</option>`;
              fillingSelectHtml += item.all_fillings
                .map(
                  (f) =>
                    `<option value="${f.id}" ${f.id === item.filling_id ? "selected" : ""}>${f.name} - ${window.formatNumber(f.price)}đ</option>`,
                )
                .join("");
              fillingSelectHtml += `</select>`;
            }
            return `<tr><td>${item.base_name}</td><td>${fillingSelectHtml}</td><td class="text-right">${window.formatNumber(unitPrice)} đ</td><td class="text-center"><input type="number" class="item-qty-input" value="${item.qty}" min="1" oninput="window.updateOrderItemQty(${index}, this.value)" ${isReadOnly ? "disabled" : ""}></td><td class="item-subtotal-text text-right">${window.formatNumber(item.subtotal)} đ</td><td class="text-center">${isReadOnly ? "" : `<button class="btn-delete-row" onclick="window.removeOrderItem(${index})">❌</button>`}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="no-data text-center">Chưa chọn bánh nào</td></tr>`;
    if ($("o-total-amount-display"))
      $("o-total-amount-display").innerText = window.formatNumber(total) + " đ";
  };

  window.saveOrder = async () => {
    const modal = $("order-modal");
    if (modal?.hasAttribute("data-readonly")) return;
    const customerName = $("o-customer")?.value.trim();
    const date = $("o-date")?.value || null;
    if (!customerName)
      return window.showToast?.("Nhập tên khách hàng!", "warning");
    if (!date) {
      window.showToast?.("Chọn ngày giao bánh!", "warning");
      return $("o-date")?.focus();
    }
    if (!window.orderState.items.length)
      return window.showToast?.("Vui lòng thêm món bánh!", "warning");

    const phone = $("o-phone")?.value.trim() || "";
    const address = $("o-address")?.value.trim() || "";
    const note = $("o-note")?.value.trim() || "";
    const status =
      modal.getAttribute("data-mode") === "add"
        ? "pending"
        : $("o-status").value;
    const totalAmount = window.orderState.items.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );

    await window.showLoader(true);
    try {
      window.orderState.customersCache = null;
      let custId = window.orderState.selectedCustomerId;
      const itemsToSave = window.orderState.items.map((item) => {
        const itemCopy = { ...item };
        delete itemCopy.all_fillings;
        return itemCopy;
      });

      if (!custId) {
        const query = phone
          ? "SELECT id FROM customers WHERE name=? AND phone=? LIMIT 1"
          : "SELECT id FROM customers WHERE name=? AND (phone IS NULL OR phone='') LIMIT 1";
        const checkCust = await API.db_query(
          query,
          phone ? [customerName, phone] : [customerName],
        );
        if (checkCust?.length) {
          custId = checkCust[0].id;
        } else {
          await API.db_execute(
            "INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)",
            [customerName, phone, address],
          );
          const [{ id }] = await API.db_query(
            "SELECT last_insert_rowid() AS id",
          );
          custId = id;
        }
      } else {
        await API.db_execute(
          "UPDATE customers SET phone=?, address=? WHERE id=?",
          [phone, address, custId],
        );
      }

      if (modal.getAttribute("data-mode") === "edit") {
        await API.db_execute(
          "UPDATE orders SET customer_id=?, delivery_date=?, status=?, total_amount=?, items_json=?, note=? WHERE id=?",
          [
            custId,
            date,
            status,
            totalAmount,
            JSON.stringify(itemsToSave),
            note,
            modal.getAttribute("data-editing-id"),
          ],
        );
        window.showToast?.("Cập nhật đơn hàng thành công!", "success");
      } else {
        await API.db_execute(
          "INSERT INTO orders (customer_id, delivery_date, status, total_amount, items_json, note) VALUES (?, ?, ?, ?, ?, ?)",
          [
            custId,
            date,
            status,
            totalAmount,
            JSON.stringify(itemsToSave),
            note,
          ],
        );
        window.showToast?.("Tạo đơn hàng mới thành công!", "success");
      }
      window.closeOrderModal();
      window.loadOrders();
    } catch (error) {
      console.error(error);
      window.showToast?.("Có lỗi khi lưu đơn hàng!", "error");
    } finally {
      window.showLoader(false);
    }
  };
})();
