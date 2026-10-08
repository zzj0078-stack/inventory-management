-- ============================================================
--  收付款核销：一笔收付款可分配到多张单据
--
--  背景：payments 表原本只有 related_type / related_id 单个字段，
--  而且只用来拼凭证摘要文字，无法表达"一笔款结掉好几张单"，
--  也就无法判断哪些单据已经结清。
--
--  设计：
--    - payment_allocations 是结算的唯一依据（每行：这笔款分给哪张单多少）
--    - payments.related_type / related_id 保留不动，继续用于凭证摘要；
--      新建带分配的单据时，会把第一张单写进去，兼容原有逻辑
--    - 单据已结金额 = SUM(该单的分配金额)，与单据金额比较得出结清状态
--
--  为什么用子表而不是给 payments 加字段：
--    payments : 单据 = N : M，任何单表字段都表达不了。
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_allocations (
  id           INTEGER PRIMARY KEY,
  payment_id   INTEGER NOT NULL,
  related_type TEXT NOT NULL,          -- 'sales_order' | 'purchase_order'
  related_id   INTEGER NOT NULL,
  amount       REAL NOT NULL,
  created_at   TEXT,
  FOREIGN KEY (payment_id) REFERENCES payments (id)
);

-- 查"这笔款分给了哪些单"
CREATE INDEX IF NOT EXISTS ix_payment_alloc_payment
  ON payment_allocations (payment_id);

-- 查"这张单收/付了多少"—— 单据列表统计结清状态时每行都要用
CREATE INDEX IF NOT EXISTS ix_payment_alloc_related
  ON payment_allocations (related_type, related_id);
