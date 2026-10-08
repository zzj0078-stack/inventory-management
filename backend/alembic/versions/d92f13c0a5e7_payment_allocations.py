"""payment allocations (one payment settles many orders)

与 D1 迁移 cf/migrations/0003_payment_allocations.sql 一一对应。

Revision ID: d92f13c0a5e7
Revises: c4a7e91b2d38
Create Date: 2026-10-09 01:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd92f13c0a5e7'
down_revision: Union[str, Sequence[str], None] = 'c4a7e91b2d38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """收付款核销表：一笔款可分到多张单。"""
    op.create_table(
        'payment_allocations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('payment_id', sa.Integer(), nullable=False),
        sa.Column('related_type', sa.String(30), nullable=False),
        sa.Column('related_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(['payment_id'], ['payments.id']),
    )
    op.create_index('ix_payment_alloc_payment', 'payment_allocations', ['payment_id'])
    op.create_index('ix_payment_alloc_related', 'payment_allocations', ['related_type', 'related_id'])


def downgrade() -> None:
    op.drop_index('ix_payment_alloc_related', table_name='payment_allocations')
    op.drop_index('ix_payment_alloc_payment', table_name='payment_allocations')
    op.drop_table('payment_allocations')
