(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;
  const escHtml = window.escHtml;

  // Quy hoạch State vào một đối tượng duy nhất để dễ quản lý và debug
  window.orderState = {
    currentPage: 1,
    keyword: "",
    items: [], // Danh sách các món hàng trong đơn đang tạo/sửa
    menuItems: [], // Danh sách các món bánh có sẵn để chọn
    selectedCustomerId: null, // ID khách hàng đang chọn
    selectedMenuPicker: null, // Món bánh đang chọn trong picker
    currentItemFillings: [], // Các loại nhân của món bánh đang chọn
    customersCache: null, // Cache khách hàng cho autocomplete
    startDate: "",
    endDate: "",
  };

  /**
   * Fetches active menu items and calculates their current estimated selling price.
   * @returns {Promise<Array<Object>>}
   */
  const fetchAvailableMenuItems = async () => {
    const priceQuery = `
      SELECT m.id, m.name,
        COALESCE((
          COALESCE((SELECT SUM(mr.ratio * (SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) / CAST(r.output AS REAL) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = mr.recipe_id)) FROM menu_recipes mr WHERE mr.menu_item_id = m.id), 0) +
          COALESCE((SELECT SUM(mp.qty * i.unit_price) FROM menu_packaging mp JOIN ingredients i ON mp.ingredient_id = i.id WHERE mp.menu_item_id = m.id), 0) +
          m.electricity + m.depreciation + m.labor
        ) / CASE WHEN m.profit_margin < 100 AND m.profit_margin > 0 THEN (1 - (m.profit_margin / 100.0)) ELSE 1 END, 0) AS price
      FROM menu_items m WHERE m.is_active = 1
    `;
    const items = await API.db_query(priceQuery);
    return items.map((item) => ({
      ...item,
      price: Math.round(item.price),
      _normalizedName: window.removeAccents(item.name),
    }));
  };

  /**
   * Fetches and renders the order list based on filters, pagination, and sorting.
   * @returns {Promise<void>}
   */
  window.loadOrders = async () => {
    await window.showLoader(true);
    try {
      const tbody = $("order-list-body");
      const paginationContainer = $("order-pagination");
      if (!tbody) return;

      // Đồng bộ keyword từ UI
      const searchInput = $("order-search");
      if (searchInput) {
        window.orderState.keyword = searchInput.value.trim();
      }

      const startDateInput = $("filter-start-date");
      const endDateInput = $("filter-end-date");
      if (startDateInput) {
        window.orderState.startDate = startDateInput.value;
      }
      if (endDateInput) {
        window.orderState.endDate = endDateInput.value;
      }

      const statusFilter = $("filter-status")?.value || "all";
      const dateSort = $("sort-delivery-date")?.value || "desc";
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

        const cleanKeyword = window.removeAccents(window.orderState.keyword);
        const tokens = cleanKeyword.split(/\s+/).filter(Boolean);
        const searchQuery = tokens
          .map((t) => `${t.replace(/"/g, '""')}*`)
          .join(" ");
        params.push(searchQuery);
      }

      const orderBy =
        dateSort === "asc"
          ? "ORDER BY o.delivery_date ASC"
          : "ORDER BY o.delivery_date DESC";

      const sql = `
        SELECT o.*, c.name as cust_name, c.phone as cust_phone
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        ${whereClause}
        ${orderBy}
      `;

      const orders = await API.db_query(sql, params).catch(() => []);

      if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="no-data text-center">Không có đơn hàng nào phù hợp.</td></tr>`;
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
          let itemsHtml = `<span class="text-muted">Lỗi dữ liệu đơn hàng</span>`;
          try {
            const items = o.items_json ? JSON.parse(o.items_json) : [];
            itemsHtml = items
              .map(
                (i) =>
                  `<span>${escHtml(i.base_name)} x${escHtml(i.qty)}</span>`,
              )
              .join("");
          } catch (err) {
            console.error("Lỗi parse items_json:", err);
          }

          return `
          <tr>
            <td class="text-center"><b>#${o.id}</b></td>
            <td>
              <div><b>${o.cust_name || "Khách vãng lai"}</b></div>
              <div class="text-muted" style="font-size: 12px;">${o.cust_phone || "---"}</div>
            </td>
            <td class="text-center"><b>${o.delivery_date}</b></td>
            <td class="text-center"><span class="badge-${o.status}">${o.status}</span></td>
            <td class="text-center text-primary"><b>${window.formatNumber(o.total_amount)} đ</b></td>
            <td class="text-center note-column">${o.note || "---"}</td>
            <td class="text-center">
              <button class="btn-secondary" title="Chỉnh sửa đơn" onclick="window.openOrderEdit(${o.id})">
                <img src="src/renderer/assets/edit.svg" class="icon" />
              </button>
            </td>
          </tr>
        `;
        })
        .join("");

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;
    } catch (error) {
      console.error("Lỗi tải danh sách đơn hàng:", error);
      window.showToast?.(
        `Lỗi tải đơn hàng: ${error.message || "Không xác định"}`,
        "error",
      );
    } finally {
      await window.showLoader(false);
    }
  };

  /**
   * Quickly updates order status from the table list.
   * @param {number} id - Order ID.
   * @param {string} newStatus - New status value.
   */
  window.updateOrderStatusQuick = async (id, newStatus) => {
    try {
      if (newStatus === "completed" || newStatus === "cancelled") {
        const statusText = newStatus === "completed" ? "Hoàn thành" : "Đã hủy";
        if (
          window.showConfirm &&
          !(await window.showConfirm(
            "Xác nhận thay đổi",
            `Chuyển đơn #${id} sang "${statusText}"? Đơn hàng sẽ bị khóa hoàn toàn.`,
          ))
        ) {
          return window.loadOrders();
        }
      }

      if (newStatus === "completed") {
        await deductInventoryFromOrder(id);
      }

      await API.db_execute("UPDATE orders SET status = ? WHERE id = ?", [
        newStatus,
        id,
      ]);
      window.showToast?.("Cập nhật trạng thái thành công!", "success");
      window.loadOrders();
    } catch (error) {
      console.error("Lỗi cập nhật trạng thái nhanh:", error);
      const errorMsg = error.message || "Không thể cập nhật trạng thái đơn!";
      window.showToast?.(errorMsg, "error");
      window.loadOrders();
    }
  };

  window.openOrderDetail = async (id) => {
    const modal = $("order-modal");
    if (!modal) return;

    modal.setAttribute("data-mode", "view");
    modal.removeAttribute("data-editing-id");
    modal.setAttribute("data-readonly", "true");

    const btnCancel = modal.querySelector(".modal-footer .btn-secondary");
    if (btnCancel) btnCancel.innerText = "Đóng";
    if ($("btn-save-order")) $("btn-save-order").style.display = "none";

    window.orderState.menuItems = await fetchAvailableMenuItems();
    const data = await API.db_query(
      `SELECT orders.*, customers.name AS cust_name, customers.phone AS cust_phone, customers.address AS cust_address FROM orders LEFT JOIN customers ON orders.customer_id = customers.id WHERE orders.id = ?`,
      [id],
    );

    if (!data?.length) return;
    const order = data[0];
    window.orderState.selectedCustomerId = order.customer_id;

    $("order-modal-title").innerText = "Chi Tiết Đơn Hàng";
    [
      "o-customer",
      "o-phone",
      "o-address",
      "o-date",
      "o-status",
      "o-note",
      "o-menu-search",
      "o-item-qty",
    ].forEach((elId) => {
      if ($(elId)) $(elId).disabled = true;
    });

    if (document.querySelector(".btn-add-item"))
      document.querySelector(".btn-add-item").disabled = true;

    $("o-customer").value = order.cust_name || "";
    $("o-phone").value = order.cust_phone || "";
    $("o-address").value = order.cust_address || "";
    $("o-date").value = order.delivery_date || "";
    if ($("o-status")) $("o-status").value = order.status || "pending";
    $("o-note").value = order.note || "";

    window.orderState.items = [];
    const parsedItems = order.items_json ? JSON.parse(order.items_json) : [];

    for (const item of parsedItems) {
      const allFillingsForMenuItem = await API.db_query(
        `SELECT r.id, r.name, mf.is_default,
            (CASE WHEN mf.price > 0 THEN mf.price
                  ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id)
            END) * mf.qty AS price
           FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id
           WHERE mf.menu_item_id = ?`,
        [item.menu_id],
      );

      window.orderState.items.push({
        ...item,
        all_fillings: allFillingsForMenuItem,
      });
    }

    window.renderOrderItems();
    modal.classList.add("flex");
  };
  /** Opens the order modal in 'Edit' mode — inputs enabled, nút Lưu hiển thị. */
  window.openOrderEdit = async (id) => {
    const modal = $("order-modal");
    if (!modal) return;
    modal.setAttribute("data-mode", "edit");
    modal.setAttribute("data-editing-id", String(id));
    modal.removeAttribute("data-readonly");
    const btnCancel = modal.querySelector(".modal-footer .btn-secondary");
    if (btnCancel) btnCancel.innerText = "Hủy";
    if ($("btn-save-order")) $("btn-save-order").style.display = "block";
    [
      "o-customer",
      "o-phone",
      "o-address",
      "o-date",
      "o-status",
      "o-note",
      "o-menu-search",
      "o-item-qty",
    ].forEach((elId) => {
      if ($(elId)) $(elId).disabled = false;
    });
    if (document.querySelector(".btn-add-item"))
      document.querySelector(".btn-add-item").disabled = false;
    window.orderState.menuItems = await fetchAvailableMenuItems();
    const data = await API.db_query(
      `SELECT orders.*, customers.name AS cust_name, customers.phone AS cust_phone, customers.address AS cust_address
         FROM orders LEFT JOIN customers ON orders.customer_id = customers.id
         WHERE orders.id = ?`,
      [id],
    );
    if (!data?.length) return;
    const order = data[0];
    window.orderState.selectedCustomerId = order.customer_id;
    $("order-modal-title").innerText = "Chỉnh sửa đơn hàng";
    $("o-customer").value = order.cust_name || "";
    $("o-phone").value = order.cust_phone || "";
    $("o-address").value = order.cust_address || "";
    $("o-date").value = order.delivery_date || "";
    if ($("o-status")) $("o-status").value = order.status || "pending";
    $("o-note").value = order.note || "";
    window.orderState.items = [];
    const parsedItems = order.items_json ? JSON.parse(order.items_json) : [];
    for (const item of parsedItems) {
      const allFillingsForMenuItem = await API.db_query(
        `SELECT r.id, r.name, mf.is_default,
            (CASE WHEN mf.price > 0 THEN mf.price
                  ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id)
            END) * mf.qty AS price
           FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id
           WHERE mf.menu_item_id = ?`,
        [item.menu_id],
      );
      window.orderState.items.push({
        ...item,
        all_fillings: allFillingsForMenuItem,
      });
    }
    window.renderOrderItems();
    modal.classList.add("flex");
  };
  /**
   * Automatically deducts stock from inventory using FIFO logic based on order items.
   * @param {number} orderId
   */
  async function deductInventoryFromOrder(orderId) {
    try {
      await API.db_execute("BEGIN TRANSACTION");
      const [order] = await API.db_query(
        "SELECT items_json FROM orders WHERE id = ?",
        [orderId],
      );
      if (!order || !order.items_json) return;

      const items = JSON.parse(order.items_json);

      for (const item of items) {
        const itemLabel =
          item.filling_name && item.filling_name !== "Không nhân"
            ? `${item.base_name} (${item.filling_name})`
            : item.base_name;

        const ingredientsNeeded = await API.db_query(
          `
          SELECT ri.ingredient_id, (ri.qty * mr.ratio * ? / CAST(r.output AS REAL)) AS total_needed
          FROM menu_recipes mr
          JOIN recipe_ingredients ri ON mr.recipe_id = ri.recipe_id
          JOIN recipes r ON mr.recipe_id = r.id
          WHERE mr.menu_item_id = ?
          UNION ALL
          SELECT ingredient_id, (qty * ?) AS total_needed
          FROM menu_ingredients
          WHERE menu_item_id = ?
          UNION ALL
          SELECT ingredient_id, (qty * ?) AS total_needed
          FROM menu_packaging
          WHERE menu_item_id = ?
        `,
          [
            item.qty,
            item.menu_id,
            item.qty,
            item.menu_id,
            item.qty,
            item.menu_id,
          ],
        );

        if (item.filling_id) {
          const fillingIngs = await API.db_query(
            "SELECT ri.ingredient_id, (ri.qty * ? / CAST(r.output AS REAL)) as total_needed FROM recipe_ingredients ri JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = ?",
            [item.qty, item.filling_id],
          );
          ingredientsNeeded.push(...fillingIngs);
        }

        for (const ing of ingredientsNeeded) {
          let remainingToDeduct = ing.total_needed;

          const batches = await API.db_query(
            `
            SELECT id, qty_remaining
            FROM inventory_batches
            WHERE ingredient_id = ? AND qty_remaining > 0
            ORDER BY expiry_date ASC, import_date ASC
          `,
            [ing.ingredient_id],
          );

          for (const batch of batches) {
            if (remainingToDeduct < 0.0001) break; // Ngưỡng sai số nhỏ để tránh lỗi float

            if (batch.qty_remaining >= remainingToDeduct) {
              await API.db_execute(
                "UPDATE inventory_batches SET qty_remaining = qty_remaining - ? WHERE id = ?",
                [remainingToDeduct, batch.id],
              );
              remainingToDeduct = 0;
            } else {
              remainingToDeduct -= batch.qty_remaining;
              await API.db_execute(
                "UPDATE inventory_batches SET qty_remaining = 0 WHERE id = ?",
                [batch.id],
              );
            }
          }

          if (remainingToDeduct > 0.0001) {
            const [ingInfo] = await API.db_query(
              "SELECT name, unit FROM ingredients WHERE id = ?",
              [ing.ingredient_id],
            );
            throw new Error(
              `Không đủ kho cho món "${itemLabel}": Thiếu ${window.formatNumber(remainingToDeduct)} ${ingInfo.unit} "${ingInfo.name}"`,
            );
          }
        }
      }
      await API.db_execute("COMMIT");
      console.log(`Đã hoàn tất trừ kho cho đơn hàng #${orderId}`);
    } catch (err) {
      console.error("Lỗi khi trừ kho:", err);
      await API.db_execute("ROLLBACK");
      throw err;
    }
  }

  /** Debounced order search */
  window.searchOrders = window.debounce(() => {
    window.orderState.keyword = $("order-search")?.value.trim() || "";
    window.orderState.currentPage = 1;
    window.loadOrders();
  }, 300);

  /** Debounced date filter application */
  window.applyDateFilter = window.debounce(() => {
    window.orderState.currentPage = 1;
    window.loadOrders();
  }, 300);

  /**
   * Handles customer search input and displays an autocomplete dropdown.
   * @returns {Promise<void>}
   */
  window.onCustomerInput = window.debounce(async () => {
    if ($("order-modal")?.getAttribute("data-readonly") === "true") return;

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
        (c) => `
      <div class="dropdown-item" onclick="window.selectCustomerRow(${c.id}, '${c.name.replace(/'/g, "\\'")}', '${(c.phone || "").replace(/'/g, "\\'")}', '${(c.address || "").replace(/'/g, "\\'")}')">
        <b>${c.name}</b> - ${c.phone || "Chưa có SĐT"}
      </div>
    `,
      )
      .join("");
    dropdown.classList.add("show");
  }, 300);

  /**
   * Selects a customer from the dropdown and populates the form.
   * @param {number} id
   * @param {string} name
   * @param {string} phone
   * @param {string} address
   */
  window.selectCustomerRow = (id, name, phone, address) => {
    $("o-customer").value = name;
    $("o-phone").value = phone;
    $("o-address").value = address;
    window.orderState.selectedCustomerId = id;
    $("customer-dropdown").classList.remove("show");
  };
  /**
   * Ẩn dropdown khách hàng khi user click ra ngoài input.
   * Cho phép click vào item trong dropdown trước khi blur (mousedown preventDefault).
   */
  document.addEventListener("DOMContentLoaded", () => {
    const custInput = $("o-customer");
    if (custInput && !$("o-customer").dataset.blurBound) {
      $("o-customer").dataset.blurBound = "1";
      custInput.addEventListener("blur", () => {
        setTimeout(() => $("customer-dropdown")?.classList.remove("show"), 150);
      });
    }
  });

  /** Handles menu item search input for order creation. */
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
              `<div class="dropdown-item" onclick="window.selectMenuPickerItem(${m.id}, '${m.name.replace(/'/g, "\\'")}', ${m.price || 0})">${m.name} - ${window.formatNumber(m.price || 0)}đ</div>`,
          )
          .join("")
      : `<div class="dropdown-item no-match">Không tìm thấy món bánh nào</div>`;
    dropdown.classList.add("show");
  }, 300);

  /**
   * Selects a base menu item and fetches its allowed fillings.
   * @param {number} id
   * @param {string} name
   * @param {number} price
   * @returns {Promise<void>}
   */
  window.selectMenuPickerItem = async (id, name, price) => {
    $("o-menu-search").value = name;
    window.orderState.selectedMenuPicker = { id, name, price };
    $("menu-dropdown").classList.remove("show");

    window.orderState.currentItemFillings = await API.db_query(
      `SELECT r.id, r.name, mf.is_default,
        (CASE WHEN mf.price > 0 THEN mf.price
              ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id)
        END) * mf.qty AS price
       FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id
       WHERE mf.menu_item_id = ?`,
      [id],
    );

    const fillingPicker = $("o-filling-picker");
    if (fillingPicker) {
      let optionsHtml = `<option value="0" data-filling-price="0">Không nhân - 0đ</option>`;

      optionsHtml += window.orderState.currentItemFillings
        .map(
          (f) =>
            `<option value="${f.id}" ${f.is_default ? "selected" : ""} data-filling-price="${f.price}">${f.name} - ${window.formatNumber(f.price)}đ</option>`,
        )
        .join("");

      fillingPicker.innerHTML = optionsHtml;

      const defaultFilling = window.orderState.currentItemFillings.find(
        (f) => f.is_default,
      );
      if (defaultFilling) {
        fillingPicker.value = defaultFilling.id;
      } else {
        fillingPicker.value = "0";
      }
    }
  };

  /** Adds the currently selected menu item and filling to the order "cart". */
  window.addOrderItem = () => {
    const qtyInput = $("o-item-qty");
    const fillingPicker = $("o-filling-picker");
    const qty = parseInt(qtyInput?.value) || 0;

    if (!window.orderState.selectedMenuPicker || qty <= 0)
      return window.showToast?.(
        "Vui lòng chọn bánh từ danh sách gợi ý!",
        "warning",
      );

    let fillingId = 0;
    let fillingName = "Không nhân";
    let fillingPrice = 0;

    if (fillingPicker && fillingPicker.value !== "0") {
      fillingId = parseInt(fillingPicker.value);
      const selectedOption = fillingPicker.options[fillingPicker.selectedIndex];
      fillingName = selectedOption
        ? selectedOption.text.split(" - ")[0].trim()
        : "";
      fillingPrice = parseFloat(selectedOption?.dataset.fillingPrice) || 0;
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
        // Add new item to order cart
        menu_id: baseCake.id,
        base_name: baseCake.name,
        base_price: baseCake.price,
        filling_id: fillingId,
        filling_name: fillingName,
        filling_price: fillingPrice,
        all_fillings: [...window.orderState.currentItemFillings], // Store options for later edit
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

  /**
   * Updates the quantity of a specific item in the order list.
   * @param {number} index
   * @param {number|string} newQty
   */
  window.updateOrderItemQty = (index, newQty) => {
    const qty = parseInt(newQty) || 0;
    if (qty < 0) return;
    const item = window.orderState.items[index];
    item.qty = qty;
    item.subtotal = qty * (item.base_price + item.filling_price);
    window.renderOrderItems();
  };

  /**
   * Updates the filling for a specific item in the order list.
   * @param {number} index
   * @param {number|string} newFillingId
   */
  window.updateOrderItemFilling = (index, newFillingId) => {
    const item = window.orderState.items[index];
    if (!item) return;

    newFillingId = parseInt(newFillingId);
    if (newFillingId === 0) {
      item.filling_id = 0;
      item.filling_name = "Không nhân";
      item.filling_price = 0;
    } else {
      const f = item.all_fillings.find((fill) => fill.id === newFillingId);
      if (f) {
        item.filling_id = f.id;
        item.filling_name = f.name;
        item.filling_price = f.price;
      }
    }
    item.subtotal = item.qty * (item.base_price + item.filling_price);
    window.renderOrderItems();
  };

  /** Removes an item from the order list. */
  window.removeOrderItem = (index) => {
    window.orderState.items.splice(index, 1);
    window.renderOrderItems();
  };

  /** Renders the table rows for items currently added to the order. */
  window.renderOrderItems = () => {
    const isReadOnly =
      $("order-modal")?.getAttribute("data-readonly") === "true";
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
              if (item.all_fillings) {
                fillingSelectHtml += item.all_fillings
                  .map(
                    (f) =>
                      `<option value="${f.id}" ${f.id === item.filling_id ? "selected" : ""}>${f.name} - ${window.formatNumber(f.price)}đ</option>`,
                  )
                  .join("");
              }
              fillingSelectHtml += `</select>`;
            }

            return `
        <tr>
          <td>${item.base_name}</td>
          <td>${fillingSelectHtml}</td>
          <td class="text-right">${window.formatNumber(unitPrice)} đ</td>
          <td class="text-center">
            <input type="number" class="item-qty-input" value="${item.qty}" min="1" oninput="window.updateOrderItemQty(${index}, this.value)" ${isReadOnly ? "disabled" : ""}>
          </td>
          <td class="item-subtotal-text text-right">${window.formatNumber(item.subtotal)} đ</td>
          <td class="text-center">${isReadOnly ? "" : `<button class="btn-delete-row" onclick="window.removeOrderItem(${index})">❌</button>`}</td>
        </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="no-data">Chưa chọn bánh nào</td></tr>`;

    if ($("o-total-amount-display"))
      $("o-total-amount-display").innerText = window.formatNumber(total) + " đ";
  };

  /** Opens the order modal in 'Add' mode. */
  window.openOrderModal = async () => {
    const modal = $("order-modal");
    window.orderState.customersCache = null;
    modal.setAttribute("data-mode", "add");
    modal.removeAttribute("data-editing-id");
    modal.removeAttribute("data-readonly");

    $("order-modal-title").innerText = "Tạo Đơn Hàng Mới";
    const btnCancel = modal.querySelector(".modal-footer .btn-secondary");
    if (btnCancel) {
      btnCancel.innerText = "Đóng";
    }

    [
      "o-customer",
      "o-phone",
      "o-address",
      "o-date",
      "o-note",
      "o-menu-search",
    ].forEach((id) => {
      const el = $(id);
      if (el) {
        el.value = "";
        el.disabled = false;
      }
    });

    $("o-item-qty").value = 1;
    $("o-item-qty").disabled = false;

    if ($("o-status")) {
      $("o-status").value = "pending";
      $("o-status").disabled = true;
    }

    if (document.querySelector(".btn-add-item"))
      document.querySelector(".btn-add-item").disabled = false;
    if ($("btn-save-order")) $("btn-save-order").style.display = "block";

    window.orderState.items = [];
    window.orderState.selectedCustomerId = null;
    window.orderState.selectedMenuPicker = null;
    window.renderOrderItems();

    window.orderState.menuItems = await fetchAvailableMenuItems();
    modal.classList.add("flex");
  };

  /** Closes the order modal and resets dropdowns. */
  window.closeOrderModal = () => {
    $("order-modal").classList.remove("flex");
    $("customer-dropdown").classList.remove("show");
    $("menu-dropdown").classList.remove("show");
  };

  /**
   * Validates and saves the current order (Insert or Update).
   * @returns {Promise<void>}
   */
  window.saveOrder = async () => {
    const modal = $("order-modal");
    if (modal?.getAttribute("data-readonly") === "true") return;

    const customerName = $("o-customer")?.value.trim();
    const date = $("o-date")?.value || null;

    if (!customerName)
      return window.showToast?.("Vui lòng nhập tên khách hàng!", "warning");
    if (!date) {
      window.showToast?.("Vui lòng chọn ngày giao bánh!", "warning");
      return $("o-date")?.focus();
    }
    if (!window.orderState.items.length)
      return window.showToast?.(
        "Vui lòng thêm bánh đặt vào danh sách!",
        "warning",
      );

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
        const params = phone ? [customerName, phone] : [customerName];
        const checkCust = await API.db_query(query, params);

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
        window.showToast?.(
          "Cập nhật thông tin đơn hàng thành công!",
          "success",
        );
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
    } catch (err) {
      console.error("Lỗi chi tiết khi lưu đơn hàng:", err);
      window.showToast?.(
        "Có lỗi xảy ra trong quá trình lưu đơn hàng!",
        "error",
      );
    } finally {
      window.showLoader(false);
    }
  };

  /**
   * Loads an existing order into the modal for viewing or editing.
   * @param {number} id - Order ID.
   * @returns {Promise<void>}
   */
  window.editOrder = async (id) => {
    const modal = $("order-modal");
    modal.setAttribute("data-mode", "edit");
    modal.setAttribute("data-editing-id", id);

    const btnCancel = modal.querySelector(".modal-footer .btn-secondary");
    if (btnCancel) {
      btnCancel.innerText = "Đóng";
    }

    window.orderState.menuItems = await fetchAvailableMenuItems();

    const data = await API.db_query(
      `SELECT orders.*, customers.name AS cust_name, customers.phone AS cust_phone, customers.address AS cust_address FROM orders LEFT JOIN customers ON orders.customer_id = customers.id WHERE orders.id = ?`,
      [id],
    );

    if (data?.length) {
      const order = data[0];
      window.orderState.selectedCustomerId = order.customer_id;

      const isReadOnly =
        order.status === "completed" || order.status === "cancelled";
      modal.toggleAttribute("data-readonly", isReadOnly);
      $("order-modal-title").innerText = isReadOnly
        ? "Chi Tiết Đơn Hàng (Chỉ Xem)"
        : "Cập Nhật Đơn Hàng";

      [
        "o-customer",
        "o-phone",
        "o-address",
        "o-date",
        "o-status",
        "o-note",
        "o-menu-search",
        "o-item-qty",
      ].forEach((elId) => {
        if ($(elId)) $(elId).disabled = isReadOnly;
      });

      if (document.querySelector(".btn-add-item"))
        document.querySelector(".btn-add-item").disabled = isReadOnly;
      if ($("btn-save-order"))
        $("btn-save-order").style.display = isReadOnly ? "none" : "block";

      $("o-customer").value = order.cust_name || "";
      $("o-phone").value = order.cust_phone || "";
      $("o-address").value = order.cust_address || "";
      $("o-date").value = order.delivery_date || "";
      $("o-status").value = order.status || "pending";
      $("o-note").value = order.note || "";

      window.orderState.items = [];
      const parsedItems = order.items_json ? JSON.parse(order.items_json) : [];

      for (const item of parsedItems) {
        const allFillingsForMenuItem = await API.db_query(
          `SELECT r.id, r.name, mf.is_default,
            (CASE WHEN mf.price > 0 THEN mf.price
                  ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id)
            END) * mf.qty AS price
           FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id
           WHERE mf.menu_item_id = ?`,
          [item.menu_id],
        );

        window.orderState.items.push({
          ...item,
          all_fillings: allFillingsForMenuItem,
        });
      }
      window.renderOrderItems();
      modal.classList.add("flex");
    }
  };
})();
