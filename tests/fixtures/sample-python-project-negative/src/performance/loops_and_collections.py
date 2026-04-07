"""Performance violations: loop inefficiencies and collection operations."""
import re
import torch
from torch.utils.data import DataLoader


# VIOLATION: performance/deterministic/quadratic-list-summation
def build_string(items):
    result = ""
    for item in items:
        result += str(item)
    return result


# VIOLATION: performance/deterministic/sorted-for-min-max
def get_smallest(data):
    return sorted(data)[0]


# VIOLATION: performance/deterministic/sorted-for-min-max
def get_largest(data):
    return sorted(data)[-1]


# VIOLATION: performance/deterministic/list-comprehension-in-any-all
def has_positive(items):
    return any([x > 0 for x in items])


# VIOLATION: performance/deterministic/unnecessary-list-cast
def redundant_list(items):
    return list([x * 2 for x in items])


# VIOLATION: performance/deterministic/incorrect-dict-iterator
def process_dict(mapping):
    for key in mapping.keys():
        print(key, mapping[key])


# VIOLATION: performance/deterministic/try-except-in-loop
def risky_loop(items):
    for item in items:
        try:
            process(item)
        except ValueError:
            pass


# VIOLATION: performance/deterministic/manual-list-comprehension
def manual_comprehension(items):
    result = []
    for item in items:
        result.append(item * 2)
    return result


# VIOLATION: performance/deterministic/str-replace-over-re-sub
def simple_replace(text):
    return re.sub("hello", "world", text)


# VIOLATION: performance/deterministic/unnecessary-iterable-allocation
def iterate_list(gen):
    for item in list(gen()):
        process(item)


# VIOLATION: performance/deterministic/torch-dataloader-num-workers
def create_loader(dataset):
    return DataLoader(dataset, batch_size=32)


# VIOLATION: performance/deterministic/torch-dataloader-num-workers
def create_loader_zero(dataset):
    return DataLoader(dataset, batch_size=32, num_workers=0)


# VIOLATION: performance/deterministic/missing-slots-in-subclass
class BaseSlotted:
    __slots__ = ("x", "y")

class DerivedNoSlots(BaseSlotted):
    def __init__(self):
        self.x = 1
        self.y = 2
        self.z = 3


# VIOLATION: performance/deterministic/batch-writes-in-loop
def save_all(items, db):
    for item in items:
        db.save(item)


# VIOLATION: performance/deterministic/set-mutations-in-loop
def build_set(items):
    result = set()
    for item in items:
        result.add(item)
    return result


# VIOLATION: performance/deterministic/runtime-cast-overhead
def convert_loop(items):
    for item in items:
        val = int(item)
        process(val)
