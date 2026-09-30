-- ============================================================
--  ⚠️ 破坏性操作：清空全部业务数据
--
--  用途：验收/试录数据后想从干净状态重来。
--
--  会清空：商品、分类、客户、供应商、采购/销售单、收退货、
--          收付款、库存、库存流水、调拨、盘点、操作日志
--  会保留：角色、权限、角色权限关联、用户账号、仓库
--          （即 cf/seed.sql 建立的基础数据）
--
--  执行：
--    wrangler d1 execute inventory --file=cf/reset-business-data.sql --local
--    wrangler d1 execute inventory --file=cf/reset-business-data.sql --remote
--
--  注意：D1 强制外键，下面的顺序是「子表 → 父表」，改动顺序会整批回滚。
--        想要连用户/仓库一起重置，改用 cf/schema.sql + cf/seed.sql 重建。
-- ============================================================

-- ---------- 盘点 ----------
DELETE FROM stock_check_items;
DELETE FROM stock_checks;

-- ---------- 调拨 ----------
DELETE FROM stock_transfer_items;
DELETE FROM stock_transfers;

-- ---------- 销售退货 ----------
DELETE FROM sale_return_items;
DELETE FROM sale_returns;

-- ---------- 采购退货 ----------
DELETE FROM purchase_return_items;
DELETE FROM purchase_returns;

-- ---------- 销售单 ----------
DELETE FROM sales_items;
DELETE FROM sales_orders;

-- ---------- 采购单 ----------
DELETE FROM purchase_items;
DELETE FROM purchase_orders;

-- ---------- 收付款 ----------
DELETE FROM payments;

-- ---------- 库存流水 + 库存 ----------
DELETE FROM stock_logs;
DELETE FROM inventory;

-- ---------- 基础资料 ----------
DELETE FROM products;
DELETE FROM categories;
DELETE FROM customers;
DELETE FROM suppliers;

-- ---------- 操作日志 ----------
DELETE FROM operation_logs;
