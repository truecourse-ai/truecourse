"""Code quality violations: async patterns, typing, regex, and advanced."""
import asyncio
import re
import os
import typing
from typing import TYPE_CHECKING


# VIOLATION: code-quality/deterministic/async-long-sleep
async def long_wait():
    await asyncio.sleep(86400)


# VIOLATION: code-quality/deterministic/async-unused-async
async def no_async_needed():
    return 42


# VIOLATION: code-quality/deterministic/async-zero-sleep
async def yield_control():
    await asyncio.sleep(0)


# VIOLATION: code-quality/deterministic/async-single-task-group
async def single_task():
    async with asyncio.TaskGroup() as tg:
        tg.start_soon(only_one())


# VIOLATION: code-quality/deterministic/implicit-return
def maybe_returns(x):
    if x > 0:
        return x
    return


# VIOLATION: code-quality/deterministic/import-outside-top-level
def lazy_import():
    import json
    return json.dumps({})


# SKIP: code-quality/deterministic/import-private-name
from os.path import _get_sep


# VIOLATION: code-quality/deterministic/iteration-over-set
for item in {3, 1, 2}:
    print(item)


# VIOLATION: code-quality/deterministic/literal-membership-test
if x in [1, 2, 3]:
    pass


# VIOLATION: code-quality/deterministic/multiple-with-statements
with open("a.txt") as a:
    with open("b.txt") as b:
        pass


# VIOLATION: code-quality/deterministic/invalid-escape-sequence
path = "C:\qux\path"


# VIOLATION: code-quality/deterministic/implicit-string-concatenation
data = ["hello "
        "world",
        "other"]


# VIOLATION: code-quality/deterministic/try-except-pass
def swallow():
    try:
        risky()
    except Exception:
        pass


# VIOLATION: code-quality/deterministic/try-except-continue
def skip_errors(items):
    for item in items:
        try:
            process(item)
        except Exception:
            continue


# VIOLATION: code-quality/deterministic/try-consider-else
def consider_else():
    try:
        x = compute()
        y = transform(x)
        process(y)
    except ValueError:
        handle()


# VIOLATION: code-quality/deterministic/subprocess-run-without-check
import subprocess
subprocess.run(["ls", "-la"])


# VIOLATION: code-quality/deterministic/regex-char-class-preferred
pattern = re.compile(r"something.+?end")


# VIOLATION: code-quality/deterministic/regex-unnecessary-non-capturing-group
pattern2 = re.compile(r"(?:abc)")


# VIOLATION: code-quality/deterministic/regex-superfluous-quantifier
pattern3 = re.compile(r"a{1}")


# VIOLATION: code-quality/deterministic/regex-octal-escape
pattern4 = re.compile("\1")


# VIOLATION: code-quality/deterministic/deeply-nested-fstring
msg = f"{'hello' if True else f'{x + f'{y}'}'}"


# VIOLATION: code-quality/deterministic/future-annotations-import
def annotated_func(x: int) -> int | str:
    return x


# VIOLATION: code-quality/deterministic/pyupgrade-modernization
class Child(Parent):
    def __init__(self):
        super(Child, self).__init__()


# VIOLATION: code-quality/deterministic/python-idiom-simplification
result = items[:]


# VIOLATION: code-quality/deterministic/manual-from-import
import os.path


# VIOLATION: code-quality/deterministic/typing-only-import
from collections import OrderedDict

def func_with_type_only(x: OrderedDict) -> None:
    pass


# VIOLATION: code-quality/deterministic/banned-api-import
import pickle


# VIOLATION: code-quality/deterministic/empty-type-checking-block
if TYPE_CHECKING:
    pass


# VIOLATION: code-quality/deterministic/global-variable-not-assigned
global_config = {}

def use_config():
    global global_config
    return global_config


# VIOLATION: code-quality/deterministic/redeclared-assigned-name
x = 1
x = 2


# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
text = "Hеllo"


# VIOLATION: code-quality/deterministic/unnecessary-dict-index-lookup
d = {"a": 1, "b": 2}
for key, value in d.items():
    print(d[key])


# VIOLATION: code-quality/deterministic/unnecessary-list-index-lookup
for idx, item in enumerate(items):
    print(items[idx])


# VIOLATION: code-quality/deterministic/return-type-inconsistent-with-hint
def get_count() -> int:
    return "not an int"


# VIOLATION: code-quality/deterministic/assignment-inconsistent-with-hint
count: int = "hello"


# VIOLATION: code-quality/deterministic/template-string-pattern-matching
if isinstance(template, Template):
    result = template.substitute()
elif isinstance(template, SafeTemplate):
    result = template.safe_substitute()
elif isinstance(template, RawTemplate):
    result = template.render()


# NOTE: type-stub-style only triggers in .pyi files (not scanned by test harness)


# VIOLATION: code-quality/deterministic/type-checking-alias-annotation
if TYPE_CHECKING:
    MyAlias = Union[int, str]


def func_alias(x: "MyAlias") -> None:
    pass


# NOTE: non-empty-init-module only triggers in __init__.py files — see __init__.py
