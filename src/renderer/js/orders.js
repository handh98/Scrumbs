(function () {
  const itemsPerPage = 6;
  const API = window.electronAPI;

  // Khởi tạo Global States với Nullish coalescing
  window.currentPageOrder ??= 1;
  window.orderKeyword ??= "";
  window.currentOrderItems ??= [];
  window.availableMenuItems ??= [];
  window.selectedCustomerId ??= null;
  window.selectedMenuPickerItem ??= null;
  window.currentItemFillings ??= [];
  window.allCustomersCache ??= null;

  // Helper load menu items để dùng chung cho cả Add và Edit
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

  window.loadOrders = async () => {
    window.toggleLoader(true);
    try {
      const tbody = $("order-list-body");
      const paginationContainer = $("order-pagination");
      if (!tbody) return;

      // Đồng bộ keyword từ UI
      const searchInput = $("order-search");
      if (searchInput) {
        window.orderKeyword = searchInput.value.trim();
      }

      const statusFilter = $("filter-status")?.value || "all";
      const dateSort = $("sort-delivery-date")?.value || "desc";
      const kw = window.orderKeyword ? `%${window.orderKeyword}%` : null;

      let whereClause = "";
      let params = [];

      if (statusFilter !== "all") {
        whereClause += " WHERE orders.status = ?";
        params.push(statusFilter);
      }
      if (kw) {
        // Sử dụng bảng FTS để tìm ID khách hàng trước, sau đó JOIN
        whereClause +=
          (whereClause ? " AND" : " WHERE") +
          " orders.customer_id IN (SELECT rowid FROM customers_fts WHERE customers_fts MATCH ?)";

        // 🌟 CẢI TIẾN: Khử dấu từ khóa trước khi MATCH
        const cleanKeyword = window.removeAccents(window.orderKeyword);
        const tokens = cleanKeyword.split(/\s+/).filter(Boolean);
        const searchQuery = tokens
          .map((t) => `${t.replace(/"/g, '""')}*`)
          .join(" ");
        params.push(searchQuery);
      }

      // 1. Lấy tổng số lượng bản ghi sau khi lọc để tính toán số trang
      const countRes = await API.db_query(
        `SELECT COUNT(*) as total FROM orders LEFT JOIN customers ON orders.customer_id = customers.id ${whereClause}`,
        params,
      );
      const totalItems = countRes[0].total;
      const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

      if (window.currentPageOrder > totalPages)
        window.currentPageOrder = totalPages;

      // 2. Lấy dữ liệu của trang hiện tại bằng LIMIT và OFFSET
      const offset = (window.currentPageOrder - 1) * itemsPerPage;
      const query = `
        SELECT orders.*, customers.name AS cust_name, customers.phone AS cust_phone 
        FROM orders 
        LEFT JOIN customers ON orders.customer_id = customers.id 
        ${whereClause} 
        ORDER BY orders.delivery_date ${dateSort.toUpperCase()}, orders.id DESC 
        LIMIT ? OFFSET ?`;

      const data = await API.db_query(query, [...params, itemsPerPage, offset]);

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="no-data">Không tìm thấy đơn hàng nào khớp với bộ lọc.</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      // Tạo HTML phân trang (Sử dụng dummy array để getPagination tính toán số trang dựa trên totalItems)
      const pagingResult = window.getPagination(
        new Array(totalItems),
        itemsPerPage,
        window.currentPageOrder,
        (newPage) => {
          window.currentPageOrder = newPage;
          window.loadOrders();
        },
      );

      tbody.innerHTML = data
        .map((item) => {
          const isFinal =
            item.status === "completed" || item.status === "cancelled";
          const statusHtml = isFinal
            ? `<span class="badge-${item.status}">${item.status === "completed" ? "Hoàn thành" : "Đã hủy"}</span>`
            : `<select class="quick-status-select status-${item.status}" onchange="window.updateOrderStatusQuick(${item.id}, this.value)">
              <option value="pending" ${item.status === "pending" ? "selected" : ""}>Chờ xử lý</option>
              <option value="processing" ${item.status === "processing" ? "selected" : ""}>Đang làm</option>
              <option value="completed">Hoàn thành</option>
              <option value="cancelled">Đã hủy</option>
            </select>`;

          const note = item.note?.trim() || "...";

          return `
          <tr>
            <td class="text-center"><b>#${item.id}</b></td>
            <td><b>${item.cust_name || "N/A"}</b><br><span>${item.cust_phone || ""}</span></td>
            <td class="text-center">${item.delivery_date || "--"}</td>
            <td class="text-center">${statusHtml}</td>
            <td class="order-total-cell text-center">${window.formatNumber(item.total_amount || 0)} đ</td>
            <td class="text-center note-column has-tooltip" data-note="${note}">${note}</td>
            <td class="text-center action-column">
              <button class="btn-secondary ${isFinal ? "btn-view" : "btn-edit"}" title="${isFinal ? "Xem chi tiết" : "Sửa"}" onclick="window.editOrder(${item.id})">
                <img src="src/renderer/assets/${isFinal ? "view.svg" : "edit.svg"}" class="icon" onerror="this.src='src/renderer/assets/edit.svg'" />
              </button>
              ${!isFinal ? `<button class="btn-secondary btn-delete" title="Hủy" onclick="window.cancelOrder(${item.id})"><img src="src/renderer/assets/trash.svg" class="icon" /></button>` : ""}
            </td>
          </tr>`;
        })
        .join("");

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;
      window.TooltipComponent?.init();
    } catch (error) {
      console.error("Lỗi nạp đơn hàng:", error);
    } finally {
      window.toggleLoader(false);
    }
  };

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

      // Nếu chuyển sang Hoàn thành, thực hiện trừ kho tự động
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

  /**
   * Logic Trừ Kho Tự Động (FIFO - First In First Out)
   * Dựa trên công thức và nguyên liệu trực tiếp trong Menu
   */
  async function deductInventoryFromOrder(orderId) {
    try {
      await API.db_execute("BEGIN TRANSACTION"); // Bắt đầu Transaction
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

        // Trừ kho vỏ bánh + bao bì + topping
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

        // Trừ thêm nguyên liệu của Nhân nếu có chọn
        if (item.filling_id) {
          const fillingIngs = await API.db_query(
            "SELECT ri.ingredient_id, (ri.qty * ? / CAST(r.output AS REAL)) as total_needed FROM recipe_ingredients ri JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = ?",
            // item.qty là số lượng bánh, cần chia cho định mức của công thức nhân
            [item.qty, item.filling_id],
          );
          ingredientsNeeded.push(...fillingIngs);
        }

        for (const ing of ingredientsNeeded) {
          let remainingToDeduct = ing.total_needed;

          // 2. Tìm các lô hàng còn tồn của nguyên liệu này, ưu tiên lô hết hạn trước (FIFO)
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
            if (remainingToDeduct <= 0) break;

            if (batch.qty_remaining >= remainingToDeduct) {
              // Lô này đủ trừ
              await API.db_execute(
                "UPDATE inventory_batches SET qty_remaining = qty_remaining - ? WHERE id = ?",
                [remainingToDeduct, batch.id],
              );
              remainingToDeduct = 0;
            } else {
              // Lô này không đủ, trừ hết lô này rồi chuyển sang lô tiếp theo
              remainingToDeduct -= batch.qty_remaining;
              await API.db_execute(
                "UPDATE inventory_batches SET qty_remaining = 0 WHERE id = ?",
                [batch.id],
              );
            }
          }

          if (remainingToDeduct > 0) {
            // Lấy tên nguyên liệu để thông báo lỗi rõ ràng
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
      await API.db_execute("COMMIT"); // Xác nhận Transaction nếu mọi thứ thành công
      console.log(`Đã hoàn tất trừ kho cho đơn hàng #${orderId}`);
    } catch (err) {
      console.error("Lỗi khi trừ kho:", err);
      await API.db_execute("ROLLBACK"); // Hủy bỏ Transaction nếu có lỗi
      throw err; // Ném lỗi để hàm gọi biết và xử lý (ví dụ: hiển thị thông báo)
    }
  }

  window.searchOrders = window.debounce(() => {
    window.orderKeyword = $("order-search")?.value.trim() || "";
    window.currentPageOrder = 1;
    window.loadOrders();
  }, 300);

  // Autocomplete Customers
  window.onCustomerInput = window.debounce(async () => {
    if ($("order-modal")?.getAttribute("data-readonly") === "true") return;

    const txt = $("o-customer")?.value.trim() || "";
    const dropdown = $("customer-dropdown");
    window.selectedCustomerId = null;

    if (!txt) return dropdown.classList.remove("show");

    if (!window.allCustomersCache) {
      const raw = await API.db_query(
        "SELECT * FROM customers WHERE is_active = 1",
      );
      raw.forEach((c) => (c._normalizedName = window.removeAccents(c.name)));
      window.allCustomersCache = raw;
    }

    const normalizedTxt = window.removeAccents(txt);
    const customers = window.allCustomersCache
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

  window.selectCustomerRow = (id, name, phone, address) => {
    $("o-customer").value = name;
    $("o-phone").value = phone;
    $("o-address").value = address;
    window.selectedCustomerId = id;
    $("customer-dropdown").classList.remove("show");
  };

  // Autocomplete Menu
  window.onMenuSearchInput = window.debounce(() => {
    const txt = $("o-menu-search")?.value.trim() || "";
    const normalizedTxt = window.removeAccents(txt);
    const dropdown = $("menu-dropdown");
    const filtered = window.availableMenuItems.filter((m) =>
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

  window.selectMenuPickerItem = async (id, name, price) => {
    $("o-menu-search").value = name;
    window.selectedMenuPickerItem = { id, name, price };
    $("menu-dropdown").classList.remove("show");

    // Load danh sách nhân cho phép của bánh này
    window.currentItemFillings = await API.db_query(
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
      // Thêm tùy chọn "Không nhân" với giá 0
      let optionsHtml = `<option value="0" data-filling-price="0">Không nhân - 0đ</option>`;

      // Thêm các nhân bánh có sẵn
      optionsHtml += window.currentItemFillings
        .map(
          (f) =>
            `<option value="${f.id}" ${f.is_default ? "selected" : ""} data-filling-price="${f.price}">${f.name} - ${window.formatNumber(f.price)}đ</option>`,
        )
        .join("");

      fillingPicker.innerHTML = optionsHtml;

      // Đặt giá trị mặc định cho select box
      const defaultFilling = window.currentItemFillings.find(
        (f) => f.is_default,
      );
      if (defaultFilling) {
        fillingPicker.value = defaultFilling.id;
      } else {
        fillingPicker.value = "0"; // Mặc định chọn "Không nhân"
      }
    }
  };

  // Cart Management - Thêm món vào giỏ hàng
  window.addOrderItem = () => {
    const qtyInput = $("o-item-qty");
    const fillingPicker = $("o-filling-picker");
    const qty = parseInt(qtyInput?.value) || 0;

    if (!window.selectedMenuPickerItem || qty <= 0)
      return window.showToast?.(
        "Vui lòng chọn bánh từ danh sách gợi ý!",
        "warning",
      );

    let fillingId = 0; // Sử dụng 0 cho "Không nhân"
    let fillingName = "Không nhân";
    let fillingPrice = 0;

    if (fillingPicker && fillingPicker.value !== "0") {
      fillingId = parseInt(fillingPicker.value);
      const selectedOption = fillingPicker.options[fillingPicker.selectedIndex];
      // Lấy tên nhân (phần trước dấu ' - ')
      fillingName = selectedOption
        ? selectedOption.text.split(" - ")[0].trim()
        : "";
      // Lấy giá nhân từ data attribute
      fillingPrice = parseFloat(selectedOption?.dataset.fillingPrice) || 0;
    }

    const baseCake = window.selectedMenuPickerItem;

    // Phân biệt bánh theo ID bánh + ID nhân để gộp số lượng
    const existing = window.currentOrderItems.find(
      (i) => i.menu_id === baseCake.id && i.filling_id === fillingId,
    );

    if (existing) {
      existing.qty += qty;
      existing.subtotal =
        existing.qty * (existing.base_price + existing.filling_price);
    } else {
      window.currentOrderItems.push({
        menu_id: baseCake.id,
        base_name: baseCake.name,
        base_price: baseCake.price,
        filling_id: fillingId,
        filling_name: fillingName,
        filling_price: fillingPrice,
        all_fillings: [...window.currentItemFillings],
        qty,
        subtotal: qty * (baseCake.price + fillingPrice),
      });
    }

    $("o-menu-search").value = "";
    if (fillingPicker)
      fillingPicker.innerHTML = '<option value="0">Không nhân - 0đ</option>';
    qtyInput.value = 1;
    window.selectedMenuPickerItem = null;
    window.renderOrderItems();
  };

  window.updateOrderItemQty = (index, newQty) => {
    const qty = parseInt(newQty) || 0;
    if (qty < 0) return;
    const item = window.currentOrderItems[index];
    item.qty = qty;
    item.subtotal = qty * (item.base_price + item.filling_price);
    window.renderOrderItems();
  };

  window.updateOrderItemFilling = (index, newFillingId) => {
    const item = window.currentOrderItems[index];
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

  window.removeOrderItem = (index) => {
    window.currentOrderItems.splice(index, 1);
    window.renderOrderItems();
  };

  window.renderOrderItems = () => {
    const isReadOnly =
      $("order-modal")?.getAttribute("data-readonly") === "true";
    const thDel = document.querySelector(".modal-col-del"); // Standard querySelector is fine for specific semantic tags
    if (thDel) thDel.innerText = isReadOnly ? "" : "Xóa";

    const total = window.currentOrderItems.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );

    $("order-items-body").innerHTML = window.currentOrderItems.length
      ? window.currentOrderItems
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

  // Modal Actions
  window.openOrderModal = async () => {
    const modal = $("order-modal");
    window.allCustomersCache = null; // Ensure fresh data on open
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

    window.currentOrderItems = [];
    window.selectedCustomerId = null;
    window.selectedMenuPickerItem = null;
    window.renderOrderItems();

    window.availableMenuItems = await fetchAvailableMenuItems();
    modal.style.display = "flex";
  };

  window.closeOrderModal = () => {
    $("order-modal").style.display = "none";
    $("customer-dropdown").classList.remove("show");
    $("menu-dropdown").classList.remove("show");
  };

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
    if (!window.currentOrderItems.length)
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

    const itemsJson = JSON.stringify(window.currentOrderItems);
    const totalAmount = window.currentOrderItems.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    ); // totalAmount đã được tính toán chính xác

    window.toggleLoader(true);
    try {
      window.allCustomersCache = null; // Invalidate cache
      let custId = window.selectedCustomerId;

      // Chuẩn bị dữ liệu món hàng để lưu vào DB (loại bỏ all_fillings vì không cần lưu)
      const itemsToSave = window.currentOrderItems.map((item) => {
        const { all_fillings, ...rest } = item;
        return rest;
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
            JSON.stringify(itemsToSave), // Lưu cấu trúc mới
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
          ], // Lưu cấu trúc mới
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
      window.toggleLoader(false);
    }
  };

  window.editOrder = async (id) => {
    const modal = $("order-modal");
    modal.setAttribute("data-mode", "edit");
    modal.setAttribute("data-editing-id", id);

    const btnCancel = modal.querySelector(".modal-footer .btn-secondary");
    if (btnCancel) {
      btnCancel.innerText = "Đóng";
    }

    window.availableMenuItems = await fetchAvailableMenuItems();

    const data = await API.db_query(
      `SELECT orders.*, customers.name AS cust_name, customers.phone AS cust_phone, customers.address AS cust_address FROM orders LEFT JOIN customers ON orders.customer_id = customers.id WHERE orders.id = ?`,
      [id],
    );

    if (data?.length) {
      const order = data[0];
      window.selectedCustomerId = order.customer_id;

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

      window.currentOrderItems = []; // Reset để sử dụng cấu trúc mới
      const parsedItems = order.items_json ? JSON.parse(order.items_json) : [];

      for (const item of parsedItems) {
        // Lấy tất cả nhân cho menu_id này để điền vào select box
        const allFillingsForMenuItem = await API.db_query(
          `SELECT r.id, r.name, mf.is_default, 
            (CASE WHEN mf.price > 0 THEN mf.price 
                  ELSE (SELECT CEIL(SUM(ri.qty * i.unit_price) / MAX(1.0, CAST(r.output AS REAL)) / 100.0) * 100 FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = mf.recipe_id)
            END) * mf.qty AS price
           FROM menu_fillings mf JOIN recipes r ON mf.recipe_id = r.id
           WHERE mf.menu_item_id = ?`,
          [item.menu_id],
        );

        window.currentOrderItems.push({
          ...item, // Sao chép các thuộc tính hiện có (menu_id, base_name, base_price, filling_id, filling_name, filling_price, qty, subtotal)
          all_fillings: allFillingsForMenuItem, // Thêm tất cả nhân có thể chọn
        });
      }
      window.renderOrderItems();
      modal.style.display = "flex";
    }
  };
})();
