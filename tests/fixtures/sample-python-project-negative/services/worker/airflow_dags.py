"""Airflow DAG definitions for worker jobs."""
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.bash import BashOperator


# VIOLATION: bugs/deterministic/airflow-usage-error
extract_data = PythonOperator(
    task_id='load_data',
    python_callable=lambda: None,
)


# VIOLATION: bugs/deterministic/airflow-usage-error
dag = DAG(
    "daily_etl",
    default_args={"owner": "data_team"},
)


transform_job = BashOperator(
    task_id='transform_job',
    bash_command='echo "transforming"',
    dag=dag,
)
