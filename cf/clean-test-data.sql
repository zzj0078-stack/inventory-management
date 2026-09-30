-- ============================================================
--  清理冒烟测试遗留数据（**逐条显式 ID，不用 LIKE 模糊匹配**）
--
--  背景：冒烟测试会在库里建 __冒烟测试* 数据。测试账号是 smoke_admin，
--  所以「测试数据 = created_by 2」这条判据与「名称前缀」互相印证，
--  两类数据完全重合 —— 真实单据的 created_by 都是 1（admin）。
--
--  ⚠️ 执行前务必先跑下面的「核对」查询，确认待删条数与预期一致。
--  ⚠️ D1 有 Time Travel（免费 7 天 / 付费 30 天），误删可在控制台回滚，
--     但仍请先核对再执行。
--
--  执行：
--    wrangler d1 execute inventory --file=cf/clean-test-data.sql --remote
-- ============================================================

-- ------------------------------------------------------------
--  核对：先看清楚「将删什么」和「将保留什么」
-- ------------------------------------------------------------
-- 将删（全部应为测试数据）：
--   SELECT COUNT(*) FROM sales_orders   WHERE created_by = 2;   -- 期望 1（SO...0001）
--   SELECT COUNT(*) FROM purchase_orders WHERE created_by = 2;  -- 期望 1（PO...0002）
--   SELECT COUNT(*) FROM payments       WHERE created_by = 2;   -- 期望 5
--   SELECT COUNT(*) FROM sale_returns   WHERE created_by = 2;   -- 期望 3
--   SELECT COUNT(*) FROM products   WHERE id IN (2);            -- 期望 1（__冒烟测试商品）
--   SELECT COUNT(*) FROM customers  WHERE id IN (2);            -- 期望 1
--   SELECT COUNT(*) FROM suppliers  WHERE id IN (2);            -- 期望 1
--   SELECT COUNT(*) FROM categories WHERE id IN (3);            -- 期望 1
--   SELECT COUNT(*) FROM warehouses WHERE id IN (2);            -- 期望 1
--   SELECT COUNT(*) FROM users WHERE id IN (2,3);               -- 期望 2
--   SELECT COUNT(*) FROM roles WHERE id IN (8);                 -- 期望 1
--
-- 将保留（真实数据，执行后必须条数不变）：
--   SELECT COUNT(*) FROM products       WHERE id = 1;   -- 400万半球
--   SELECT COUNT(*) FROM customers      WHERE id = 1;   -- 厦门硕明科技有限公司
--   SELECT COUNT(*) FROM suppliers      WHERE id = 1;   -- 厦门保盟科技有限公司
--   SELECT COUNT(*) FROM categories     WHERE id IN (1,2); -- 监控设备 / 网络设备
--   SELECT COUNT(*) FROM sales_orders   WHERE id = 2;   -- SO...0002 已发货 860
--   SELECT COUNT(*) FROM purchase_orders WHERE id = 1;   -- PO...0001 已收货
--   SELECT COUNT(*) FROM inventory      WHERE id = 1;   -- 400万半球 库存 8
--   SELECT COUNT(*) FROM users          WHERE id = 1;   -- admin
--   SELECT COUNT(*) FROM roles          WHERE id <= 7;  -- 7 个内置角色

-- ------------------------------------------------------------
--  1) 退货：明细 → 主单（created_by = 2 即测试账号创建）
-- ------------------------------------------------------------
DELETE FROM sale_return_items
 WHERE return_id IN (SELECT id FROM sale_returns WHERE created_by = 2);

DELETE FROM sale_returns WHERE created_by = 2;

DELETE FROM purchase_return_items
 WHERE return_id IN (SELECT id FROM purchase_returns WHERE created_by = 2);

DELETE FROM purchase_returns WHERE created_by = 2;

-- ------------------------------------------------------------
--  2) 盘点 / 调拨：明细 → 主单
-- ------------------------------------------------------------
DELETE FROM stock_check_items
 WHERE check_id IN (SELECT id FROM stock_checks WHERE created_by = 2);

DELETE FROM stock_checks WHERE created_by = 2;

DELETE FROM stock_transfer_items
 WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE created_by = 2);

DELETE FROM stock_transfers WHERE created_by = 2;

-- ------------------------------------------------------------
--  3) 收付款（测试的四象限凭证）
-- ------------------------------------------------------------
DELETE FROM payments WHERE created_by = 2;

-- ------------------------------------------------------------
--  4) 采购 / 销售：明细 → 主单
--     注意：真实单据 id=2(销售) 与 id=1(采购) 的 created_by 都是 1，不会命中
-- ------------------------------------------------------------
DELETE FROM sales_items
 WHERE order_id IN (SELECT id FROM sales_orders WHERE created_by = 2);

DELETE FROM sales_orders WHERE created_by = 2;

DELETE FROM purchase_items
 WHERE order_id IN (SELECT id FROM purchase_orders WHERE created_by = 2);

DELETE FROM purchase_orders WHERE created_by = 2;

-- ------------------------------------------------------------
--  5) 测试商品 / 测试仓库相关的库存与流水
--     真实商品 id=1 的流水（+10 采购入库、-2 销售出库）与库存（8）保留
-- ------------------------------------------------------------
DELETE FROM stock_logs WHERE product_id IN (2);
DELETE FROM stock_logs WHERE warehouse_id IN (2);
DELETE FROM inventory  WHERE product_id IN (2);
DELETE FROM inventory  WHERE warehouse_id IN (2);

-- ------------------------------------------------------------
--  6) 测试主数据（显式 ID）
-- ------------------------------------------------------------
DELETE FROM products   WHERE id IN (2);
DELETE FROM categories WHERE id IN (3);
DELETE FROM customers  WHERE id IN (2);
DELETE FROM suppliers  WHERE id IN (2);
DELETE FROM warehouses WHERE id IN (2);

-- ------------------------------------------------------------
--  7) 测试账号与角色（先删日志，否则外键挡住）
-- ------------------------------------------------------------
DELETE FROM operation_logs WHERE user_id IN (2, 3);
DELETE FROM operation_logs WHERE username IN ('smoke_admin', 'smoke_noperm');
DELETE FROM users WHERE id IN (2, 3);

DELETE FROM role_permissions WHERE role_id IN (8);
DELETE FROM roles WHERE id IN (8);
