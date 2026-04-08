# VIOLATION: code-quality/deterministic/type-stub-style
from typing import Optional, Dict, List

class NotificationConfig:
    retry_count: int
    timeout: int
    pass

def send_notification(
    recipient: str,
    message: str,
    config: Optional[NotificationConfig] = None,
) -> bool:
    pass
