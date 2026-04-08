"""Airflow DAG definitions for scheduled workflows."""
import logging

logger = logging.getLogger(__name__)


def create_dag(dag_id: str, schedule: str) -> dict:
    """Create an Airflow DAG configuration."""
    return {"dag_id": dag_id, "schedule": schedule}
