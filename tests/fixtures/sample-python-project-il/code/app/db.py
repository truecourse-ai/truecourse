# ADR-001 fixes Postgres as the system of record, but `pymongo` is also
# pulled in from a half-finished migration — a forbidden data-store
# alternative.
# IL-DRIFT: ArchitectureDecision:data-store.postgres / architecture.data-store.forbidden-alternative
import pymongo  # noqa: F401  (leftover from the abandoned Mongo migration)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine("postgresql+psycopg2://localhost/orders")
SessionLocal = sessionmaker(bind=engine)
