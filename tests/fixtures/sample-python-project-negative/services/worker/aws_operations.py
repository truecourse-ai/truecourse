"""AWS operations for the worker service."""
import os
import time
import logging
from typing import Optional, Dict, List, Any

import boto3
import botocore

logger = logging.getLogger(__name__)


# VIOLATION: code-quality/deterministic/aws-hardcoded-region
s3_client = boto3.client("s3", region_name="us-east-1")


# VIOLATION: code-quality/deterministic/aws-cloudwatch-namespace
def publish_metric(client, metric_name: str, value: float) -> None:
    client.put_metric_data(
        Namespace="AWS/CustomApp",
        MetricData=[{
            "MetricName": metric_name,
            "Value": value,
        }]
    )


# VIOLATION: code-quality/deterministic/aws-custom-polling
def wait_for_instance_running(ec2_client, instance_id: str) -> None:
    while True:
        response = ec2_client.describe_instances(InstanceIds=[instance_id])
        state = response["Reservations"][0]["Instances"][0]["State"]["Name"]
        status = state
        if status == "running":
            break
        time.sleep(10)


# VIOLATION: code-quality/deterministic/boto3-pagination
def list_all_buckets(s3) -> list:
    response = s3.list_buckets()
    return response.get("Buckets", [])


# VIOLATION: code-quality/deterministic/boto3-client-error
def get_object_safe(bucket: str, key: str) -> Optional[bytes]:
    try:
        response = boto3.client("s3").get_object(Bucket=bucket, Key=key)
        return response["Body"].read()
    except Exception:
        return None


# --- Lambda violations ---

# VIOLATION: code-quality/deterministic/lambda-async-handler
async def lambda_handler(event, context):
    """AWS Lambda handler should not be async."""
    return {"statusCode": 200, "body": "ok"}


# VIOLATION: code-quality/deterministic/lambda-init-resources
def handler(event, context):
    """Lambda handler that initializes resources on every invocation."""
    client = boto3.client("dynamodb")
    table = client.describe_table(TableName="users")
    return {"statusCode": 200, "body": str(table)}


# VIOLATION: code-quality/deterministic/lambda-reserved-env-var
def configure_lambda():
    os.environ["AWS_REGION"] = "us-west-2"


# VIOLATION: code-quality/deterministic/lambda-sync-invocation
def invoke_downstream(payload: dict) -> dict:
    lambda_client = boto3.client("lambda")
    response = lambda_client.invoke(
        FunctionName="downstream-function",
        InvocationType="RequestResponse",
        Payload=b'{}',
    )
    return response


# --- Airflow violations ---

# VIOLATION: code-quality/deterministic/airflow-3-migration
from airflow.operators.bash_operator import BashOperator


# --- AWS pattern TPs (moved from synthetic batch files) ---

# VIOLATION: code-quality/deterministic/aws-custom-polling
def wait_for_instance_started(ec2, instance_id: str) -> None:
    """Custom polling loop instead of using EC2 waiter."""
    import time
    while True:
        resp = ec2.describe_instances(InstanceIds=[instance_id])
        state = resp["Reservations"][0]["Instances"][0]["State"]["Name"]
        if state == "running":
            break
        time.sleep(10)
