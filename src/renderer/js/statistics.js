(function () {
  const API = window.electronAPI;

  window.loadStatistics = async () => {
    window.toggleLoader(true);
    try {
      // 1. Thiết lập ngày mặc định (đầu tháng đến cuối tháng) nếu chưa chọn
      const startInput = $("stats-start-date");
      const endInput = $("stats-end-date");
      const now = new Date();

      if (!startInput.value) {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        startInput.value = firstDay.toISOString().split("T")[0];
      }
      if (!endInput.value) {
        endInput.value = now.toISOString().split("T")[0];
      }

      // 2. Truy vấn đơn hàng trong khoảng ngày
      const sql = `
        SELECT o.*, c.name as cust_name 
        FROM orders o 
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.status = 'completed' 
        AND o.delivery_date BETWEEN ? AND ?
        ORDER BY o.delivery_date DESC
      `;
      const orders = await API.db_query(sql, [
        startInput.value,
        endInput.value,
      ]);

      // 3. Truy vấn bảng giá vốn hiện tại từ Menu để tính toán lợi nhuận
      // (Vì items_json lưu giá bán, chúng ta cần so khớp để lấy giá vốn hiện tại)
      const menuCosts = await API.db_query(`
        SELECT id, 
          (
            COALESCE((SELECT SUM(mr.ratio * (SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) / CAST(r.output AS REAL) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id JOIN recipes r ON ri.recipe_id = r.id WHERE ri.recipe_id = mr.recipe_id)) FROM menu_recipes mr WHERE mr.menu_item_id = menu_items.id), 0) + 
            COALESCE((SELECT SUM(mp.qty * i.unit_price) FROM menu_packaging mp JOIN ingredients i ON mp.ingredient_id = i.id WHERE mp.menu_item_id = menu_items.id), 0) + 
            COALESCE((SELECT SUM(mig.qty * i.unit_price) FROM menu_ingredients mig JOIN ingredients i ON mig.ingredient_id = i.id WHERE mig.menu_item_id = menu_items.id), 0) +
            electricity + depreciation + labor
          ) AS unit_cost
        FROM menu_items
      `);
      const costMap = menuCosts.reduce((acc, item) => {
        acc[item.id] = item.unit_cost;
        return acc;
      }, {});

      // Lấy thêm giá vốn của các công thức nhân để tính toán chính xác
      const fillingCosts = await API.db_query(`
        SELECT r.id, 
               (SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) / CAST(r.output AS REAL) 
                FROM recipe_ingredients ri 
                JOIN ingredients i ON ri.ingredient_id = i.id 
                WHERE ri.recipe_id = r.id) AS cost
        FROM recipes r WHERE r.recipe_type = 'filling'
      `);
      const fillingCostMap = fillingCosts.reduce((acc, f) => {
        acc[f.id] = f.cost;
        return acc;
      }, {});

      let totalRevenue = 0;
      let totalEstimatedCost = 0;
      const productSales = {};
      const dailyData = {};

      // Khởi tạo dailyData với 0 cho tất cả các ngày trong khoảng chọn
      const [sY, sM, sD] = startInput.value.split("-").map(Number);
      const [eY, eM, eD] = endInput.value.split("-").map(Number);
      let dPtr = new Date(sY, sM - 1, sD);
      const endD = new Date(eY, eM - 1, eD);

      while (dPtr <= endD) {
        const ds = `${dPtr.getFullYear()}-${String(dPtr.getMonth() + 1).padStart(2, "0")}-${String(dPtr.getDate()).padStart(2, "0")}`;
        dailyData[ds] = { revenue: 0, cost: 0 };
        dPtr.setDate(dPtr.getDate() + 1);
      }

      const orderRowsHtml = orders
        .map((order) => {
          totalRevenue += order.total_amount;
          const dateKey = order.delivery_date;

          if (dailyData[dateKey]) {
            dailyData[dateKey].revenue += order.total_amount;
          }

          let orderCost = 0;
          const items = JSON.parse(order.items_json || "[]");

          items.forEach((item) => {
            // Cộng dồn số lượng bán
            productSales[item.base_name] =
              (productSales[item.base_name] || 0) + item.qty;

            // Tính giá vốn: (Giá gốc món + Giá vốn nhân) * Số lượng
            const baseUnitCost = costMap[item.menu_id] || 0;
            const fillingUnitCost = item.filling_id
              ? fillingCostMap[item.filling_id] || 0
              : 0;

            orderCost += (baseUnitCost + fillingUnitCost) * item.qty;
          });

          if (dailyData[dateKey]) {
            dailyData[dateKey].cost += orderCost;
          }

          totalEstimatedCost += orderCost;
          const profit = order.total_amount - orderCost;

          return `
          <tr>
            <td>#${order.id}</td>
            <td>${order.delivery_date}</td>
            <td>${order.cust_name || "Khách vãng lai"}</td>
            <td class="text-right">${window.formatNumber(order.total_amount)}đ</td>
            <td class="text-right" style="color: #999">${window.formatNumber(Math.round(orderCost))}đ</td>
            <td class="text-right font-weight-bold" style="color: ${profit >= 0 ? "var(--status-success-text)" : "var(--status-error-text)"}">
              ${window.formatNumber(Math.round(profit))}đ
            </td>
          </tr>
        `;
        })
        .join("");

      // 4. Hiển thị KPI
      const totalProfit = totalRevenue - totalEstimatedCost;
      const profitPercent =
        totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

      $("stat-total-revenue").innerText =
        window.formatNumber(Math.round(totalRevenue)) + " đ";
      $("stat-total-cost").innerText =
        window.formatNumber(Math.round(totalEstimatedCost)) + " đ";
      $("stat-total-profit").innerText =
        window.formatNumber(Math.round(totalProfit)) + " đ";
      $("stat-profit-percent").innerText =
        `${profitPercent.toFixed(1)}% trên doanh thu`;

      // 5. Hiển thị bảng
      $("stats-order-list").innerHTML =
        orderRowsHtml ||
        '<tr><td colspan="6" class="text-center">Không có dữ liệu trong khoảng thời gian này.</td></tr>';

      // 6. Top sản phẩm
      const sortedProducts = Object.entries(productSales)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      $("stats-top-products").innerHTML =
        sortedProducts
          .map(
            ([name, qty]) => `
        <tr>
          <td>${name}</td>
          <td class="text-center"><b>${qty}</b></td>
        </tr>
      `,
          )
          .join("") || '<tr><td colspan="2" class="text-center">---</td></tr>';

      // 7. Vẽ biểu đồ đường
      renderLineChart(dailyData);
    } catch (error) {
      console.error("Lỗi thống kê:", error);
      window.showToast?.("Không thể nạp dữ liệu thống kê", "error");
    } finally {
      window.toggleLoader(false);
    }
  };

  function renderLineChart(dailyData) {
    const container = $("stats-line-chart-container");
    if (!container) return;

    const dates = Object.keys(dailyData).sort();
    const width = container.clientWidth || 800;
    const height = 260;
    const padding = 40;

    const maxVal = Math.max(
      ...dates.map((d) => dailyData[d].revenue),
      100000, // Tỷ lệ tối thiểu
    );

    const getX = (index) =>
      padding + (index * (width - 2 * padding)) / (dates.length - 1 || 1);
    const getY = (val) =>
      height - padding - (val * (height - 2 * padding)) / maxVal;

    let revPath = "";
    let profitPath = "";
    let markers = "";
    let labels = "";
    const labelStep = Math.ceil(dates.length / 10);

    dates.forEach((date, i) => {
      const rev = dailyData[date].revenue;
      const profit = rev - dailyData[date].cost;
      const x = getX(i);
      const yRev = getY(rev);
      const yProfit = getY(profit);

      if (i === 0) {
        revPath += `M ${x} ${yRev}`;
        profitPath += `M ${x} ${yProfit}`;
      } else {
        revPath += ` L ${x} ${yRev}`;
        profitPath += ` L ${x} ${yProfit}`;
      }

      // Điểm nút
      markers += `<circle cx="${x}" cy="${yRev}" r="4" class="marker-rev"><title>${date}: ${window.formatNumber(rev)}đ</title></circle>`;
      markers += `<circle cx="${x}" cy="${yProfit}" r="4" class="marker-profit"><title>${date}: ${window.formatNumber(profit)}đ</title></circle>`;

      // Nhãn trục X
      if (i % labelStep === 0 || i === dates.length - 1) {
        const label = date.split("-").slice(1).reverse().join("/");
        labels += `<text x="${x}" y="${height - 5}" text-anchor="middle" class="chart-axis-label">${label}</text>`;
      }
    });

    container.innerHTML = `
      <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <!-- Trục và lưới -->
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#eee" stroke-width="1" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#eee" stroke-width="1" />
        
        <!-- Đường doanh thu -->
        <path d="${revPath}" fill="none" stroke="#6366f1" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
        <!-- Đường lợi nhuận -->
        <path d="${profitPath}" fill="none" stroke="#10b981" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
        
        ${labels}
        ${markers}
      </svg>
    `;
  }
})();
