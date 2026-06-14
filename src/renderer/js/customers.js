(function () {
  const itemsPerPage = 7;
  const API = window.electronAPI;
  if (typeof window.currentPageCust === "undefined") window.currentPageCust = 1;
  if (typeof window.custKeyword === "undefined") window.custKeyword = "";

  window.loadCustomers = async () => {
    try {
      const tbody = $("customer-list-body");
      const paginationContainer = $("customer-pagination");
      if (!tbody) return;

      // Đồng bộ keyword từ UI để đảm bảo state luôn khớp với ô nhập liệu
      const searchInput = $("customer-search");
      if (searchInput) {
        window.custKeyword = searchInput.value.trim();
      }

      // 🌟 ĐÃ SỬA: Chỉ COUNT những đơn có status = 'completed'
      const sql = `
        SELECT c.*, 
               COUNT(CASE WHEN o.status = 'completed' THEN o.id END) AS total_orders,
               COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS total_spent
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        WHERE c.is_active = 1
        GROUP BY c.id
        ORDER BY c.id DESC
      `;

      const rawData = await API.db_query(sql);

      // Lọc không dấu và không phân biệt hoa thường
      const kw = window.removeAccents(window.custKeyword);
      const data = rawData.filter(
        (c) =>
          window.removeAccents(c.name).includes(kw) ||
          (c.phone && c.phone.includes(window.custKeyword)),
      );

      if (window.currentPageCust > 1 && data) {
        const totalPages = Math.ceil(data.length / itemsPerPage);
        if (window.currentPageCust > totalPages)
          window.currentPageCust = totalPages || 1;
      }

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="no-data text-center">Không tìm thấy dữ liệu khách hàng nào.</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = "";
        return;
      }

      const pagingResult = window.getPagination(
        data,
        itemsPerPage,
        window.currentPageCust,
        (newPage) => {
          window.currentPageCust = newPage;
          window.loadCustomers();
        },
      );

      const startIndex = (window.currentPageCust - 1) * itemsPerPage;
      tbody.innerHTML = pagingResult.data
        .map((c, index) => {
          const globalIndex = startIndex + index + 1;
          const currentAddress = c.address ? c.address.trim() : "";

          return `
        <tr>
          <td class="text-center">${globalIndex}</td>
          <td class="cust-name-text">${c.name}</td>
          <td class="text-center">${c.phone || "---"}</td>
          <td>
            <div class="stats-badge-wrapper">
              <span class="stat-item">Đã mua: <b>${c.total_orders}</b> đơn</span>
              <span class="stat-item">Chi tiêu: <span class="stat-highlight">${window.formatNumber(c.total_spent)} đ</span></span>
            </div>
          </td>
          <td class="note-column has-tooltip" data-note="${currentAddress || "..."}">
            ${currentAddress || "..."}
          </td>
          <td class="action-column text-center">
            <button class="btn-secondary btn-edit" title="Sửa" onclick="window.openCustomerModal('edit', ${c.id})">
              <img src="src/renderer/assets/edit.svg" class="icon" />
            </button>
            <button class="btn-secondary btn-delete" title="Xóa" onclick="window.deleteCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
              <img src="src/renderer/assets/trash.svg" class="icon" />
            </button>
          </td>
        </tr>
        `;
        })
        .join("");

      if (paginationContainer)
        paginationContainer.innerHTML = pagingResult.html;
      if (typeof TooltipComponent !== "undefined") TooltipComponent.init();
    } catch (error) {
      console.error("Lỗi nạp danh sách khách hàng:", error);
    }
  };

  window.searchCustomers = window.debounce(() => {
    window.custKeyword = $("customer-search").value.trim();
    window.currentPageCust = 1;
    window.loadCustomers();
  }, 300);

  window.openCustomerModal = async (mode = "add", id = null) => {
    const modal = $("customer-modal");
    modal.setAttribute("data-mode", mode);
    modal.setAttribute("data-edit-id", id || "");

    $("c-modal-title").innerText =
      mode === "add" ? "Thêm Khách Hàng Mới" : "Cập Nhật Thông Tin";
    $("c-name").value = "";
    $("c-phone").value = "";
    $("c-address").value = "";

    if (mode === "edit" && id) {
      const data = await API.db_query("SELECT * FROM customers WHERE id = ?", [
        id,
      ]);
      if (data && data.length > 0) {
        $("c-name").value = data[0].name;
        $("c-phone").value = data[0].phone || "";
        $("c-address").value = data[0].address || "";
      }
    }
    modal.style.display = "flex";
  };

  window.closeCustomerModal = () => {
    $("customer-modal").style.display = "none";
  };

  window.saveCustomer = async () => {
    const name = $("c-name").value.trim();
    const phone = $("c-phone").value.trim();
    const address = $("c-address").value.trim();
    const modal = $("customer-modal");
    const mode = modal.getAttribute("data-mode");
    const editId = modal.getAttribute("data-edit-id");

    if (!name) {
      return window.showToast("Vui lòng nhập tên khách hàng!", "warning");
    }

    try {
      // Lấy toàn bộ danh sách để kiểm tra logic trùng lặp (không phân biệt hoa thường)
      const allCust = await API.db_query(
        "SELECT id, name, phone FROM customers",
      );
      const lowerName = name.toLowerCase();

      for (const c of allCust) {
        // Bỏ qua chính bản thân khách hàng đang sửa
        if (mode === "edit" && String(c.id) === String(editId)) continue;

        const existingLowerName = (c.name || "").toLowerCase();
        const existingPhone = (c.phone || "").trim();

        // 1. Một số điện thoại chỉ dùng cho 1 tên (không dùng 1 số cho nhiều tên)
        if (
          phone !== "" &&
          existingPhone === phone &&
          existingLowerName !== lowerName
        ) {
          return window.showToast(
            `Số điện thoại này đã được đăng ký cho khách "${c.name}"!`,
            "warning",
          );
        }

        // 2. Kiểm tra trùng lặp cặp Tên + Số
        if (existingLowerName === lowerName && existingPhone === phone) {
          return window.showToast(
            "Khách hàng với tên và số điện thoại này đã tồn tại!",
            "warning",
          );
        }
      }
    } catch (err) {
      console.error("Lỗi kiểm tra trùng lặp:", err);
    }

    if (mode === "edit") {
      await API.db_execute(
        "UPDATE customers SET name=?, phone=?, address=? WHERE id=?",
        [name, phone, address, editId],
      );
      window.showToast("Cập nhật thông tin thành công!", "success");
    } else {
      await API.db_execute(
        "INSERT INTO customers (name, phone, address, is_active) VALUES (?, ?, ?, 1)",
        [name, phone, address],
      );
      window.showToast("Thêm khách hàng thành công!", "success");
    }

    window.closeCustomerModal();
    window.loadCustomers();
  };

  window.deleteCustomer = async (id, name) => {
    // 1. CHẶN XÓA NẾU CÓ ĐƠN HÀNG ĐANG LÀM
    const checkSql =
      "SELECT COUNT(*) AS active_orders FROM orders WHERE customer_id = ? AND status IN ('pending', 'processing')";
    const result = await API.db_query(checkSql, [id]);

    if (result && result[0].active_orders > 0) {
      window.showToast(
        `LỖI: Khách hàng "${name}" đang có đơn bánh chưa hoàn thành. Không thể xóa!`,
        "error",
      );
      return; // Dừng luôn, không cho xóa
    }

    // 2. XÓA MỀM (SOFT DELETE)
    const isConfirmed = await window.showConfirm(
      "Xóa khách hàng",
      `Bạn có muốn xóa khách hàng "${name}"? Các đơn hàng cũ của khách này vẫn sẽ được giữ lại trong sổ sách.`,
    );
    if (!isConfirmed) return;

    // Chỉ cập nhật is_active = 0, KHÔNG DÙNG lệnh "DELETE FROM..."
    await API.db_execute("UPDATE customers SET is_active = 0 WHERE id = ?", [
      id,
    ]);
    window.showToast("Đã xóa khách hàng!", "success");
    window.loadCustomers();
  };

  // Khởi chạy khi load xong DOM
  document.addEventListener("DOMContentLoaded", () => {
    window.loadCustomers();
  });
})();
