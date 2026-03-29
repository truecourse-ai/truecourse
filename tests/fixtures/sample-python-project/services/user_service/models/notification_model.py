"""Notification models — tests compound type annotations in class properties.

Tests:
- Class used as property type with Optional[X] and X | None (usedAsType FP)
- Class used as superclass (usedAsType via inheritance)
- Mapped[] with compound types
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class NotificationChannel:
    """Channel config — used as a property type in Notification."""
    name: str
    enabled: bool = True


@dataclass
class NotificationPriority:
    """Priority — used via Optional[NotificationPriority] annotation."""
    level: int
    label: str


@dataclass
class BaseNotification:
    """Base class — used via inheritance (usedAsType via superClass)."""
    title: str
    body: str


@dataclass
class Notification(BaseNotification):
    """Uses compound type annotations that reference other classes."""
    channel: NotificationChannel | None = None
    priority: Optional[NotificationPriority] = None
    recipients: list[str] = field(default_factory=list)
