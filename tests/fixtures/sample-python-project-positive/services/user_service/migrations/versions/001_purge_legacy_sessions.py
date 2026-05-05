"""Purge legacy session rows during the deprecation window.

Schema migrations frequently delete or update every row in a table by
design — the file name and surrounding migration runner already make the
intent obvious. The unsafe-delete-without-where rule must skip files
under */migrations/versions/* and */alembic/versions/*.
"""

from alembic import op


revision = '001_purge_legacy_sessions'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop all rows from the deprecated `legacy_sessions` table."""
    op.execute('DELETE FROM legacy_sessions')


def downgrade() -> None:
    """No-op — the legacy data cannot be reconstructed."""
