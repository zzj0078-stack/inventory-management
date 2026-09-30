-- ============================================================
--  新增权限：product:cost（查看成本价）
--
--  目的：控制「销售人员能否看到成本价（采购价）」。
--  没有该权限时，后端**不返回**成本价，报表的成本/毛利、库存金额、
--  库存导出里的成本列也一并隐藏（数据层拦截，不是前端藏列）。
--
--  预置分配：
--    admin      ✓（代码里 role.name==='admin' 直接给 ['*']，无需插角色关联）
--    manager    ✓（模板是 product:*，这里显式插一条）
--    purchaser  ✓（采购要谈价）
--    finance    ✓（财务要核算成本）
--    warehouse  ✗（仓管不需要知道金额）
--    sales      ✗（本次需求的重点：销售员不给）
--    viewer     ✗
--
--  幂等：可反复执行。改完可在「角色权限」页自行勾选调整。
--
--  执行：
--    wrangler d1 execute inventory --file=cf/add-cost-permission.sql --local
--    wrangler d1 execute inventory --file=cf/add-cost-permission.sql --remote
-- ============================================================

INSERT OR IGNORE INTO permissions (code, name, module)
VALUES ('product:cost', '查看成本价', 'product');

-- 按角色名授权（不写死 role_id，重建库后也不会错位）
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE p.code = 'product:cost'
   AND r.name IN ('admin', 'manager', 'purchaser', 'finance');
