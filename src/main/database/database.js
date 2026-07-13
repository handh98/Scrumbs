const { app } = require("electron");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

let dbPath;
if (!app.isPackaged) {
  dbPath = path.join(process.cwd(), "bakery.db");
  console.log("🛠 DEV MODE: Sử dụng DB kiểm thử tại dự án:", dbPath);
} else {
  const userDataPath = app.getPath("userData");
  dbPath = path.join(userDataPath, "bakery.db");
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  console.log("🚀 PROD MODE: Sử dụng DB chính thức tại AppData:", dbPath);
}

let db;
let mainWindowRef = null;

/**
 * Initializes connection to the SQLite database and sets performance PRAGMAs.
 * @returns {Promise<void>} Resolves when connection and initialization are complete.
 */
const connectDB = () => {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("❌ Lỗi kết nối CSDL:", err.message);
        reject(err);
      } else {
        console.log("✅ Kết nối CSDL thành công!");
        db.serialize(() => {
          db.run("PRAGMA journal_mode = WAL");
          db.run("PRAGMA synchronous = NORMAL");
          db.run("PRAGMA cache_size = -2000");
          db.run("PRAGMA temp_store = MEMORY");
          db.run("PRAGMA wal_autocheckpoint = 1000");

          // Check database integrity on startup
          db.all("PRAGMA integrity_check", (err, rows) => {
            if (err) {
              console.error("⚠️ Không thể kiểm tra integrity:", err.message);
            } else if (rows && rows[0] && rows[0].integrity_check !== "ok") {
              console.error(
                "🚨 Cảnh báo: Database có thể bị hỏng:",
                rows[0].integrity_check,
              );
            } else {
              console.log("✅ Database integrity check: OK");
            }
          });

          resolve();
        });
      }
    });

    db.on("error", (err) => {
      console.error("🚨 Database Error:", err.message);
      if (err.message.includes("disk I/O error")) {
        console.error(
          "🚨 Lỗi I/O ổ đĩa nghiêm trọng (OS Error 1392 có thể liên quan):",
          err,
        );
      }
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send("db-error", {
          message: err.message,
          type: "error",
          timestamp: new Date().toISOString(),
        });
      }
    });
  });
};

/**
 * Register main window reference to avoid repeated lookups
 * @param {BrowserWindow} win - The main application window
 */
function setMainWindow(win) {
  mainWindowRef = win;
}

/**
 * Sends a database migration or status message to the UI.
 * @param {string} message - Content of the message.
 * @param {string} [type='info'] - Type of message (loading, success, error, info).
 */
function sendStatusToUI(message, type = "info") {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("migration-status", { message, type });
  }
}

/**
 * Wrapper object for common SQLite operations returning Promises.
 */
const dbManager = {
  /**
   * Executes an INSERT, UPDATE, or DELETE statement with optional timeout.
   * @param {string} sql - SQL query string.
   * @param {Array} [params=[]] - Query parameters.
   * @param {number} [timeout=30000] - Query timeout in milliseconds.
   * @returns {Promise<{id: number, changes: number}>}
   */
  run: (sql, params = [], timeout = 30000) => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Query timeout after ${timeout}ms: ${sql.substring(0, 50)}...`,
          ),
        );
      }, timeout);

      db.run(sql, params, function (err) {
        clearTimeout(timeoutId);
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  },
  /**
   * Executes a SELECT query that returns a single row with optional timeout.
   * @param {string} sql - SQL query string.
   * @param {Array} [params=[]] - Query parameters.
   * @param {number} [timeout=10000] - Query timeout in milliseconds.
   * @returns {Promise<Object|undefined>}
   */
  get: (sql, params = [], timeout = 10000) => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Query timeout after ${timeout}ms: ${sql.substring(0, 50)}...`,
          ),
        );
      }, timeout);

      db.get(sql, params, (err, row) => {
        clearTimeout(timeoutId);
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  /**
   * Executes a SELECT query that returns all matching rows with optional timeout.
   * @param {string} sql - SQL query string.
   * @param {Array} [params=[]] - Query parameters.
   * @param {number} [timeout=30000] - Query timeout in milliseconds.
   * @returns {Promise<any[]>}
   */
  all: function (sql, params = [], timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Query timeout after ${timeout}ms: ${sql.substring(0, 50)}...`,
          ),
        );
      }, timeout);

      db.all(sql, params, (err, rows) => {
        clearTimeout(timeoutId);
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },
  /**
   * Ensures queries within the callback are executed sequentially.
   * @param {Function} callback
   */
  serialize: function (callback) {
    db.serialize(callback);
  },
};

/**
 * Creates a timestamped backup of the current database file (only once per day).
 * Cleans up backups older than 30 days.
 * @returns {Promise<void>}
 */
async function createBackup() {
  const backupDir = path.join(path.dirname(dbPath), "backups");
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const backupFileName = `bakery_${timestamp}.db.bak`;
  const backupFilePath = path.join(backupDir, backupFileName);

  try {
    if (!fs.existsSync(dbPath)) return;
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    // Check if backup already exists today
    const today = new Date().toISOString().split("T")[0];
    const backupFiles = fs.readdirSync(backupDir);
    const existingBackupToday = backupFiles.some((f) => f.includes(today));

    if (!existingBackupToday) {
      fs.copyFileSync(dbPath, backupFilePath);
      console.log(`✅ Đã tạo bản sao lưu: ${backupFileName}`);
    }

    // Clean up backups older than 30 days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    backupFiles.forEach((file) => {
      const filePath = path.join(backupDir, file);
      const fileStats = fs.statSync(filePath);
      if (fileStats.mtimeMs < thirtyDaysAgo) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Đã xóa bản sao lưu cũ: ${file}`);
      }
    });
  } catch (error) {
    console.error("❌ Lỗi sao lưu:", error.message);
  }
}

