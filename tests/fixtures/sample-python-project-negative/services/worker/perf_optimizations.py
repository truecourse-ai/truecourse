"""Performance-sensitive code with optimization opportunities."""
from typing import List, Dict, Any
from torch.utils.data import DataLoader, Dataset


# ---- Missing __slots__ in subclass ----

class BaseEvent:
    """Base event class with __slots__ for memory efficiency."""
    __slots__ = ("event_id", "timestamp")

    def __init__(self, event_id: str, timestamp: float):
        self.event_id = event_id
        self.timestamp = timestamp


# VIOLATION: performance/deterministic/missing-slots-in-subclass
class UserEvent(BaseEvent):
    """User event subclass without memory optimization."""

    def __init__(self, event_id: str, timestamp: float, user_id: str):
        super().__init__(event_id, timestamp)
        self.user_id = user_id


# ---- Runtime cast overhead in loop ----

DEFAULT_LIMIT = 100
DEFAULT_PREFIX = 42


def emit_default_limits(records: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Cast a module-level constant inside a loop. The cast is loop-invariant
    and can be hoisted above the loop — this is the rule's real TP shape."""
    out = []
    for record in records:
        # VIOLATION: performance/deterministic/runtime-cast-overhead
        limit_str = str(DEFAULT_LIMIT)
        out.append({"id": record["id"], "limit": limit_str})
    return out


def double_each(records: List[Dict[str, Any]]) -> List[int]:
    """Cast a literal inside a loop — also hoistable."""
    out = []
    for record in records:
        # VIOLATION: performance/deterministic/runtime-cast-overhead
        base = int("42")
        out.append(base + record.get("offset", 0))
    return out


# ---- torch DataLoader without num_workers ----

class ImageDataset(Dataset):
    """Simple image dataset for training."""

    def __init__(self, images: list, labels: list):
        self.images = images
        self.labels = labels

    def __len__(self):
        return len(self.images)

    def __getitem__(self, idx):
        return self.images[idx], self.labels[idx]


def create_training_loader(dataset: ImageDataset, batch_size: int = 32):
    """Create a DataLoader for training without specifying num_workers."""
    # VIOLATION: performance/deterministic/torch-dataloader-num-workers
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    return loader


# ---- Unnecessary iterable allocation in for loop ----

def process_items(items):
    """Process items with unnecessary list wrapping."""
    # VIOLATION: performance/deterministic/unnecessary-iterable-allocation
    for item in list(x * 2 for x in items):
        print(item)
