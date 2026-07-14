(function () {
  "use strict";

  const ITEMS_PER_PAGE = 6;
  const DEFAULT_BG_COLOR = "#ffe9db";
  const DEFAULT_TEXT_COLOR = "#bc5a1a";
  const API = window.electronAPI;

  // Nếu $ chưa được định nghĩa ở global, hãy khai báo dự phòng để tránh lỗi crash script
  const $ = window.$ || ((id) => document.getElementById(id));

  // --- KnowledgeService: Database Interactions ---
  const KnowledgeService = {
    async fetchCategories() {
      return API.db_query(
        "SELECT * FROM knowledge_categories WHERE is_active = 1",
      );
    },
    async fetchArticles(keyword, categoryId) {
      let sql = `
        SELECT k.*, c.name as cat_name, c.bg_color, c.text_color
        FROM baking_knowledge k
        LEFT JOIN knowledge_categories c ON k.category_id = c.id
        WHERE k.is_active = 1
      `;
      const params = [];

      if (categoryId !== "ALL") {
        sql += " AND k.category_id = ?";
        params.push(parseInt(categoryId, 10));
      }
      sql += " ORDER BY k.id DESC";

      const rawData = await API.db_query(sql, params);
      const kw = window.removeAccents(keyword);
      return rawData.filter(
        (k) =>
          window.removeAccents(k.title).includes(kw) ||
          window.removeAccents(k.summary || "").includes(kw),
      );
    },
    async fetchArticleById(id) {
      const res = await API.db_query(
        `SELECT k.*, c.name as cat_name, c.bg_color, c.text_color
         FROM baking_knowledge k LEFT JOIN knowledge_categories c ON k.category_id = c.id
         WHERE k.id = ?`,
        [id],
      );
      return res?.[0];
    },
    async checkDuplicateTitle(title) {
      const res = await API.db_query(
        "SELECT id FROM baking_knowledge WHERE title = ? AND is_active = 1",
        [title],
      );
      return res && res.length > 0;
    },
  };

  // --- KnowledgeUI: DOM Manipulation & Rendering ---
  const KnowledgeUI = {
    renderCategoryFilters(categories, selectedId) {
      const filterBar = $("knowledge-cat-filters");
      if (!filterBar) return;

      filterBar.classList.add("tab-container");

      const isAllActive = selectedId === "ALL" ? "active" : "";
      let html = `<button class="tab-btn ${isAllActive}" style="background: var(--neutral-300); color: var(--color-primary-text);"
        onclick="window.KnowledgeController.filterByCategory('ALL')">✨ Tất cả</button>`;

      html += categories
        .map((c) => {
          const isActive = String(selectedId) === String(c.id) ? "active" : "";
          return `<button class="tab-btn ${isActive}"
             style="background: ${c.bg_color}; color: ${c.text_color};"
             onclick="window.KnowledgeController.filterByCategory(${c.id})">${c.name}</button>`;
        })
        .join("");

      filterBar.innerHTML = html;
    },

    renderCategoryOptions(categories) {
      const selectForm = $("k-category-id");
      if (!selectForm) return;
      selectForm.innerHTML = categories
        .map((c) => `<option value="${c.id}">${c.name}</option>`)
        .join("");
    },

    renderArticleCards(articles) {
      const grid = $("knowledge-grid-body");
      if (!grid) return;

      if (!articles || articles.length === 0) {
        grid.innerHTML = `<div class="no-data text-center p-xxl" style="grid-column: 1 / -1;">
          🌿 Thư viện chưa có bài viết nào phù hợp. Nhấn "Thêm Kiến Thức" ngay nhé!</div>`;
        return;
      }

      grid.innerHTML = articles
        .map((item) => {
          const bgColor = item.bg_color || DEFAULT_BG_COLOR;
          const textColor = item.text_color || DEFAULT_TEXT_COLOR;
          const catName = item.cat_name || "Mặc định";
          const date = item.created_at ? item.created_at.split(" ")[0] : "---";
          const summary = item.summary || "Không có mô tả ngắn.";

          return `
          <div class="knowledge-card" onclick="window.KnowledgeController.openDetail(${item.id})">
            <div>
              <span class="badge" style="background: ${bgColor}; color: ${textColor};">${catName}</span>
              <h3>${item.title}</h3>
              <p>${summary}</p>
            </div>
            <div class="card-footer">
              <span style="font-size: 11px; color: #bcaaa4;">📅 ${date}</span>
              <span style="font-size: 12px; color: ${DEFAULT_TEXT_COLOR}; font-weight: bold;">Đọc tiếp →</span>
            </div>
          </div>
        `;
        })
        .join("");
    },

    showDetailModal(article, contentHtml) {
      $("view-k-title").innerText = article.title;
      $("view-k-date").innerText = `Ngày lưu: ${article.created_at}`;

      const summaryEl = $("view-k-summary");
      if (summaryEl) {
        summaryEl.innerText = article.summary ? article.summary : "";
        summaryEl.style.display = article.summary ? "block" : "none";
      }

      const badge = $("view-k-badge");
      badge.innerText = article.cat_name || "Mặc định";
      badge.style.background = article.bg_color || DEFAULT_BG_COLOR;
      badge.style.color = article.text_color || DEFAULT_TEXT_COLOR;

      $("view-k-content").innerHTML = contentHtml;

      // Sửa lỗi: Cần tắt modal hiện tại trước, có thể dùng setTimeout nhỏ để UX mượt hơn
      $("view-k-btn-edit").onclick = () => {
        KnowledgeUI.hideDetailModal(); // Dùng object cụ thể để tránh lỗi mất context 'this'
        setTimeout(() => {
          window.KnowledgeController.openForm("edit", article.id);
        }, 150);
      };

      $("view-k-btn-delete").onclick = () => {
        KnowledgeUI.hideDetailModal();
        setTimeout(() => {
          window.KnowledgeController.deleteArticle(article.id, article.title);
        }, 150);
      };

      const modal = $("knowledge-detail-modal");
      modal.style.display = ""; // Reset inline style nếu có
      modal.classList.add("flex");
    },

    hideDetailModal() {
      // Sửa cách đóng modal: Dùng remove class flex thay vì display: none
      $("knowledge-detail-modal").classList.remove("flex");
    },

    showFormModal(mode, article = null) {
      const modal = $("knowledge-modal");
      modal.setAttribute("data-mode", mode);
      modal.setAttribute("data-editing-id", article ? article.id : "");

      $("knowledge-modal-title").innerText =
        mode === "add" ? "Thêm Kiến Thức Mới" : "Chỉnh Sửa Kiến Thức";

      $("k-title").value = article ? article.title : "";
      $("k-summary").value = article ? article.summary : "";
      $("k-content").value = article ? article.content : "";

      if (article) {
        setTimeout(() => {
          $("k-category-id").value = article.category_id;
        }, 20);
      }

      modal.style.display = ""; // Reset inline style nếu có
      modal.classList.add("flex");
    },

    hideFormModal() {
      // Sửa cách đóng modal: Dùng remove class flex thay vì display: none
      $("knowledge-modal").classList.remove("flex");
    },
  };

  // --- KnowledgeController: Orchestration & State ---
  const KnowledgeController = {
    state: {
      currentPage: 1,
      keyword: "",
      selectedCategory: "ALL",
      categories: [],
    },

    async init() {
      await this.loadCategories();
      await this.loadArticles();
    },

    async loadCategories() {
      try {
        this.state.categories = await KnowledgeService.fetchCategories();
        KnowledgeUI.renderCategoryFilters(
          this.state.categories,
          this.state.selectedCategory,
        );
        KnowledgeUI.renderCategoryOptions(this.state.categories);
      } catch (err) {
        console.error("Error loading categories:", err);
      }
    },

    filterByCategory(catId) {
      this.state.selectedCategory = catId;
      this.state.currentPage = 1;
      KnowledgeUI.renderCategoryFilters(this.state.categories, catId);
      this.loadArticles();
    },

    async loadArticles() {
      try {
        const data = await KnowledgeService.fetchArticles(
          this.state.keyword,
          this.state.selectedCategory,
        );

        const pagingResult = window.getPagination(
          data,
          ITEMS_PER_PAGE,
          this.state.currentPage,
          (newPage) => {
            this.state.currentPage = newPage;
            this.loadArticles();
          },
        );

        KnowledgeUI.renderArticleCards(pagingResult.data || []);
        const paginationContainer = $("knowledge-pagination");
        if (paginationContainer) {
          paginationContainer.innerHTML = pagingResult.html || "";
        }
      } catch (err) {
        console.error("Error loading articles:", err);
      }
    },

    search: window.debounce(function () {
      this.state.keyword = $("knowledge-search").value.trim();
      this.state.currentPage = 1;
      this.loadArticles();
    }, 300),

    parseWikiLinks(content) {
      if (!content) return "";
      return content.replace(/\[\[(.*?)\]\]/g, (match, title) => {
        const cleanTitle = title.trim();
        return `<a href="javascript:void(0)" class="wiki-link" onclick="event.stopPropagation(); window.KnowledgeController.goToArticleByTitle('${cleanTitle}')">${cleanTitle}</a>`;
      });
    },

    async goToArticleByTitle(title) {
      const res = await API.db_query(
        "SELECT id FROM baking_knowledge WHERE title = ? AND is_active = 1",
        [title],
      );
      if (res?.[0]) {
        this.openDetail(res[0].id);
      } else {
        window.showToast?.(`Chủ đề "${title}" chưa được biên soạn!`, "warning");
      }
    },

    async openDetail(id) {
      const article = await KnowledgeService.fetchArticleById(id);
      if (article) {
        const contentHtml = this.parseWikiLinks(article.content);
        KnowledgeUI.showDetailModal(article, contentHtml);
      }
    },

    async openForm(mode, id = null) {
      let article = null;
      if (mode === "edit" && id) {
        article = await KnowledgeService.fetchArticleById(id);
      }
      KnowledgeUI.showFormModal(mode, article);
    },

    async saveArticle() {
      const modal = $("knowledge-modal");
      const mode = modal.getAttribute("data-mode");
      const id = modal.getAttribute("data-editing-id");

      const title = $("k-title").value.trim();
      const category_id = $("k-category-id").value;
      const summary = $("k-summary").value.trim();
      const content = $("k-content").value.trim();

      if (!title || !content) {
        return window.showToast?.(
          "Vui lòng điền Tiêu đề và Nội dung!",
          "error",
        );
      }

      try {
        if (mode === "add") {
          const exists = await KnowledgeService.checkDuplicateTitle(title);
          if (exists)
            return window.showToast?.("Tiêu đề bài viết đã tồn tại!", "error");

          await API.db_execute(
            "INSERT INTO baking_knowledge (category_id, title, summary, content) VALUES (?, ?, ?, ?)",
            [parseInt(category_id, 10), title, summary, content],
          );
          window.showToast?.("Đã thêm bài viết thành công! ✨", "success");

          // Reset filters and pagination so the new article is visible
          this.state.currentPage = 1;
          this.state.keyword = "";
          this.state.selectedCategory = "ALL";

          const searchInput = $("knowledge-search");
          if (searchInput) searchInput.value = "";
          KnowledgeUI.renderCategoryFilters(this.state.categories, "ALL");
        } else {
          await API.db_execute(
            "UPDATE baking_knowledge SET category_id = ?, title = ?, summary = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [parseInt(category_id, 10), title, summary, content, id],
          );
          window.showToast?.("Đã cập nhật bài viết thành công!", "success");
        }

        KnowledgeUI.hideFormModal();
        this.loadArticles();
      } catch (err) {
        console.error(err);
      }
    },

    async deleteArticle(id, title) {
      const confirmed = await window.showConfirm(
        "Xác nhận xóa bài viết",
        `Bạn có chắc chắn muốn xóa bài viết về "${title}" không?`,
      );
      if (!confirmed) return;

      try {
        await API.db_execute(
          "UPDATE baking_knowledge SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [id],
        );
        window.showToast?.("Đã xóa bài viết kiến thức.", "success");
        this.loadArticles();
      } catch (err) {
        console.error(err);
      }
    },
  };

  // ==========================================
  // CATEGORY MANAGEMENT
  // ==========================================

  function resetCategoryForm() {
    $("cat-id-input").value = "";
    $("cat-name-input").value = "";
    $("cat-bg-input").value = DEFAULT_BG_COLOR;
    $("cat-text-input").value = DEFAULT_TEXT_COLOR;
    $("btn-save-cat").innerText = "Thêm";
    $("btn-cancel-cat").style.display = "none";
    window.updateCategoryPreview();
  }

  async function loadCategoryList() {
    try {
      const cats = await KnowledgeService.fetchCategories();
      const tbody = $("category-list-body");
      if (!tbody) return;

      if (!cats || cats.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#999; padding: 15px;">Chưa có danh mục nào</td></tr>`;
        return;
      }

      tbody.innerHTML = cats
        .map(
          (c) => `
        <tr>
          <td style="font-weight: 500;">${c.name}</td>
          <td><span class="badge" style="background: ${c.bg_color}; color: ${c.text_color};">${c.name}</span></td>
          <td class="text-center">
            <button class="btn-secondary" onclick="window.editCategory(${c.id}, '${c.name}', '${c.bg_color}', '${c.text_color}')">
                <img src="src/renderer/assets/edit.svg" alt="Edit" class="icon"/></button>
            <button class="btn-secondary" onclick="window.deleteCategory(${c.id}, '${c.name}')">
                <img src="src/renderer/assets/trash.svg" alt="Delete" class="icon"/></button>
          </td>
        </tr>
      `,
        )
        .join("");
    } catch (err) {
      console.error(err);
    }
  }

  // ==========================================
  // GLOBAL EXPORTS FOR HTML WIRING
  // ==========================================
  window.KnowledgeController = KnowledgeController;
  window.loadKnowledge = () => KnowledgeController.loadArticles();
  window.searchKnowledge = () => KnowledgeController.search();
  window.openKnowledgeModal = (mode, id) =>
    KnowledgeController.openForm(mode, id);
  window.closeKnowledgeModal = () => KnowledgeUI.hideFormModal();
  window.saveKnowledge = () => KnowledgeController.saveArticle();
  window.closeKnowledgeDetailModal = () => KnowledgeUI.hideDetailModal();
  window.deleteKnowledge = (id, title) =>
    KnowledgeController.deleteArticle(id, title);

  window.updateCategoryPreview = () => {
    const nameInput = $("cat-name-input");
    if (nameInput) {
      nameInput.style.backgroundColor = $("cat-bg-input").value;
      nameInput.style.color = $("cat-text-input").value;
    }
  };

  window.openCategoryModal = () => {
    resetCategoryForm();
    loadCategoryList();
    $("category-modal").style.display = "";
    $("category-modal").classList.add("flex");
    if (!$("cat-bg-input").dataset.listenerAdded) {
      $("cat-bg-input").addEventListener("input", window.updateCategoryPreview);
      $("cat-text-input").addEventListener(
        "input",
        window.updateCategoryPreview,
      );
      $("cat-bg-input").dataset.listenerAdded = "true";
    }
  };

  window.closeCategoryModal = () => {
    $("category-modal").classList.remove("flex");
  };
  window.resetCategoryForm = resetCategoryForm;
  window.loadCategoryList = loadCategoryList;

  window.editCategory = (id, name, bg, text) => {
    $("cat-id-input").value = id;
    $("cat-name-input").value = name;
    $("cat-bg-input").value = bg;
    $("cat-text-input").value = text;
    $("btn-save-cat").innerText = "Cập nhật";
    $("btn-cancel-cat").style.display = "inline-block";
    window.updateCategoryPreview();
  };

  window.saveCategory = async () => {
    const id = $("cat-id-input").value;
    const name = $("cat-name-input").value.trim();
    const bg = $("cat-bg-input").value;
    const text = $("cat-text-input").value;

    if (!name)
      return window.showToast?.("Vui lòng nhập tên danh mục!", "error");

    try {
      // 1. Kiểm tra xem tên danh mục đã tồn tại trong Database chưa
      const checkSql = id
        ? "SELECT id FROM knowledge_categories WHERE name = ? AND id != ?"
        : "SELECT id FROM knowledge_categories WHERE name = ?";
      const checkParams = id ? [name, id] : [name];

      const existing = await API.db_query(checkSql, checkParams);

      if (existing && existing.length > 0) {
        return window.showToast?.(
          "Tên danh mục này đã tồn tại! Vui lòng chọn tên khác.",
          "error",
        );
      }

      // 2. Nếu không trùng, tiến hành Thêm hoặc Cập nhật
      if (id) {
        await API.db_execute(
          "UPDATE knowledge_categories SET name = ?, bg_color = ?, text_color = ? WHERE id = ?",
          [name, bg, text, id],
        );
        window.showToast?.("Cập nhật danh mục thành công!", "success");
      } else {
        // Nếu trường hợp danh mục cũ đã bị xóa (is_active = 0) có cùng tên,
        // ở mức nâng cao bạn có thể khôi phục nó thay vì INSERT.
        // Nhưng tạm thời, try-catch dưới đây sẽ bắt lỗi chặn đứng nếu hệ thống vẫn báo UNIQUE.
        await API.db_execute(
          "INSERT INTO knowledge_categories (name, bg_color, text_color, is_active) VALUES (?, ?, ?, 1)",
          [name, bg, text],
        );
        window.showToast?.("Đã thêm danh mục mới!", "success");
      }

      resetCategoryForm();
      loadCategoryList();
      KnowledgeController.loadCategories();
    } catch (err) {
      // 3. Bắt lỗi an toàn nếu SQLite vẫn ném ra lỗi UNIQUE Constraint
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        window.showToast?.(
          "Tên danh mục đã từng tồn tại trong hệ thống. Vui lòng chọn tên khác!",
          "error",
        );
      } else {
        window.showToast?.("Có lỗi xảy ra khi lưu danh mục!", "error");
      }
      console.error("Lỗi khi saveCategory:", err);
    }
  };

  window.deleteCategory = async (id, name) => {
    const confirmed = await window.showConfirm(
      "Xóa danh mục",
      `Bạn có chắc muốn xóa danh mục "${name}"? Các bài viết thuộc danh mục này sẽ tạm thời bị ẩn khỏi lưới hiển thị.`,
    );
    if (!confirmed) return;

    try {
      await API.db_execute(
        "UPDATE knowledge_categories SET is_active = 0 WHERE id = ?",
        [id],
      );
      window.showToast?.("Đã xóa danh mục.", "success");

      if (String(KnowledgeController.state.selectedCategory) === String(id)) {
        KnowledgeController.state.selectedCategory = "ALL";
      }

      loadCategoryList();
      KnowledgeController.loadCategories();
      window.loadKnowledge();
    } catch (err) {
      console.error(err);
    }
  };

  window.loadKnowledgePage = () => {
    KnowledgeController.init().catch((err) =>
      console.error("Initialization error:", err),
    );
  };
  window.initKnowledgePage = window.loadKnowledgePage;

  // Giải pháp Clean Code: Kích hoạt NGAY LẬP TỨC khi cấu trúc HTML thay đổi
  const observer = new MutationObserver(() => {
    const grid = $("knowledge-grid-body");
    if (grid && !grid.dataset.loadedOnce) {
      grid.dataset.loadedOnce = "true";
      window.initKnowledgePage();
    }
  });

  // Bật chế độ lắng nghe sự thay đổi giao diện của toàn bộ ứng dụng
  observer.observe(document.body, { childList: true, subtree: true });
})();
