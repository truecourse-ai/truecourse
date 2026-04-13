"""
True positive fixture — batch D rules.

Each section triggers a real violation that should be detected.
"""
import time
import logging
from typing import Optional

import boto3

logger = logging.getLogger(__name__)


# VIOLATION: code-quality/deterministic/redundant-jump
def process_all(items: list) -> None:
    for item in items:
        handle(item)
        continue


def handle(item: object) -> None:
    pass


# VIOLATION: code-quality/deterministic/redundant-jump
def cleanup() -> None:
    logger.info("cleaning up")
    return


# VIOLATION: code-quality/deterministic/self-first-argument
class BadService:
    def do_work(this) -> None:
        pass


# VIOLATION: code-quality/deterministic/aws-custom-polling
def wait_for_instance(ec2_client, instance_id: str) -> None:
    while True:
        response = ec2_client.describe_instances(InstanceIds=[instance_id])
        state = response["Reservations"][0]["Instances"][0]["State"]["Name"]
        status = state
        if status == "running":
            break
        time.sleep(10)


# VIOLATION: performance/deterministic/batch-writes-in-loop
def save_all_users(session, users: list) -> None:
    for user in users:
        session.add(user)


# VIOLATION: code-quality/deterministic/require-await
async def compute_total(items: list) -> float:
    return sum(i.value for i in items)


# VIOLATION: code-quality/deterministic/async-unused-async
async def format_name(first: str, last: str) -> str:
    return f"{first} {last}"