/**
 * Initializes the database schema including tables, virtual tables for FTS, and triggers.
 * @returns {Promise<void>}
 */
const initDB = async () => {
  if (!db) await connectDB();

  console.log("🚀 Đang khởi tạo CSDL mới...");

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      price REAL,
      qty REAL,
      unit TEXT,
      unit_price REAL,
      note TEXT,
      type TEXT DEFAULT 'ingredient',
      is_active INTEGER DEFAULT 1
    )`);

    // 2. Công thức
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      cook_time INTEGER,
      output INTEGER DEFAULT 1,
      steps_json TEXT,
      total_cost REAL DEFAULT 0, -- Cột mới để tối ưu hiệu năng
      recipe_type TEXT DEFAULT 'general', -- 'crust', 'filling', 'general'
      note TEXT,
      image_path TEXT, -- Cột mới để lưu đường dẫn ảnh đại diện
      is_active INTEGER DEFAULT 1
    )`);

    // 3. Thành phần nguyên liệu của Công thức
    db.run(`CREATE TABLE IF NOT EXISTS recipe_ingredients (
      recipe_id INTEGER,
      ingredient_id INTEGER,
      qty REAL NOT NULL,
      type TEXT DEFAULT 'ingredient',
      sub_recipe_id INTEGER,
      PRIMARY KEY (recipe_id, ingredient_id),
      FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
    )`);

    // 4. Menu món ăn
    db.run(`CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      electricity REAL DEFAULT 0,
      depreciation REAL DEFAULT 0,
      labor REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      profit_margin REAL DEFAULT 0,
      note TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 5. Liên kết Menu - Công thức
    db.run(`CREATE TABLE IF NOT EXISTS menu_recipes (
      menu_item_id INTEGER,
      recipe_id INTEGER,
      ratio REAL NOT NULL,
      PRIMARY KEY (menu_item_id, recipe_id),
      FOREIGN KEY(menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
      FOREIGN KEY(recipe_id) REFERENCES recipes(id)
    )`);

    // 6. Liên kết Menu - Bao bì & Nguyên liệu trực tiếp
    db.run(`CREATE TABLE IF NOT EXISTS menu_packaging (
      menu_item_id INTEGER,
      ingredient_id INTEGER,
      qty REAL NOT NULL,
      PRIMARY KEY (menu_item_id, ingredient_id),
      FOREIGN KEY(menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
      FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS menu_ingredients (
      menu_item_id INTEGER,
      ingredient_id INTEGER,
      qty REAL NOT NULL,
      PRIMARY KEY (menu_item_id, ingredient_id),
      FOREIGN KEY(menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
      FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
    )`);

    // 7. Đơn hàng
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      delivery_date TEXT,
      status TEXT DEFAULT 'pending',
      total_amount REAL,
      items_json TEXT, -- Sẽ lưu {menu_id, filling_id, qty, price...}
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 8. Khách hàng
    db.run(`CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 9. Lô hàng nhập kho
    db.run(`CREATE TABLE IF NOT EXISTS inventory_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_id INTEGER,
      qty_imported REAL,
      qty_remaining REAL,
      import_date TEXT,
      expiry_date TEXT,
      purchase_price REAL DEFAULT 0, -- Giá mua của lô hàng này
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
    )`);

    // 10. Danh mục kiến thức
    db.run(`CREATE TABLE IF NOT EXISTS knowledge_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      bg_color TEXT DEFAULT '#ffe9db',
      text_color TEXT DEFAULT '#bc5a1a',
      is_active INTEGER DEFAULT 1
    )`);

    // 11. Bài viết kiến thức
    db.run(`CREATE TABLE IF NOT EXISTS baking_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER DEFAULT 1,
      title TEXT UNIQUE NOT NULL,
      summary TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY(category_id) REFERENCES knowledge_categories(id)
    )`);

    // 12. Ghi chú nhanh (Sticky Notes)
    db.run(`CREATE TABLE IF NOT EXISTS sticky_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      color TEXT DEFAULT '#fff9c4',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 12. Bảng quản lý phiên bản schema
    db.run(
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`,
    );

    // 13. Bảng ảo FTS5 (Tối ưu tìm kiếm)
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS customers_fts USING fts5(
      name, phone, tokenize='unicode61'
    )`);

    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
      name, recipe_type, note, ingredients, tokenize='unicode61'
    )`);

    // 14. Triggers đồng bộ FTS & Tự động tính giá vốn
    // Customers FTS
    db.run(`DROP TRIGGER IF EXISTS customers_ai`);
    db.run(`CREATE TRIGGER IF NOT EXISTS customers_ai AFTER INSERT ON customers BEGIN
      INSERT INTO customers_fts(rowid, name, phone) VALUES (new.id, new.name, new.phone);
    END;`);
    db.run(`DROP TRIGGER IF EXISTS customers_ad`);
    db.run(`CREATE TRIGGER IF NOT EXISTS customers_ad AFTER DELETE ON customers BEGIN
      DELETE FROM customers_fts WHERE rowid = OLD.id;
    END;`);
    db.run(`DROP TRIGGER IF EXISTS customers_au`);
    db.run(`CREATE TRIGGER IF NOT EXISTS customers_au AFTER UPDATE ON customers BEGIN
      DELETE FROM customers_fts WHERE rowid = OLD.id;
      INSERT INTO customers_fts(rowid, name, phone) VALUES (new.id, new.name, new.phone);
    END;`);

    // Recipes FTS
    db.run(`DROP TRIGGER IF EXISTS recipes_ai`);
    db.run(`CREATE TRIGGER IF NOT EXISTS recipes_ai AFTER INSERT ON recipes BEGIN
      INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients) VALUES (NEW.id, NEW.name, NEW.recipe_type, NEW.note, '');
    END;`);
    db.run(`DROP TRIGGER IF EXISTS recipes_ad`);
    db.run(`CREATE TRIGGER IF NOT EXISTS recipes_ad AFTER DELETE ON recipes BEGIN
      DELETE FROM recipes_fts WHERE rowid = OLD.id;
    END;`);
    db.run(`DROP TRIGGER IF EXISTS recipes_au`);
    db.run(`CREATE TRIGGER IF NOT EXISTS recipes_au AFTER UPDATE ON recipes BEGIN
      DELETE FROM recipes_fts WHERE rowid = OLD.id;
      INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
      SELECT id, name, recipe_type, note,
             (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
      FROM recipes WHERE id = NEW.id;
    END;`);

    // Recipe Ingredients (FTS & Cost) - Optimized triggers
    db.run(`DROP TRIGGER IF EXISTS ri_ai`);
    db.run(`CREATE TRIGGER ri_ai AFTER INSERT ON recipe_ingredients BEGIN
      DELETE FROM recipes_fts WHERE rowid = NEW.recipe_id;
      INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
      SELECT id, name, recipe_type, note,
             (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
      FROM recipes WHERE id = NEW.recipe_id;
      UPDATE recipes SET total_cost = (
        SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
      ) WHERE id = NEW.recipe_id;
    END;`);

    db.run(`DROP TRIGGER IF EXISTS ri_ad`);
    db.run(`CREATE TRIGGER ri_ad AFTER DELETE ON recipe_ingredients BEGIN
      DELETE FROM recipes_fts WHERE rowid = OLD.recipe_id;
      INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
      SELECT id, name, recipe_type, note,
             (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
      FROM recipes WHERE id = OLD.recipe_id;
      UPDATE recipes SET total_cost = (
        SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
      ) WHERE id = OLD.recipe_id;
    END;`);

    db.run(`DROP TRIGGER IF EXISTS ri_au`);
    db.run(`CREATE TRIGGER ri_au AFTER UPDATE ON recipe_ingredients BEGIN
      -- Optimized: Only delete/insert for affected recipes
      DELETE FROM recipes_fts WHERE rowid IN (NEW.recipe_id, OLD.recipe_id);
      INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
      SELECT id, name, recipe_type, note,
             (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
      FROM recipes WHERE id IN (NEW.recipe_id, OLD.recipe_id);
      UPDATE recipes SET total_cost = (
        SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
      ) WHERE id IN (NEW.recipe_id, OLD.recipe_id);
    END;`);

    // Ingredients Automation
    db.run(`DROP TRIGGER IF EXISTS ing_name_au`);
    db.run(`CREATE TRIGGER IF NOT EXISTS ing_name_au AFTER UPDATE OF name ON ingredients BEGIN
      DELETE FROM recipes_fts WHERE rowid IN (SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = NEW.id);
      INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
      SELECT r.id, r.name, r.recipe_type, r.note,
             (SELECT GROUP_CONCAT(i2.name, '|') FROM recipe_ingredients ri2 JOIN ingredients i2 ON ri2.ingredient_id = i2.id WHERE ri2.recipe_id = r.id)
      FROM recipes r JOIN recipe_ingredients ri ON r.id = ri.recipe_id WHERE ri.ingredient_id = NEW.id;
    END;`);

    db.run(`DROP TRIGGER IF EXISTS ing_price_au`);
    db.run(`CREATE TRIGGER IF NOT EXISTS ing_price_au AFTER UPDATE OF unit_price ON ingredients BEGIN
      UPDATE recipes SET total_cost = (
        SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
      ) WHERE id IN (SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = NEW.id);
    END;`);

    // 15. Tạo INDEX để tối ưu hóa truy vấn khi dữ liệu lớn
    // Tối ưu lọc nguyên liệu và công thức theo trạng thái/loại
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_ingredients_active ON ingredients(is_active, type)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_recipes_active ON recipes(is_active, recipe_type)",
    );

    // Tối ưu lọc đơn hàng theo ngày giao và trạng thái (dùng rất nhiều ở Dashboard/Thống kê)
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_date, status)",
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)");
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)",
    );

    // Tối ưu truy vấn tồn kho và định mức
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_inventory_ingredient ON inventory_batches(ingredient_id, qty_remaining)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_recipe_ing_lookup ON recipe_ingredients(ingredient_id)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_menu_recipes_lookup ON menu_recipes(menu_item_id)",
    );

    db.get("SELECT version FROM schema_version LIMIT 1", (err, row) => {
      if (!row) {
        db.run("DELETE FROM schema_version");
        db.run("INSERT INTO schema_version (version) VALUES (16)");
      }
    });

    // Seed default data after all tables are created
    seedDefaultData();
  });
};

