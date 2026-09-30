-- ============================================================
--  进销存系统 —— Cloudflare D1 建表脚本
--
--  由 backend/inventory.db 的 SQLite schema 移植而来（25 表 / 34 索引）
--
--  类型映射（D1 就是 SQLite，这里按 SQLite 的实际存储归一）：
--     VARCHAR(n)      -> TEXT
--     DATETIME/DATE   -> TEXT   （'YYYY-MM-DD HH:MM:SS.ffffff'，与 SQLAlchemy 写入格式一致）
--     NUMERIC(x, y)   -> REAL   （后端代码全部 float() 消费，无 Decimal 依赖）
--     INTEGER         -> INTEGER
--
--  执行：
--    wrangler d1 execute inventory --file=cf/schema.sql --remote
-- ============================================================

-- ---------- 权限 / 角色 ----------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  module     TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id)       REFERENCES roles (id),
  FOREIGN KEY (permission_id) REFERENCES permissions (id)
);

-- ---------- 用户 ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  phone         TEXT,
  role_id       INTEGER,
  status        INTEGER DEFAULT 1,
  created_at    TEXT,
  updated_at    TEXT,
  FOREIGN KEY (role_id) REFERENCES roles (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);

-- ---------- 基础资料 ----------
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  INTEGER,
  sort_order INTEGER,
  status     INTEGER DEFAULT 1,
  created_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES categories (id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  contact     TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  bank_name   TEXT,
  bank_account TEXT,
  tax_number  TEXT,
  status      INTEGER DEFAULT 1,
  remark      TEXT,
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  contact      TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  credit_limit INTEGER DEFAULT 0,
  bank_name    TEXT,
  bank_account TEXT,
  tax_number   TEXT,
  status       INTEGER DEFAULT 1,
  remark       TEXT,
  created_at   TEXT,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS warehouses (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  manager    TEXT,
  phone      TEXT,
  status     INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  category_id     INTEGER,
  sku             TEXT,
  barcode         TEXT,
  unit            TEXT NOT NULL,
  sub_unit        TEXT,
  sub_unit_ratio  REAL,
  spec            TEXT,
  color           TEXT,
  size            TEXT,
  weight          TEXT,
  purchase_price  REAL,
  sale_price      REAL,
  min_stock       INTEGER DEFAULT 0,
  image_url       TEXT,
  status          INTEGER DEFAULT 1,
  remark          TEXT,
  created_at      TEXT,
  updated_at      TEXT,
  FOREIGN KEY (category_id) REFERENCES categories (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_products_sku ON products (sku);

-- ---------- 库存 ----------
CREATE TABLE IF NOT EXISTS inventory (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER,
  warehouse_id INTEGER,
  quantity     INTEGER DEFAULT 0,
  updated_at   TEXT,
  CONSTRAINT uq_product_warehouse UNIQUE (product_id, warehouse_id),
  FOREIGN KEY (product_id)   REFERENCES products (id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
);

-- ---------- 采购 ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id               INTEGER PRIMARY KEY,
  order_no         TEXT NOT NULL,
  supplier_id      INTEGER,
  purchase_date    TEXT,
  warehouse_id     INTEGER,
  buyer            TEXT,
  expected_date    TEXT,
  payment_method   TEXT,
  payment_terms    TEXT,
  currency         TEXT DEFAULT 'CNY',
  exchange_rate    REAL DEFAULT 1,
  tax_amount       REAL DEFAULT 0,
  freight          REAL DEFAULT 0,
  total_amount     REAL DEFAULT 0,
  status           INTEGER DEFAULT 0,
  approve_by       INTEGER,
  approve_at       TEXT,
  delivery_address TEXT,
  invoice_no       TEXT,
  remark           TEXT,
  created_by       INTEGER,
  created_at       TEXT,
  updated_at       TEXT,
  FOREIGN KEY (supplier_id)  REFERENCES suppliers (id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  FOREIGN KEY (approve_by)   REFERENCES users (id),
  FOREIGN KEY (created_by)   REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_purchase_orders_order_no ON purchase_orders (order_no);

CREATE TABLE IF NOT EXISTS purchase_items (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER,
  product_id        INTEGER,
  quantity          INTEGER NOT NULL,
  price             REAL NOT NULL,
  tax_rate          REAL DEFAULT 0,
  amount            REAL NOT NULL,
  received_quantity INTEGER DEFAULT 0,
  remark            TEXT,
  created_at        TEXT,
  FOREIGN KEY (order_id)   REFERENCES purchase_orders (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id                INTEGER PRIMARY KEY,
  return_no         TEXT NOT NULL,
  purchase_order_id INTEGER,
  supplier_id       INTEGER,
  total_amount      REAL DEFAULT 0,
  status            INTEGER DEFAULT 0,
  reason            TEXT,
  remark            TEXT,
  created_by        INTEGER,
  created_at        TEXT,
  updated_at        TEXT,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id),
  FOREIGN KEY (supplier_id)       REFERENCES suppliers (id),
  FOREIGN KEY (created_by)        REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_purchase_returns_return_no ON purchase_returns (return_no);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id         INTEGER PRIMARY KEY,
  return_id  INTEGER,
  product_id INTEGER,
  quantity   INTEGER NOT NULL,
  price      REAL NOT NULL,
  amount     REAL NOT NULL,
  created_at TEXT,
  FOREIGN KEY (return_id)  REFERENCES purchase_returns (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

-- ---------- 销售 ----------
CREATE TABLE IF NOT EXISTS sales_orders (
  id               INTEGER PRIMARY KEY,
  order_no         TEXT NOT NULL,
  customer_id      INTEGER,
  sale_date        TEXT,
  warehouse_id     INTEGER,
  seller           TEXT,
  delivery_date    TEXT,
  payment_method   TEXT,
  payment_terms    TEXT,
  currency         TEXT DEFAULT 'CNY',
  exchange_rate    REAL DEFAULT 1,
  tax_amount       REAL DEFAULT 0,
  freight          REAL DEFAULT 0,
  total_amount     REAL DEFAULT 0,
  status           INTEGER DEFAULT 0,
  approve_by       INTEGER,
  approve_at       TEXT,
  remark           TEXT,
  delivery_address TEXT,
  invoice_no       TEXT,
  created_by       INTEGER,
  created_at       TEXT,
  updated_at       TEXT,
  FOREIGN KEY (customer_id)  REFERENCES customers (id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  FOREIGN KEY (approve_by)   REFERENCES users (id),
  FOREIGN KEY (created_by)   REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_sales_orders_order_no ON sales_orders (order_no);

CREATE TABLE IF NOT EXISTS sales_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER,
  product_id       INTEGER,
  quantity         INTEGER NOT NULL,
  price            REAL NOT NULL,
  tax_rate         REAL DEFAULT 0,
  amount           REAL NOT NULL,
  shipped_quantity INTEGER DEFAULT 0,
  remark           TEXT,
  created_at       TEXT,
  FOREIGN KEY (order_id)   REFERENCES sales_orders (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id             INTEGER PRIMARY KEY,
  return_no      TEXT NOT NULL,
  sales_order_id INTEGER,
  customer_id    INTEGER,
  total_amount   REAL DEFAULT 0,
  status         INTEGER DEFAULT 0,
  reason         TEXT,
  remark         TEXT,
  created_by     INTEGER,
  created_at     TEXT,
  updated_at     TEXT,
  FOREIGN KEY (sales_order_id) REFERENCES sales_orders (id),
  FOREIGN KEY (customer_id)    REFERENCES customers (id),
  FOREIGN KEY (created_by)     REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_sale_returns_return_no ON sale_returns (return_no);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id         INTEGER PRIMARY KEY,
  return_id  INTEGER,
  product_id INTEGER,
  quantity   INTEGER NOT NULL,
  price      REAL NOT NULL,
  amount     REAL NOT NULL,
  created_at TEXT,
  FOREIGN KEY (return_id)  REFERENCES sale_returns (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

-- ---------- 收付款 ----------
CREATE TABLE IF NOT EXISTS payments (
  id               INTEGER PRIMARY KEY,
  payment_no       TEXT NOT NULL,
  type             INTEGER NOT NULL,
  related_type     TEXT,
  related_id       INTEGER,
  partner_type     TEXT,
  partner_id       INTEGER NOT NULL,
  amount           REAL NOT NULL,
  payment_method   TEXT,
  voucher_no       TEXT,
  voucher_date     TEXT,
  period           TEXT,
  summary          TEXT,
  attachment_count INTEGER DEFAULT 0,
  debit_account    TEXT,
  credit_account   TEXT,
  remark           TEXT,
  created_by       INTEGER,
  created_at       TEXT,
  FOREIGN KEY (created_by) REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_payment_no ON payments (payment_no);
CREATE INDEX IF NOT EXISTS ix_payments_voucher_no ON payments (voucher_no);

-- ---------- 库存流水 / 调拨 / 盘点 ----------
CREATE TABLE IF NOT EXISTS stock_logs (
  id              INTEGER PRIMARY KEY,
  product_id      INTEGER,
  warehouse_id    INTEGER,
  type            TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  before_quantity INTEGER DEFAULT 0,
  after_quantity  INTEGER DEFAULT 0,
  related_type    TEXT,
  related_id      INTEGER,
  related_no      TEXT,
  remark          TEXT,
  created_at      TEXT,
  FOREIGN KEY (product_id)   REFERENCES products (id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                INTEGER PRIMARY KEY,
  transfer_no       TEXT NOT NULL,
  from_warehouse_id INTEGER,
  to_warehouse_id   INTEGER,
  status            INTEGER DEFAULT 0,
  remark            TEXT,
  created_by        INTEGER,
  created_at        TEXT,
  updated_at        TEXT,
  FOREIGN KEY (from_warehouse_id) REFERENCES warehouses (id),
  FOREIGN KEY (to_warehouse_id)   REFERENCES warehouses (id),
  FOREIGN KEY (created_by)        REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_stock_transfers_transfer_no ON stock_transfers (transfer_no);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id          INTEGER PRIMARY KEY,
  transfer_id INTEGER,
  product_id  INTEGER,
  quantity    INTEGER NOT NULL,
  created_at  TEXT,
  FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id),
  FOREIGN KEY (product_id)  REFERENCES products (id)
);

CREATE TABLE IF NOT EXISTS stock_checks (
  id           INTEGER PRIMARY KEY,
  check_no     TEXT NOT NULL,
  warehouse_id INTEGER,
  status       INTEGER DEFAULT 0,
  remark       TEXT,
  created_by   INTEGER,
  created_at   TEXT,
  updated_at   TEXT,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  FOREIGN KEY (created_by)   REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_stock_checks_check_no ON stock_checks (check_no);

CREATE TABLE IF NOT EXISTS stock_check_items (
  id              INTEGER PRIMARY KEY,
  check_id        INTEGER,
  product_id      INTEGER,
  system_quantity INTEGER DEFAULT 0,
  actual_quantity INTEGER DEFAULT 0,
  diff            INTEGER DEFAULT 0,
  created_at      TEXT,
  FOREIGN KEY (check_id)   REFERENCES stock_checks (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);

-- ---------- 操作日志 ----------
CREATE TABLE IF NOT EXISTS operation_logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  username   TEXT,
  module     TEXT,
  action     TEXT,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
