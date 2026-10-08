-- ============================================================
--  销售单 / 采购单：增加接收人信息
--
--  背景：delivery_address（送货地址 / 交货地址）早就有，但"这单送给谁、
--  打谁的电话"没有字段 —— 送货单/打印件上缺接收人，只能写到备注里。
--
--  新增：
--    receiver_name   接收人姓名
--    receiver_phone  接收人电话
--
--  销售单（我们送给客户）与采购单（供应商送来）两边都加，结构保持对称。
--  两列都可空：历史单据没有这个信息，不允许为空会导致迁移失败。
-- ============================================================

ALTER TABLE sales_orders    ADD COLUMN receiver_name  TEXT;
ALTER TABLE sales_orders    ADD COLUMN receiver_phone TEXT;
ALTER TABLE purchase_orders ADD COLUMN receiver_name  TEXT;
ALTER TABLE purchase_orders ADD COLUMN receiver_phone TEXT;
