"""add receiver info to sales/purchase orders

与 D1 迁移 cf/migrations/0002_order_receiver_info.sql 一一对应。
本地是 SQLite + Alembic，线上是 D1 + wrangler migrations，两套都要改，
否则本地能跑线上报 no such column（AGENTS.md 第 4 条）。

Revision ID: c4a7e91b2d38
Revises: 1b1c2908c3af
Create Date: 2026-10-09 01:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a7e91b2d38'
down_revision: Union[str, Sequence[str], None] = '1b1c2908c3af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """新增接收人姓名 / 电话（两列可空，历史数据不受影响）。"""
    op.add_column('sales_orders', sa.Column('receiver_name', sa.String(50), nullable=True))
    op.add_column('sales_orders', sa.Column('receiver_phone', sa.String(30), nullable=True))
    op.add_column('purchase_orders', sa.Column('receiver_name', sa.String(50), nullable=True))
    op.add_column('purchase_orders', sa.Column('receiver_phone', sa.String(30), nullable=True))


def downgrade() -> None:
    op.drop_column('purchase_orders', 'receiver_phone')
    op.drop_column('purchase_orders', 'receiver_name')
    op.drop_column('sales_orders', 'receiver_phone')
    op.drop_column('sales_orders', 'receiver_name')
