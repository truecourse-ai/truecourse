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

def normalize_ids(raw_ids: List[str]) -> List[int]:
    """Convert string IDs to integers inside a loop."""
    result = []
    for raw in raw_ids:
        # VIOLATION: performance/deterministic/runtime-cast-overhead
        result.append(int(raw))
    return result


def build_label_map(records: List[Dict[str, Any]]) -> Dict[str, str]:
    """Build a lookup mapping labels with in-loop casting."""
    label_map = {}
    for record in records:
        # VIOLATION: performance/deterministic/runtime-cast-overhead
        label_map[str(record["id"])] = str(record["name"])
    return label_map


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
    # SKIP: performance/deterministic/unnecessary-iterable-allocation
    # Reason: tree-sitter Python doesn't create generator_expression inside function calls.
    for item in list(x * 2 for x in items):
        print(item)
