"""Python f-string DSN builder. The password slot is interpolated from a
variable (`{DB_PASS}`); the `hardcoded-database-password` rule must
recognise this as a templated, not literal, connection string.

Mirrors the FP in OpenHands:
  enterprise/migrations/env.py:59
  openhands/app_server/app_lifespan/alembic/env.py:80
"""

import os


def build_postgres_url(database_name: str) -> str:
    """Construct a Postgres DSN from environment variables."""
    db_user = os.environ['DB_USER']
    db_pass = os.environ['DB_PASS']
    db_host = os.environ.get('DB_HOST', 'localhost')
    db_port = os.environ.get('DB_PORT', '5432')
    return f'postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{database_name}'


def build_mongo_url(user: str, password: str, host: str) -> str:
    """Construct a MongoDB DSN from arguments."""
    return f'mongodb://{user}:{password}@{host}:27017'
