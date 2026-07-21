(function () {
  "use strict";

  /**
   * @typedef {Object} ElectronAPI
   * @property {Function} db_query - Thực hiện truy vấn dữ liệu
   */
  const API = window.electronAPI;

  window.loadDashboard = async () => {
    await window.showLoader(true);
    try {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      const currentMonthPattern = todayStr.substring(0, 7) + "%";

      const results = await Promise.allSettled([
        renderKPICards(currentMonthPattern, todayStr),
        renderUrgentOrders(todayStr, tomorrowStr),
        renderOrderShortages(),
        renderRevenueChart(todayStr),
        renderTopCakes(),
        renderStickyNotes(),
      ]);

      const failedIndex = results.findIndex((r) => r.status === "rejected");
      if (failedIndex >= 0) {
        const error = results[failedIndex].reason;
        console.error(`Widget #${failedIndex} failed:`, error);
      }
    } catch (error) {
      console.error("Lỗi đồng bộ dữ liệu Dashboard:", error);
      if (typeof window.showToast === "function") {
        window.showToast(
          `Lỗi tải Dashboard: ${error.message || "Không xác định"}`,
          "error",
        );
      }
    } finally {
      window.showLoader(false);
    }
  };

  async function renderKPICards(monthPattern, todayStr) {
    try {
      const [revRes, todayRes, procRes] = await Promise.all([
        API.db_query(
          "SELECT SUM(total_amount) AS total FROM orders WHERE status = 'completed' AND delivery_date LIKE ?",
          [monthPattern],
        ).catch(() => [{ total: 0 }]),
        API.db_query(
          "SELECT COUNT(*) AS total FROM orders WHERE delivery_date = ? AND status != 'cancelled'",
          [todayStr],
        ).catch(() => [{ total: 0 }]),
        API.db_query(
          "SELECT COUNT(*) AS total FROM orders WHERE status IN ('pending', 'processing')",
        ).catch(() => [{ total: 0 }]),
      ]);

      const revenue = revRes?.[0]?.total || 0;
      const kpiRevenue = $("kpi-revenue");
      const kpiToday = $("kpi-today");
      const kpiProcessing = $("kpi-processing");

      if (kpiRevenue)
        kpiRevenue.innerText = window.formatNumber(revenue) + " đ";
      if (kpiToday) kpiToday.innerText = (todayRes?.[0]?.total || 0) + " đơn";
      if (kpiProcessing)
        kpiProcessing.innerText = (procRes?.[0]?.total || 0) + " đơn";
    } catch (err) {
      console.error("Lỗi tính toán KPI:", err);
      throw err;
    }
  }

  // 2. LỊCH GIAO BÁNH KHẨN CẤP
  async function renderUrgentOrders(todayStr, tomorrowStr) {
    const tbody = $("urgent-orders-body");
    if (!tbody) return;

    try {
      const sql = `
        SELECT o.*, c.name AS cust_name, c.phone AS cust_phone
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.delivery_date IN (?, ?) AND o.status != 'cancelled'
        ORDER BY o.delivery_date ASC, o.id DESC
      `;
      const orders = await API.db_query(sql, [todayStr, tomorrowStr]);

      if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center no-data">✨ Thảnh thơi! Hôm nay và ngày mai chưa có đơn bánh nào cần giao.</td></tr>`;
        return;
      }

      tbody.innerHTML = orders
        .map((order) => {
          let itemsHtml = `<span class="text-muted">Lỗi dữ liệu bánh</span>`;
          try {
            const items = order.items_json ? JSON.parse(order.items_json) : [];
            itemsHtml = items
              .map((i) => `<span>${i.base_name} x${i.qty}</span>`)
              .join("");
          } catch (err) {
            console.error("Lỗi parse items_json:", err);
          }

          const isToday = order.delivery_date === todayStr;
          const dateLabel = isToday ? "🔴 Hôm nay" : "🟡 Ngày mai";

          const statusSelector =
            order.status === "completed" || order.status === "cancelled"
              ? `<span class="badge-${order.status}">${order.status === "completed" ? "Hoàn thành" : "Đã hủy"}</span>`
              : `
          <select class="status-quick-select status-${order.status}" onchange="window.updateDashboardOrderStatus(${order.id}, this.value)">
            <option value="pending" ${order.status === "pending" ? "selected" : ""}>Chờ xử lý</option>
            <option value="processing" ${order.status === "processing" ? "selected" : ""}>Đang làm</option>
            <option value="completed">Hoàn thành</option>
          </select>`;

          return `
          <tr>
            <td class="text-center"><b>#${order.id}</b></td>
            <td class="text-center"><b>${order.cust_name || "Khách vãng lai"}</b><br><small>${order.cust_phone || ""}</small></td>
            <td class="text-center">${itemsHtml}</td>
            <td class="text-center"><b>${dateLabel}</b><br><small>${order.delivery_date}</small></td>
            <td class="text-center">${statusSelector}</td>
          </tr>
        `;
        })
        .join("");
    } catch (err) {
      console.error("Lỗi tải đơn khẩn cấp:", err);
    }
  }

  window.updateDashboardOrderStatus = async (id, newStatus) => {
    let oldStatus = "pending";
    try {
      const orderCheck = await API.db_query(
        "SELECT status FROM orders WHERE id = ?",
        [id],
      );
      if (orderCheck && orderCheck.length > 0) {
        oldStatus = orderCheck[0].status;
      }
    } catch (err) {
      console.error("Không lấy được trạng thái cũ:", err);
    }

    if (oldStatus === newStatus) return; // Nếu không đổi gì thì thoát

    try {
      // 1. Xác nhận thay đổi
      if (newStatus === "completed" || newStatus === "cancelled") {
        const confirmMsg =
          newStatus === "cancelled"
            ? `Xác nhận HỦY đơn hàng #${id}? Kho sẽ được hoàn trả (nếu đã trừ).`
            : `Chốt đơn #${id} thành công? Đơn sẽ khóa chỉnh sửa.`;

        if (typeof window.showConfirm === "function") {
          const ok = await window.showConfirm(
            "Xác nhận trạng thái",
            confirmMsg,
          );
          if (!ok) {
            window.loadDashboard(); // Reset UI (Đưa dropdown về trạng thái cũ)
            return;
          }
        }
      } else if (newStatus === "processing") {
        const ok = await window.showConfirm(
          "Bắt đầu làm bánh",
          `Đơn #${id} sẽ được mang đi làm. KHO SẼ BỊ TRỪ NGAY LẬP TỨC. Tiếp tục?`,
        );
        if (!ok) {
          window.loadDashboard();
          return;
        }
      }

      await window.showLoader(true);

      // 2. Kích hoạt logic Trừ/Hoàn kho dùng chung
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
        await window.restoreInventoryFromOrder(id, "từ màn hình Tổng quan");
      }

      // 3. Cập nhật trạng thái đơn hàng trong DB
      await API.db_run("UPDATE orders SET status = ? WHERE id = ?", [
        newStatus,
        id,
      ]);

      await window.showLoader(false);
      window.loadDashboard();
    } catch (err) {
      console.error("Lỗi cập nhật trạng thái:", err);
      await window.showLoader(false);
      window.loadDashboard();
    }
  };

  // 3. PHÂN TÍCH NGUYÊN LIỆU THIẾU CHO CÁC ĐƠN ĐANG ĐẶT
  async function renderOrderShortages() {
    const body = $("low-stock-body");
    if (!body) return;

    body.innerHTML =
      '<div class="text-center no-data">Đang phân tích đơn hàng...</div>';

    try {
      // 1. Lấy tất cả đơn hàng đang hoạt động (Chờ xử lý & Đang làm)
      const orders = await API.db_query(
        "SELECT items_json FROM orders WHERE status IN ('pending', 'processing')",
      );

      if (!orders || orders.length === 0) {
        body.innerHTML = `<div class="text-center py-md" style="color: var(--status-success-text);">✅ Đủ nguyên liệu cho các đơn hàng hiện tại.</div>`;
        return;
      }

      const menuNeeds = {}; // { menu_id: totalQty }
      const fillingNeeds = {}; // { recipe_id: totalQty }

      // 2. Gom nhóm số lượng bánh theo loại //
      orders.forEach((o) => {
        try {
          const items = JSON.parse(o.items_json || "[]");
          items.forEach((item) => {
            menuNeeds[item.menu_id] = (menuNeeds[item.menu_id] || 0) + item.qty;
            if (item.filling_id && item.filling_id !== 0) {
              fillingNeeds[item.filling_id] =
                (fillingNeeds[item.filling_id] || 0) + item.qty;
            }
          });
        } catch (err) {
          console.error("Lỗi parse items_json trong shortages:", err);
        }
      });

      const requirements = {}; // { ingredient_id: { qtyNeeded, name, unit } }

      // 3. Truy vấn định mức nguyên liệu (Recipes, Packaging, Raw Materials)
      const menuIds = Object.keys(menuNeeds);
      if (menuIds.length) {
        const needs = await API.db_query(`
          SELECT mr.menu_item_id, ri.ingredient_id, i.name, i.unit, (ri.qty * mr.ratio / CAST(r.output AS REAL)) as unit_needed
          FROM menu_recipes mr
          JOIN recipe_ingredients ri ON mr.recipe_id = ri.recipe_id
          JOIN recipes r ON mr.recipe_id = r.id
          JOIN ingredients i ON ri.ingredient_id = i.id
          WHERE mr.menu_item_id IN (${menuIds.join(",")})
          UNION ALL
          SELECT mi.menu_item_id, mi.ingredient_id, i.name, i.unit, mi.qty as unit_needed
          FROM menu_ingredients mi
          JOIN ingredients i ON mi.ingredient_id = i.id
          WHERE mi.menu_item_id IN (${menuIds.join(",")})
          UNION ALL
          SELECT mp.menu_item_id, mp.ingredient_id, i.name, i.unit, mp.qty as unit_needed
          FROM menu_packaging mp
          JOIN ingredients i ON mp.ingredient_id = i.id
          WHERE mp.menu_item_id IN (${menuIds.join(",")})
        `);

        needs.forEach((n) => {
          if (!requirements[n.ingredient_id]) {
            requirements[n.ingredient_id] = {
              qty: 0,
              name: n.name,
              unit: n.unit,
            };
          }
          requirements[n.ingredient_id].qty +=
            n.unit_needed * menuNeeds[n.menu_item_id];
        });
      }

      // Định mức cho nhân bánh
      const fillingIds = Object.keys(fillingNeeds);
      if (fillingIds.length) {
        const needs = await API.db_query(`
          SELECT ri.recipe_id, ri.ingredient_id, i.name, i.unit, (ri.qty / CAST(r.output AS REAL)) as unit_needed
          FROM recipe_ingredients ri
          JOIN recipes r ON ri.recipe_id = r.id
          JOIN ingredients i ON ri.ingredient_id = i.id
          WHERE ri.recipe_id IN (${fillingIds.join(",")})
        `);
        needs.forEach((n) => {
          if (!requirements[n.ingredient_id]) {
            requirements[n.ingredient_id] = {
              qty: 0,
              name: n.name,
              unit: n.unit,
            };
          }
          requirements[n.ingredient_id].qty +=
            n.unit_needed * fillingNeeds[n.recipe_id];
        });
      }

      // 4. Lấy tồn kho hiện tại
      const stockRes = await API.db_query(`
        SELECT ingredient_id, SUM(qty_remaining) as total_stock
        FROM inventory_batches
        WHERE qty_remaining > 0
        GROUP BY ingredient_id
      `);
      const stockMap = stockRes.reduce((acc, s) => {
        acc[s.ingredient_id] = s.total_stock;
        return acc;
      }, {});

      // 5. So sánh nhu cầu và tồn kho
      const shortages = Object.entries(requirements)
        .map(([id, data]) => ({
          ...data,
          shortage: data.qty - (stockMap[id] || 0),
        }))
        .filter((s) => s.shortage > 0.001); // Ngưỡng sai số float nhỏ

      if (!shortages.length) {
        body.innerHTML = `<div class="text-center py-md" style="color: var(--status-success-text);">✅ Đủ nguyên liệu cho các đơn hàng hiện tại.</div>`;
      } else {
        body.innerHTML = shortages
          .map(
            (s) => `
            <div class="low-stock-item">
              <span class="low-stock-name">⚠️ ${s.name}</span>
              <span class="low-stock-badge" style="background-color: #f8d7da; color: #721c24;">Thiếu: ${window.formatNumber(s.shortage)} ${s.unit}</span>
            </div>
          `,
          )
          .join("");
      }
    } catch (err) {
      console.error("Lỗi phân tích thiếu hụt:", err);
      body.innerHTML = `<div class="text-center no-data" style="color: #e53e3e;">Lỗi dữ liệu kho hàng!</div>`;
    }
  }

  // 4. BIỂU ĐỒ DOANH THU 7 NGÀY GẦN NHẤT
  async function renderRevenueChart() {
    const container = $("chart-revenue-container");
    if (!container) return;

    try {
      // Dùng Array.from để tạo list 7 ngày sạch sẽ thay cho For-loop truyền thống
      const dateList = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split("T")[0];
      });

      const sql = `
        SELECT delivery_date, SUM(total_amount) AS daily_total
        FROM orders
        WHERE status = 'completed' AND delivery_date BETWEEN ? AND ?
        GROUP BY delivery_date
      `;
      const rows = await API.db_query(sql, [dateList[0], dateList[6]]);

      // Chuyển Rows thành dạng Hash Map để truy xuất nhanh O(1)
      const revMap = rows.reduce((acc, row) => {
        acc[row.delivery_date] = row.daily_total;
        return acc;
      }, {});

      const maxRevenue = Math.max(
        ...dateList.map((date) => revMap[date] || 0),
        100000,
      );

      container.innerHTML = dateList
        .map((date) => {
          const amount = revMap[date] || 0;
          const heightPercent = (amount / maxRevenue) * 100;
          const [, month, day] = date.split("-"); // Destructuring mảng cắt chuỗi

          return `
        <div class="chart-column">
          <span class="chart-amount-tooltip">${amount > 0 ? (amount / 1000).toFixed(0) + "k" : "0"}</span>
          <div class="chart-bar-wrapper">
            <div class="chart-bar-fill" style="height: ${heightPercent}%;" title="Ngày ${date}: ${window.formatNumber(amount)} đ"></div>
          </div>
          <span class="chart-date-label">${day}/${month}</span>
        </div>
        `;
        })
        .join("");
    } catch (error) {
      console.error("Lỗi kết xuất biểu đồ:", error);
    }
  }

  // 5. TOP 5 LOẠI BÁNH BÁN CHẠY NHẤT
  async function renderTopCakes() {
    const container = $("chart-top-cakes-container");
    if (!container) return;

    try {
      const rows = await API.db_query(
        "SELECT items_json FROM orders WHERE status = 'completed'",
      );
      const cakeSales = {};

      rows.forEach((row) => {
        try {
          const items = row.items_json ? JSON.parse(row.items_json) : [];
          for (const item of items) {
            cakeSales[item.name] = (cakeSales[item.name] || 0) + item.qty;
          }
        } catch (err) {
          console.error("Lỗi parse items_json trong top cakes:", err);
        }
      });

      // Rút gọn logic Sort bằng Object.entries
      const sortedCakes = Object.entries(cakeSales)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

      if (sortedCakes.length === 0) {
        container.innerHTML = `<div class="no-data">Chưa có dữ liệu thống kê món bánh.</div>`;
        return;
      }

      const maxQty = sortedCakes[0].qty;

      container.innerHTML = sortedCakes
        .map((cake) => {
          const widthPercent = (cake.qty / maxQty) * 100;
          return `
        <div class="top-cake-row">
          <div class="top-cake-info">
            <span class="top-cake-name">🍰 ${cake.name}</span>
            <span class="top-cake-qty"><b>${cake.qty}</b> cái</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${widthPercent}%;"></div>
          </div>
        </div>
        `;
        })
        .join("");
    } catch (error) {
      console.error("Lỗi kết xuất top bánh:", error);
    }
  }

  // 6. QUẢN LÝ GHI CHÚ NHANH (STICKY NOTES)
  async function renderStickyNotes() {
    const container = $("sticky-notes-section");
    if (!container) return;

    try {
      const notes = await API.getStickyNotes();

      let notesHtml = `
        <div class="sticky-notes-grid">
          <div class="sticky-note add-note-card" onclick="window.addNewStickyNote()">
            <div class="add-icon">
              <img src="src/renderer/assets/add-plus.svg" alt="Add" />
            </div>
            <p>Thêm ghi chú</p>
          </div>
      `;

      notesHtml += notes
        .map((note, index) => {
          // Xử lý chuỗi an toàn để đưa vào thuộc tính onclick
          const safeContent = note.content
            .replace(/\\/g, "\\\\")
            .replace(/`/g, "\\`")
            .replace(/\$/g, "\\$");

          return `
            <div class="sticky-note note-tilt-${(index % 3) + 1}"
                 style="background-color: ${note.color || "#fff9c4"}"
                 onclick="window.editStickyNote(${note.id}, \`${safeContent}\`)">
              <button class="delete-note-btn" onclick="window.deleteStickyNote(${note.id}, event)" title="Xóa ghi chú">×</button>
              <div class="note-content">${note.content.replace(/\n/g, "<br>")}</div>
              <div class="note-date">${new Date(note.created_at).toLocaleDateString("vi-VN")}</div>
            </div>
          `;
        })
        .join("");

      notesHtml += `</div>`;
      container.innerHTML = notesHtml;
    } catch (err) {
      console.error("Lỗi tải ghi chú:", err);
    }
  }

  window.addNewStickyNote = async () => {
    if (typeof window.showPrompt === "function") {
      const content = await window.showPrompt(
        "Ghi chú mới", // Title
        "Bạn muốn ghi chú điều gì?",
        "",
      );
      if (content && content.trim()) await saveNote(content.trim());
    }
  };

  window.editStickyNote = async (id, oldContent) => {
    if (typeof window.showPrompt !== "function") {
      console.error("Lỗi: window.showPrompt chưa được định nghĩa.");
      return;
    }
    const newContent = await window.showPrompt(
      "Sửa ghi chú",
      "Cập nhật nội dung ghi chú:",
      oldContent,
    );
    if (
      newContent !== null &&
      newContent.trim() !== "" &&
      newContent !== oldContent
    ) {
      try {
        await API.updateStickyNote({ id, content: newContent.trim() });
        renderStickyNotes();
      } catch (err) {
        console.error("Lỗi cập nhật ghi chú:", err);
      }
    }
  };

  async function saveNote(content) {
    const colors = [
      "#fff9c4",
      "#ffecb3",
      "#d1c4e9",
      "#c8e6c9",
      "#bbdefb",
      "#f8bbd0",
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    try {
      await API.saveStickyNote({ content, color: randomColor });
      renderStickyNotes();
    } catch (err) {
      console.error("Lỗi lưu ghi chú:", err);
    }
  }

  window.deleteStickyNote = async (id, event) => {
    try {
      if (event) event.stopPropagation(); // Ngăn chặn việc click nút xóa làm mở cửa sổ sửa
      if (
        window.showConfirm &&
        !(await window.showConfirm(
          "Xóa ghi chú",
          "Bạn chắc chắn muốn xóa ghi chú này?",
        ))
      ) {
        return;
      }
      await API.deleteStickyNote(id);
      renderStickyNotes();
    } catch (err) {
      console.error("Lỗi xóa ghi chú:", err);
    }
  };
})();
