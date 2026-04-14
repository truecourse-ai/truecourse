"""Notification handlers for email, SMS, and push notifications."""
import os
import re
import sys
import logging
import threading
from typing import Optional, Dict, List, Any, Union
from itertools import starmap

import tensorflow as tf

logger = logging.getLogger(__name__)

# --- TensorFlow violations ---

GLOBAL_LEARNING_RATE = 0.001


# VIOLATION: code-quality/deterministic/tf-function-global-variable
@tf.function
def train_step(data):
    global GLOBAL_LEARNING_RATE
    return data * GLOBAL_LEARNING_RATE


# VIOLATION: code-quality/deterministic/tf-function-recursive
@tf.function
def recursive_compute(n):
    if n <= 0:
        return 0
    return n + recursive_compute(n - 1)


# VIOLATION: code-quality/deterministic/tf-gather-validate-indices
def gather_embeddings(embeddings, indices):
    return tf.gather(embeddings, indices, validate_indices=True)


# VIOLATION: code-quality/deterministic/tf-keras-input-shape
class NotificationModel(tf.keras.Model):
    def __init__(self, input_shape=(10,)):
        super().__init__()
        self.dense = tf.keras.layers.Dense(64)


# VIOLATION: code-quality/deterministic/tf-variable-singleton
@tf.function
def update_learning_rate(data):
    lr = tf.Variable(0.001)
    return data * lr


# --- Template string violations ---

from string import Template

# VIOLATION: code-quality/deterministic/template-string-pattern-matching
def render_notification(name: str, action: str) -> str:
    tmpl = Template("Hello $name, you $action your account")
    if isinstance(tmpl, Template):
        return tmpl.substitute(name=name)
    elif isinstance(tmpl, str):
        return tmpl
    elif isinstance(tmpl, bytes):
        return tmpl.decode()
    return ""


# --- Notification service core ---

NOTIFICATION_TYPES = ["email", "sms", "push", "webhook"]


def send_notification(notification_type: str, recipient: str, message: str) -> bool:
    """Send a notification to a recipient."""
    # VIOLATION: code-quality/deterministic/if-else-dict-lookup
    if notification_type == "email":
        handler = send_email
    elif notification_type == "sms":
        handler = send_sms
    elif notification_type == "push":
        handler = send_push
    elif notification_type == "webhook":
        handler = send_webhook
    else:
        handler = None

    if handler:
        return handler(recipient, message)
    return False


def send_email(recipient: str, message: str) -> bool:
    logger.info(f"Sending email to {recipient}")
    return True


def send_sms(recipient: str, message: str) -> bool:
    logger.info(f"Sending SMS to {recipient}")
    return True


def send_push(recipient: str, message: str) -> bool:
    logger.info(f"Sending push to {recipient}")
    return True


def send_webhook(recipient: str, message: str) -> bool:
    logger.info(f"Sending webhook to {recipient}")
    return True