/**
 * Populates the database with default categories if empty.
 * Returns a Promise to ensure it completes before migration runs.
 * @returns {Promise<void>}
 */
const seedDefaultData = () => {
  return new Promise((resolve) => {
    db.get("SELECT COUNT(*) as count FROM knowledge_categories", (err, row) => {
      if (row && row.count === 0) {
        const categories = [
          ["Nguyên Liệu Cốt Lõi", "#ffe9db", "#bc5a1a"],
          ["Chất Lên Men & Nở", "#e3f5e9", "#277c44"],
          ["Kỹ Thuật & Quy Trình", "#e0f2fe", "#0369a1"],
          ["Giải Mã Sự Cố", "#fce7f3", "#9d174d"],
        ];

        const stmt = db.prepare(
          "INSERT INTO knowledge_categories (name, bg_color, text_color) VALUES (?, ?, ?)",
        );
        categories.forEach((cat) => stmt.run(cat));
        stmt.finalize((finalErr) => {
          if (finalErr) {
            console.error("❌ Error seeding default data:", finalErr.message);
          } else {
            console.log("🌱 Dữ liệu: Đã khởi tạo danh mục mặc định.");
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
};
/**
 * Handles schema migrations to ensure existing databases are up to date without data loss.
 * @returns {Promise<void>}
 */
async function upgradeDatabase() {
  await createBackup();

  let needsVacuum = false;
  try {
    await dbManager.run(
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`,
    );
    let currentVersionRow = await dbManager.get(
      "SELECT MAX(version) as version FROM schema_version",
    );
    let currentVersion =
      currentVersionRow && currentVersionRow.version
        ? currentVersionRow.version
        : 0;

    const ftsCols = await dbManager.all("PRAGMA table_info(recipes_fts)");
    const ftsSchema = await dbManager.get(
      "SELECT sql FROM sqlite_master WHERE name='recipes_fts'",
    );
    const hasIngredients = ftsCols
      ? ftsCols.some((c) => c.name === "ingredients")
      : false;
    const isExternalContent =
      ftsSchema && ftsSchema.sql.toLowerCase().includes("content=");

    if (
      currentVersion >= 10 &&
      (!ftsCols ||
        ftsCols.length === 0 ||
        !hasIngredients ||
        isExternalContent ||
        !ftsSchema)
    ) {
      console.warn(
        "⚠️ Cấu trúc tìm kiếm lỗi hoặc thiếu Trigger. Đang khôi phục triệt để...",
      );
      const triggersToDrop = [
        "recipes_ai",
        "recipes_ad",
        "recipes_au",
        "ri_ai",
        "ri_ad",
        "ri_au",
        "ing_name_au",
        "ing_price_au",
      ];
      for (const t of triggersToDrop)
        await dbManager.run(`DROP TRIGGER IF EXISTS ${t}`);

      await dbManager.run("DROP TABLE IF EXISTS recipes_fts");
      await dbManager.run("DROP TABLE IF EXISTS customers_fts");
      currentVersion = 9;
    }

    console.log(`🚀 DB Schema Version hiện tại: ${currentVersion}`);
    if (currentVersion > 0) sendStatusToUI(`Phiên bản CSDL: ${currentVersion}`);

    if (currentVersion < 1) {
      const columns = await dbManager.all("PRAGMA table_info(recipes)");
      if (!columns.some((col) => col.name === "recipe_type")) {
        await dbManager.run(
          "ALTER TABLE recipes ADD COLUMN recipe_type TEXT DEFAULT 'general'",
        );
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (1)");
      currentVersion = 1;
      needsVacuum = true;
    }

    // Migration 2: Add selling_price to menu_items
    if (currentVersion < 2) {
      const columns = await dbManager.all("PRAGMA table_info(menu_items)");
      if (!columns.some((col) => col.name === "selling_price")) {
        await dbManager.run(
          "ALTER TABLE menu_items ADD COLUMN selling_price REAL DEFAULT 0",
        );
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (2)");
      currentVersion = 2;
      needsVacuum = true;
    }

    // Migration 3 & 4: menu_fillings table and price column
    if (currentVersion < 4) {
      await dbManager.run(`CREATE TABLE IF NOT EXISTS menu_fillings (
        menu_item_id INTEGER, recipe_id INTEGER, price REAL DEFAULT 0, is_default INTEGER DEFAULT 0,
        PRIMARY KEY (menu_item_id, recipe_id),
        FOREIGN KEY(menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id)
      )`);
      const columns = await dbManager.all("PRAGMA table_info(menu_fillings)");
      if (!columns.some((col) => col.name === "price")) {
        await dbManager.run(
          "ALTER TABLE menu_fillings ADD COLUMN price REAL DEFAULT 0",
        );
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (4)");
      currentVersion = 4;
      needsVacuum = true;
    }

    // Migration 5: purchase_price in inventory_batches
    if (currentVersion < 5) {
      const columns = await dbManager.all(
        "PRAGMA table_info(inventory_batches)",
      );
      if (!columns.some((col) => col.name === "purchase_price")) {
        await dbManager.run(
          "ALTER TABLE inventory_batches ADD COLUMN purchase_price REAL DEFAULT 0",
        );
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (5)");
      currentVersion = 5;
      needsVacuum = true;
    }

    // Migration 6: RECREATE Recipes table to change output_text -> output (INTEGER)
    if (currentVersion < 6) {
      console.log(
        "🔧 Migration 6: Chuẩn hóa bảng 'recipes' (output_text -> output)...",
      );
      const columns = await dbManager.all("PRAGMA table_info(recipes)");
      const hasOutputText = columns.some((col) => col.name === "output_text");
      const hasStepsJson = columns.some((col) => col.name === "steps_json");

      if (hasOutputText) {
        await dbManager.run("PRAGMA foreign_keys=OFF");
        await dbManager.run(`CREATE TABLE recipes_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          cook_time INTEGER,
          output INTEGER DEFAULT 1,
          steps_json TEXT,
          recipe_type TEXT DEFAULT 'general',
          note TEXT,
          is_active INTEGER DEFAULT 1
        )`);

        await dbManager.run(`INSERT INTO recipes_new (id, name, cook_time, output, ${hasStepsJson ? "steps_json, " : ""}recipe_type, note, is_active)
          SELECT id, name, cook_time,
            CASE
              WHEN CAST(CAST(output_text AS INTEGER) AS TEXT) = output_text AND CAST(output_text AS INTEGER) > 0 THEN CAST(output_text AS INTEGER)
              ELSE 1
            END,
            ${hasStepsJson ? "steps_json, " : ""}recipe_type,
            CASE
              WHEN output_text IS NOT NULL AND CAST(CAST(output_text AS INTEGER) AS TEXT) != output_text
              THEN TRIM(output_text || ' ' || COALESCE(note, ''))
              ELSE note
            END,
            is_active
          FROM recipes`);

        await dbManager.run("DROP TABLE recipes");
        await dbManager.run("ALTER TABLE recipes_new RENAME TO recipes");
        await dbManager.run("PRAGMA foreign_keys=ON");
      }

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (6)");
      currentVersion = 6;
      needsVacuum = true;
      sendStatusToUI("Đã cập nhật cấu trúc bảng Recipes thành công.");
      console.log("✅ Migration 6 thành công.");
    }

    // Migration 7: Thêm Index cho bảng khách hàng và đơn hàng để tối ưu tìm kiếm và lọc
    if (currentVersion < 7) {
      console.log(
        "🔧 Migration 7: Tạo Index bổ sung cho tìm kiếm và đếm tổng...",
      );
      await dbManager.run(
        "CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE)",
      );
      await dbManager.run(
        "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)",
      );
      await dbManager.run(
        "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)",
      );

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (7)");
      currentVersion = 7;
      needsVacuum = true;
      console.log("✅ Migration 7 thành công.");
    }

    // Migration 8: Sử dụng FTS5 để tối ưu tìm kiếm khách hàng (Search Engine nội bộ)
    if (currentVersion < 8) {
      console.log("🔧 Migration 8: Khởi tạo Full-Text Search cho Customers...");

      // Tạo bảng ảo FTS5 (không lưu dữ liệu gốc, chỉ lưu chỉ mục tìm kiếm)
      await dbManager.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS customers_fts USING fts5(
          name,
          phone,
          tokenize='unicode61 remove_diacritics 1'
        )
      `);

      // Đổ dữ liệu hiện tại vào bảng FTS và tạo Triggers đồng bộ tự động
      await dbManager.run(`
        INSERT INTO customers_fts(rowid, name, phone)
        SELECT id, name, phone FROM customers
      `);

      // Trigger khi thêm khách hàng mới
      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS customers_ai AFTER INSERT ON customers BEGIN
          INSERT INTO customers_fts(rowid, name, phone) VALUES (new.id, new.name, new.phone);
        END;
      `);

      // Trigger khi xóa khách hàng (Xử lý cho cả xóa vật lý)
      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS customers_ad AFTER DELETE ON customers BEGIN
          DELETE FROM customers_fts WHERE rowid = OLD.id;
        END;
      `);

      // Trigger khi cập nhật thông tin khách hàng
      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS customers_au AFTER UPDATE ON customers BEGIN
          DELETE FROM customers_fts WHERE rowid = OLD.id;
          INSERT INTO customers_fts(rowid, name, phone) VALUES (new.id, new.name, new.phone);
        END;
      `);

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (8)");
      currentVersion = 8;
      needsVacuum = true;
      console.log("✅ Migration 8 thành công.");
    }

    // Migration 9: Sử dụng FTS5 để tối ưu tìm kiếm Công thức (Recipes)
    if (currentVersion < 9) {
      console.log("🔧 Migration 9: Khởi tạo Full-Text Search cho Recipes...");

      // 1. Tạo bảng ảo FTS5 cho Recipes
      await dbManager.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
          name,
          recipe_type,
          note,
          tokenize='unicode61 remove_diacritics 1'
        )
      `);

      // 2. Đồng bộ dữ liệu hiện tại
      await dbManager.run(`
        INSERT INTO recipes_fts(rowid, name, recipe_type, note)
        SELECT id, name, recipe_type, note FROM recipes
      `);

      // 3. Tạo Triggers đồng bộ tự động
      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS recipes_ai AFTER INSERT ON recipes BEGIN
          INSERT INTO recipes_fts(rowid, name, recipe_type, note) VALUES (new.id, new.name, new.recipe_type, new.note);
        END;
      `);

      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS recipes_ad AFTER DELETE ON recipes BEGIN
          DELETE FROM recipes_fts WHERE rowid = OLD.id;
        END;
      `);

      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS recipes_au AFTER UPDATE ON recipes BEGIN
          DELETE FROM recipes_fts WHERE rowid = OLD.id;
          INSERT INTO recipes_fts(rowid, name, recipe_type, note) VALUES (new.id, new.name, new.recipe_type, new.note);
        END;
      `);

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (9)");
      currentVersion = 9;
      needsVacuum = true;
      console.log("✅ Migration 9 thành công.");
    }

    // Migration 10: Nâng cấp FTS cho Recipes để hỗ trợ tìm kiếm theo nguyên liệu
    if (currentVersion < 10) {
      console.log(
        "🔧 Migration 10: Mở rộng Full-Text Search cho Recipes (bao gồm nguyên liệu)...",
      );

      // 1. Xóa bảng ảo cũ để tạo bảng mới có cột ingredients
      await dbManager.run("DROP TABLE IF EXISTS recipes_fts");
      await dbManager.run(`
        CREATE VIRTUAL TABLE recipes_fts USING fts5(
          name,
          recipe_type,
          note,
          ingredients, -- Cột mới để lưu danh sách tên nguyên liệu
          tokenize='unicode61 remove_diacritics 1'
        )
      `);

      // 2. Đồng bộ dữ liệu hiện tại (kèm theo nối chuỗi tên nguyên liệu)
      await dbManager.run(`
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT r.id, r.name, r.recipe_type, r.note,
               (SELECT GROUP_CONCAT(i.name, '|')
                FROM recipe_ingredients ri
                JOIN ingredients i ON ri.ingredient_id = i.id
                WHERE ri.recipe_id = r.id)
        FROM recipes r
      `);

      // 3. Cập nhật các Trigger hiện có của bảng recipes để bao gồm cột ingredients
      await dbManager.run("DROP TRIGGER IF EXISTS recipes_ai");
      await dbManager.run("DROP TRIGGER IF EXISTS recipes_au");
      await dbManager.run("DROP TRIGGER IF EXISTS recipes_ad");

      await dbManager.run(`
        CREATE TRIGGER recipes_ai AFTER INSERT ON recipes BEGIN
          INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients) VALUES (new.id, new.name, new.recipe_type, new.note, '');
        END;
      `);

      await dbManager.run(`
        CREATE TRIGGER recipes_ad AFTER DELETE ON recipes BEGIN
          DELETE FROM recipes_fts WHERE rowid = OLD.id;
        END;
      `);

      await dbManager.run(`
        CREATE TRIGGER recipes_au AFTER UPDATE ON recipes BEGIN
          DELETE FROM recipes_fts WHERE rowid = OLD.id;
          INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
          SELECT id, name, recipe_type, note,
                 (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
          FROM recipes WHERE id = new.id;
        END;
      `);

      // 4. Tạo các Trigger mới trên bảng recipe_ingredients để cập nhật FTS khi thành phần thay đổi
      await dbManager.run(`CREATE TRIGGER IF NOT EXISTS ri_ai AFTER INSERT ON recipe_ingredients BEGIN
        DELETE FROM recipes_fts WHERE rowid = NEW.recipe_id;
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT id, name, recipe_type, note,
               (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
        FROM recipes WHERE id = new.recipe_id;
      END;`);

      await dbManager.run(`CREATE TRIGGER IF NOT EXISTS ri_ad AFTER DELETE ON recipe_ingredients BEGIN
        DELETE FROM recipes_fts WHERE rowid = OLD.recipe_id;
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT id, name, recipe_type, note,
               (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
        FROM recipes WHERE id = old.recipe_id;
      END;`);

      await dbManager.run(`CREATE TRIGGER IF NOT EXISTS ri_au AFTER UPDATE ON recipe_ingredients BEGIN
        DELETE FROM recipes_fts WHERE rowid = OLD.recipe_id;
        DELETE FROM recipes_fts WHERE rowid = NEW.recipe_id;
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT id, name, recipe_type, note,
               (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
        FROM recipes WHERE id = new.recipe_id;
      END;`);

      // 5. Tạo Trigger trên bảng ingredients để cập nhật FTS khi đổi tên nguyên liệu
      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS ing_name_au AFTER UPDATE OF name ON ingredients BEGIN
          DELETE FROM recipes_fts
          WHERE rowid IN (SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = NEW.id);

          INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
          SELECT r.id, r.name, r.recipe_type, r.note,
                 (SELECT GROUP_CONCAT(i2.name, '|') FROM recipe_ingredients ri2 JOIN ingredients i2 ON ri2.ingredient_id = i2.id WHERE ri2.recipe_id = r.id)
          FROM recipes r JOIN recipe_ingredients ri ON r.id = ri.recipe_id WHERE ri.ingredient_id = new.id;
        END;
      `);

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (10)");
      currentVersion = 10;
      needsVacuum = true;
      console.log(
        "✅ Migration 10 thành công: Đã hỗ trợ tìm kiếm theo nguyên liệu.",
      );
    }

    // Migration 11: Tối ưu hóa tính toán giá vốn (total_cost) bằng Triggers
    if (currentVersion < 11) {
      console.log("🔧 Migration 11: Đang tối ưu hóa logic cập nhật giá vốn...");

      // 1. Thêm cột total_cost vào bảng recipes nếu chưa có
      const columns = await dbManager.all("PRAGMA table_info(recipes)");
      if (!columns.some((col) => col.name === "total_cost")) {
        await dbManager.run(
          "ALTER TABLE recipes ADD COLUMN total_cost REAL DEFAULT 0",
        );
      }

      // 2. Cập nhật giá vốn hiện tại cho tất cả công thức
      await dbManager.run(`
        UPDATE recipes SET total_cost = (
          SELECT COALESCE(SUM(ri.qty * i.unit_price), 0)
          FROM recipe_ingredients ri
          JOIN ingredients i ON ri.ingredient_id = i.id
          WHERE ri.recipe_id = recipes.id
        )
      `);

      // 3. Trigger: Khi giá nguyên liệu (unit_price) thay đổi -> Cập nhật giá các công thức liên quan
      await dbManager.run("DROP TRIGGER IF EXISTS ing_price_au");
      await dbManager.run(`
        CREATE TRIGGER IF NOT EXISTS ing_price_au AFTER UPDATE OF unit_price ON ingredients BEGIN
          UPDATE recipes SET total_cost = (
            SELECT COALESCE(SUM(ri.qty * i.unit_price), 0)
            FROM recipe_ingredients ri
            JOIN ingredients i ON ri.ingredient_id = i.id
            WHERE ri.recipe_id = recipes.id
          ) WHERE id IN (SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = new.id);
        END;
      `);

      // 4. Đồng bộ lại tất cả trigger trên recipe_ingredients để bao gồm cả total_cost
      await dbManager.run("DROP TRIGGER IF EXISTS ri_ai");
      await dbManager.run("DROP TRIGGER IF EXISTS ri_ad");
      await dbManager.run("DROP TRIGGER IF EXISTS ri_au");
      await dbManager.run("DROP TRIGGER IF EXISTS ri_total_cost_update");

      await dbManager.run(`CREATE TRIGGER ri_ai AFTER INSERT ON recipe_ingredients BEGIN
        DELETE FROM recipes_fts WHERE rowid = NEW.recipe_id;
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT id, name, recipe_type, note, (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
        FROM recipes WHERE id = NEW.recipe_id;
        UPDATE recipes SET total_cost = (
          SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
        ) WHERE id = NEW.recipe_id;
      END;`);

      await dbManager.run(`CREATE TRIGGER ri_ad AFTER DELETE ON recipe_ingredients BEGIN
        DELETE FROM recipes_fts WHERE rowid = OLD.recipe_id;
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT id, name, recipe_type, note, (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
        FROM recipes WHERE id = OLD.recipe_id;
        UPDATE recipes SET total_cost = (
          SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
        ) WHERE id = OLD.recipe_id;
      END;`);

      await dbManager.run(`CREATE TRIGGER ri_au AFTER UPDATE ON recipe_ingredients BEGIN
        -- Optimized: Merge DELETE operations and use IN clause
        DELETE FROM recipes_fts WHERE rowid IN (NEW.recipe_id, OLD.recipe_id);
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT id, name, recipe_type, note, (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = id)
        FROM recipes WHERE id IN (NEW.recipe_id, OLD.recipe_id);
        UPDATE recipes SET total_cost = (
          SELECT COALESCE(SUM(ri.qty * i.unit_price), 0) FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = recipes.id
        ) WHERE id IN (NEW.recipe_id, OLD.recipe_id);
      END;`);

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (11)");
      currentVersion = 11;
      needsVacuum = true;
      console.log("✅ Migration 11 thành công.");
    }

    // Migration 12: Thêm cột qty vào menu_fillings để quản lý tỉ lệ nhân cho món combo/hộp
    if (currentVersion < 12) {
      const columns = await dbManager.all("PRAGMA table_info(menu_fillings)");
      if (!columns.some((col) => col.name === "qty")) {
        await dbManager.run(
          "ALTER TABLE menu_fillings ADD COLUMN qty REAL DEFAULT 1",
        );
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (12)");
      currentVersion = 12;
      needsVacuum = true;
    }

    // Migration 13: Làm sạch và chuẩn hóa lại bộ nạp tìm kiếm (FTS Tokenizer)
    if (currentVersion < 13) {
      console.log("🔧 Migration 13: Chuẩn hóa bộ lọc tìm kiếm không dấu...");

      // Xóa và tạo lại bảng FTS với tokenizer đơn giản (mặc định unicode61 đã khử dấu rất tốt)
      await dbManager.run("DROP TABLE IF EXISTS recipes_fts");
      await dbManager.run(`CREATE VIRTUAL TABLE recipes_fts USING fts5(
        name, recipe_type, note, ingredients, tokenize='unicode61'
      )`);

      await dbManager.run("DROP TABLE IF EXISTS customers_fts");
      await dbManager.run(`CREATE VIRTUAL TABLE customers_fts USING fts5(
        name, phone, tokenize='unicode61'
      )`);

      // Đồng bộ lại dữ liệu
      await dbManager.run(`
        INSERT INTO recipes_fts(rowid, name, recipe_type, note, ingredients)
        SELECT r.id, r.name, r.recipe_type, r.note,
               (SELECT GROUP_CONCAT(i.name, '|') FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = r.id)
        FROM recipes r
      `);

      await dbManager.run(`
        INSERT INTO customers_fts(rowid, name, phone)
        SELECT id, name, phone FROM customers
      `);

      // Cập nhật các Trigger liên quan để đảm bảo luôn dùng đúng bảng mới
      // Các trigger này sẽ được initDB khởi tạo lại ở lần chạy sau hoặc ta có thể gọi lại initDB
      // Ở đây ta chỉ cần đảm bảo Version nhảy lên để DB Manager biết đã hoàn tất

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (13)");
      currentVersion = 13;
      needsVacuum = true;
      console.log("✅ Migration 13 thành công.");
    }

    // Migration 14: Bổ sung cột lưu đường dẫn ảnh đại diện cho công thức
    if (currentVersion < 14) {
      console.log(
        "🔧 Migration 14: Kiểm tra và bổ sung cột image_path cho bảng recipes...",
      );
      const columns = await dbManager.all("PRAGMA table_info(recipes)");
      if (!columns.some((col) => col.name === "image_path")) {
        await dbManager.run("ALTER TABLE recipes ADD COLUMN image_path TEXT");
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (14)");
      currentVersion = 14;
      needsVacuum = true;
      console.log("✅ Migration 14 thành công.");
    }

    // Migration 15: Đảm bảo cột steps_json luôn tồn tại (Phòng trường hợp bị mất trong các bản cũ)
    if (currentVersion < 15) {
      console.log(
        "🔧 Migration 15: Kiểm tra cột steps_json cho bảng recipes...",
      );
      const columns = await dbManager.all("PRAGMA table_info(recipes)");
      if (!columns.some((col) => col.name === "steps_json")) {
        await dbManager.run("ALTER TABLE recipes ADD COLUMN steps_json TEXT");
      }
      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (15)");
      currentVersion = 15;
      console.log("✅ Migration 15 thành công.");
    }

    // Migration 16: Thêm cột type và sub_recipe_id vào bảng recipe_ingredients
    if (currentVersion < 16) {
      console.log(
        "🔧 Migration 16: Cập nhật cấu trúc bảng recipe_ingredients...",
      );
      const columns = await dbManager.all(
        "PRAGMA table_info(recipe_ingredients)",
      );

      if (!columns.some((col) => col.name === "type")) {
        await dbManager.run(
          "ALTER TABLE recipe_ingredients ADD COLUMN type TEXT DEFAULT 'ingredient'",
        );
      }
      if (!columns.some((col) => col.name === "sub_recipe_id")) {
        await dbManager.run(
          "ALTER TABLE recipe_ingredients ADD COLUMN sub_recipe_id INTEGER",
        );
      }

      await dbManager.run("DELETE FROM schema_version");
      await dbManager.run("INSERT INTO schema_version (version) VALUES (16)");
      currentVersion = 16;
      needsVacuum = true;
      console.log("✅ Migration 16 thành công.");
    }

    if (needsVacuum) {
      console.log(
        "🧹 Đang tối ưu hóa dung lượng file cơ sở dữ liệu (VACUUM)...",
      );
      sendStatusToUI(
        "Đang nén và tối ưu hóa cơ sở dữ liệu. Vui lòng đợi...",
        "loading",
      );
      await dbManager.run("VACUUM");
      sendStatusToUI("Tối ưu hóa dữ liệu hoàn tất!", "success");
      console.log("✨ Đã tối ưu hóa xong.");
    }

    console.log(`Database schema is up to date (Version: ${currentVersion}).`);
  } catch (error) {
    console.error("❌ Lỗi trong quá trình nâng cấp CSDL:", error.message);
  }
}

/**
 * Orchestrates the full database setup process (Connect -> Init -> Upgrade).
 * @returns {Promise<void>}
 */
const setupDatabase = async () => {
  try {
    await connectDB();
    await initDB();
    await upgradeDatabase();
  } catch (err) {
    console.error("❌ Lỗi khởi tạo CSDL tổng thể:", err);
    throw err;
  }
};

module.exports = {
  setupDatabase,
  getDb: () => db,
  query: dbManager.all,
  get: dbManager.get,
  run: dbManager.run,
  dbManager,
  setMainWindow,
};
