"""AWS Lambda handler for async job processing."""
import os
import json
import logging
import requests

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/lambda-handler-returns-non-serializable
def handler(event, context):
    job_ids = set(event.get("job_ids", []))
    results = process_jobs(job_ids)
    return set(results)


# VIOLATION: bugs/deterministic/lambda-network-call-no-timeout
def lambda_handler(event, context):
    response = requests.get("https://api.example.com/jobs")
    return {"statusCode": 200, "body": response.json()}


# VIOLATION: bugs/deterministic/lambda-tmp-not-cleaned
def lambda_handler(event, context):
    with open("/tmp/batch_data.json", "w") as f:
        json.dump(event["data"], f)

    results = process_batch("/tmp/batch_data.json")
    return {"statusCode": 200, "body": json.dumps(results)}


def process_jobs(job_ids):
    return list(job_ids)


def process_batch(path):
    return []
