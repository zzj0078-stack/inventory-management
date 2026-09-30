-- ============================================================
--  冒烟测试数据彻底清理
--
--  为什么需要它：
--    已收货/已发货的单据，接口按业务规则不允许删除；
--    商品有库存时也不允许删除。smoke-test.mjs 只能尽力清理，
--    收尾工作交给本脚本（直接对 D1 执行，绕过业务规则）。
--
--  识别方式（三重保险）：
--    1. 往来单位名 / 商品名 / 分类名带 __冒烟测试 前缀
--    2. 单据 remark 带 __冒烟测试 前缀（采购/销售/调拨/盘点都写了）
--    3. 明细引用了测试商品（防止单据备注被清掉后漏删）
--
--  ⚠ 外键顺序很关键（D1 强制外键，顺序错会整批回滚）：
--    子表 → 父表；operation_logs 必须在 users 之前删。
--
--  执行：
--    wrangler d1 execute inventory --file=cf/smoke-cleanup.sql --remote
--    wrangler d1 execute inventory --file=cf/smoke-cleanup.sql --local
-- ============================================================

-- ---------- 1. 盘点 ----------
DELETE FROM operation_logs
 WHERE target IN (
   SELECT check_no FROM stock_checks
    WHERE warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 );

DELETE FROM stock_check_items
 WHERE check_id IN (
   SELECT id FROM stock_checks
    WHERE warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 );

DELETE FROM stock_checks
 WHERE warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
    OR remark LIKE '__冒烟测试%';

-- ---------- 2. 调拨 ----------
DELETE FROM operation_logs
 WHERE target IN (
   SELECT transfer_no FROM stock_transfers
    WHERE from_warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
       OR to_warehouse_id   IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 );

DELETE FROM stock_transfer_items
 WHERE transfer_id IN (
   SELECT id FROM stock_transfers
    WHERE from_warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
       OR to_warehouse_id   IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 );

DELETE FROM stock_transfers
 WHERE from_warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
    OR to_warehouse_id   IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%')
    OR remark LIKE '__冒烟测试%';

-- ---------- 3. 销售单 ----------
DELETE FROM operation_logs
 WHERE target IN (
   SELECT order_no FROM sales_orders
    WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 );

DELETE FROM sale_return_items
 WHERE return_id IN (
   SELECT r.id FROM sale_returns r
    WHERE r.customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
       OR r.reason LIKE '__冒烟测试%'
       OR r.sales_order_id IN (
            SELECT id FROM sales_orders
             WHERE remark LIKE '__冒烟测试%'
                OR customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
          )
 )
 OR product_id IN (SELECT id FROM products WHERE name LIKE '__冒烟测试%');

DELETE FROM sale_returns
 WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
    OR reason LIKE '__冒烟测试%'
    OR sales_order_id IN (
         SELECT id FROM sales_orders
          WHERE remark LIKE '__冒烟测试%'
             OR customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
       );

DELETE FROM sales_items
 WHERE order_id IN (
   SELECT id FROM sales_orders
    WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 )
 OR product_id IN (SELECT id FROM products WHERE name LIKE '__冒烟测试%');

DELETE FROM sales_orders
 WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%')
    OR remark LIKE '__冒烟测试%'
    OR id NOT IN (SELECT DISTINCT order_id FROM sales_items);

-- ---------- 4. 采购单 ----------
DELETE FROM operation_logs
 WHERE target IN (
   SELECT order_no FROM purchase_orders
    WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 );

DELETE FROM purchase_return_items
 WHERE return_id IN (
   SELECT r.id FROM purchase_returns r
    WHERE r.supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
       OR r.reason LIKE '__冒烟测试%'
       OR r.purchase_order_id IN (
            SELECT id FROM purchase_orders
             WHERE remark LIKE '__冒烟测试%'
                OR supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
          )
 )
 OR product_id IN (SELECT id FROM products WHERE name LIKE '__冒烟测试%');

DELETE FROM purchase_returns
 WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
    OR reason LIKE '__冒烟测试%'
    OR purchase_order_id IN (
         SELECT id FROM purchase_orders
          WHERE remark LIKE '__冒烟测试%'
             OR supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
       );

DELETE FROM purchase_items
 WHERE order_id IN (
   SELECT id FROM purchase_orders
    WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
       OR remark LIKE '__冒烟测试%'
 )
 OR product_id IN (SELECT id FROM products WHERE name LIKE '__冒烟测试%');

DELETE FROM purchase_orders
 WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%')
    OR remark LIKE '__冒烟测试%'
    OR id NOT IN (SELECT DISTINCT order_id FROM purchase_items);

-- ---------- 5. 收付款 ----------
DELETE FROM payments
 WHERE (partner_type = 'customer' AND partner_id IN (SELECT id FROM customers WHERE name LIKE '__冒烟测试%'))
    OR (partner_type = 'supplier' AND partner_id IN (SELECT id FROM suppliers WHERE name LIKE '__冒烟测试%'));

-- ---------- 6. 库存流水 + 库存 ----------
DELETE FROM stock_logs
 WHERE product_id IN (SELECT id FROM products WHERE name LIKE '__冒烟测试%')
    OR warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%');

DELETE FROM inventory
 WHERE product_id IN (SELECT id FROM products WHERE name LIKE '__冒烟测试%')
    OR warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '__冒烟测试%');

-- ---------- 7. 操作日志（必须在 users 之前）----------
-- 测试账号登录会写日志，user_id 指向它，先清掉才能删用户
DELETE FROM operation_logs
 WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'smoke_noperm%' OR username LIKE 'smoke_admin%')
    OR target LIKE '__冒烟测试%';

-- ---------- 8. 主数据 ----------
DELETE FROM products    WHERE name LIKE '__冒烟测试%';
DELETE FROM categories  WHERE name LIKE '__冒烟测试%';
DELETE FROM customers   WHERE name LIKE '__冒烟测试%';
DELETE FROM suppliers   WHERE name LIKE '__冒烟测试%';
DELETE FROM warehouses  WHERE name LIKE '__冒烟测试%';

-- ---------- 9. 权限测试账号 ----------
-- smoke_admin 是线上验证时临时插入的管理员，跑完即删
DELETE FROM users WHERE username LIKE 'smoke_noperm%' OR username LIKE 'smoke_admin%';

DELETE FROM role_permissions
 WHERE role_id IN (SELECT id FROM roles WHERE name LIKE '__冒烟测试%');

DELETE FROM roles WHERE name LIKE '__冒烟测试%';
