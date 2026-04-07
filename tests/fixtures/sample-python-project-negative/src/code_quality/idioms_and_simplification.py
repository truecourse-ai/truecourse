"""Code quality violations: Python idioms, simplifications, and modern patterns."""
import os
import sys
import re
import threading
from collections import deque
from itertools import starmap
from pathlib import Path


# VIOLATION: code-quality/deterministic/and-or-ternary
def legacy_ternary(flag, a, b):
    return flag and a or b


# VIOLATION: code-quality/deterministic/needless-bool
def is_valid(x):
    return True if x > 0 else False


# VIOLATION: code-quality/deterministic/needless-else
def early_return(x):
    if x > 0:
        return x
    else:
        y = -x
        return y


# VIOLATION: code-quality/deterministic/double-negation
def not_not(x):
    return not not x


# VIOLATION: code-quality/deterministic/negated-comparison
def neg_compare(x, y):
    return not x == y


# VIOLATION: code-quality/deterministic/yoda-condition
def yoda(x):
    if 42 == x:
        return True


# VIOLATION: code-quality/deterministic/compare-to-empty-string
def check_empty(s):
    if s == "":
        return True


# VIOLATION: code-quality/deterministic/len-test
def check_len(items):
    if len(items):
        return True


# VIOLATION: code-quality/deterministic/in-dict-keys
def check_key(d, k):
    return k in d.keys()


# VIOLATION: code-quality/deterministic/dict-get-none-default
val = config.get("key", None)


# SKIP: code-quality/deterministic/if-else-instead-of-ternary
def ternary_candidate(x):
    if x > 0:
        result = "pos"
    else:
        result = "neg"
    return result


# SKIP: code-quality/deterministic/if-else-instead-of-dict-get
def dict_get_candidate(d, k):
    if k in d:
        val = d[k]
    else:
        val = None
    return val


# SKIP: code-quality/deterministic/if-else-dict-lookup
def dict_lookup(status):
    if status == 200:
        msg = "OK"
    elif status == 404:
        msg = "Not Found"
    elif status == 500:
        msg = "Server Error"
    elif status == 502:
        msg = "Bad Gateway"
    return msg


# VIOLATION: code-quality/deterministic/if-expr-min-max
def manual_max(a, b):
    return a if a > b else b


# VIOLATION: code-quality/deterministic/if-with-same-arms
def same_arms(x):
    if x:
        result = 42
    else:
        result = 42


# VIOLATION: code-quality/deterministic/useless-if-else
def useless_if(x):
    if x:
        return True
    else:
        return False


# VIOLATION: code-quality/deterministic/contradictory-boolean-expression
def contradict(x):
    return x and not x


# VIOLATION: code-quality/deterministic/boolean-chained-comparison
def chained(x):
    return 0 <= x and x <= 100


# VIOLATION: code-quality/deterministic/non-augmented-assignment
def non_aug(x):
    x = x + 1
    return x


# VIOLATION: code-quality/deterministic/unnecessary-pass
class HasDocstring:
    """A class."""
    pass


# VIOLATION: code-quality/deterministic/unnecessary-placeholder-statement
def with_ellipsis():
    ...
    return 42


# VIOLATION: code-quality/deterministic/unnecessary-lambda
items = [3, 1, 2]
items.sort(key=lambda x: sorted(x))


# VIOLATION: code-quality/deterministic/unnecessary-direct-lambda-call
result = (lambda x: x + 1)(5)


# VIOLATION: code-quality/deterministic/unnecessary-dunder-call
length = [].__len__()


# VIOLATION: code-quality/deterministic/unnecessary-range-start
for i in range(0, 10):
    pass


# SKIP: code-quality/deterministic/unnecessary-generator-comprehension
total = list(x for x in range(10))


# VIOLATION: code-quality/deterministic/unnecessary-list-in-iteration
for x in list([1, 2, 3]):
    pass


# VIOLATION: code-quality/deterministic/unnecessary-empty-iterable-in-deque
d = deque([])


# VIOLATION: code-quality/deterministic/unnecessary-dict-kwargs
func(**{"key": "value"})


# VIOLATION: code-quality/deterministic/unnecessary-dict-spread
merged = {**base_dict}


# VIOLATION: code-quality/deterministic/unnecessary-assign-before-return
def assign_then_return():
    result = compute()
    return result


# VIOLATION: code-quality/deterministic/unnecessary-regular-expression
result = re.sub(r"abc", "def", text)


# VIOLATION: code-quality/deterministic/unnecessary-cast-to-int
x = int(len(items))


# VIOLATION: code-quality/deterministic/unnecessary-round
y = round(5)


# VIOLATION: code-quality/deterministic/swap-variables-pythonic
a = 1
b = 2
temp = a
a = b
b = temp


# VIOLATION: code-quality/deterministic/getattr-with-constant
val = getattr(obj, "name")


# VIOLATION: code-quality/deterministic/enumerate-for-loop
items = [1, 2, 3]
for i in range(len(items)):
    print(i, items[i])


# VIOLATION: code-quality/deterministic/collection-literal-concatenation
combined = [1, 2] + [3, 4]


# VIOLATION: code-quality/deterministic/redundant-collection-function
r = list(sorted(items))


# VIOLATION: code-quality/deterministic/reimplemented-builtin
def my_any(items):
    for item in items:
        if item:
            return True
    return False


# VIOLATION: code-quality/deterministic/reimplemented-container-builtin
factory = lambda: []


# VIOLATION: code-quality/deterministic/reimplemented-operator
adder = lambda a, b: a + b


# VIOLATION: code-quality/deterministic/repeated-append
items = []
items.append(1)
items.append(2)
items.append(3)


# VIOLATION: code-quality/deterministic/slice-to-remove-prefix-suffix
name = "hello_world"
stripped = name[len("hello"):]


# VIOLATION: code-quality/deterministic/startswith-endswith-tuple
if name.startswith("a") or name.startswith("b") or name.startswith("c"):
    pass


# VIOLATION: code-quality/deterministic/split-static-string
parts = "a,b,c".split(",")


# VIOLATION: code-quality/deterministic/sorted-reversed-redundant
data = reversed(sorted([3, 1, 2]))


# VIOLATION: code-quality/deterministic/static-join-to-fstring
msg = ", ".join(["hello", "world"])


# VIOLATION: code-quality/deterministic/starmap-zip-simplification
result = list(starmap(lambda a, b: a + b, zip([1, 2], [3, 4])))


# VIOLATION: code-quality/deterministic/zip-dict-keys-values
d = {"a": 1, "b": 2}
pairs = zip(d.keys(), d.values())


# VIOLATION: code-quality/deterministic/zip-instead-of-pairwise
items = [1, 2, 3, 4]
for a, b in zip(items, items[1:]):
    pass


# VIOLATION: code-quality/deterministic/compare-with-tuple
def check_val(x):
    if x == 1 or x == 2 or x == 3:
        return True


# VIOLATION: code-quality/deterministic/nested-min-max
result = min(min(a, b), c)


# VIOLATION: code-quality/deterministic/useless-expression
def side_effect():
    1 + 2
    x > 0


# VIOLATION: code-quality/deterministic/useless-try-except
def pointless_try():
    try:
        risky()
    except ValueError:
        raise


# VIOLATION: code-quality/deterministic/useless-else-on-loop
for x in range(10):
    process(x)
else:
    pass


# SKIP: code-quality/deterministic/useless-with-lock
with threading.Lock():
    do_work()


# VIOLATION: code-quality/deterministic/useless-import-alias
import os as os


# VIOLATION: code-quality/deterministic/superfluous-else-after-control
def superfluous(x):
    if x > 0:
        raise ValueError()
    else:
        return -1


# VIOLATION: code-quality/deterministic/suppressible-exception
try:
    os.remove("file.txt")
except FileNotFoundError:
    pass


# VIOLATION: code-quality/deterministic/read-write-whole-file
content = open("data.txt").read()


# VIOLATION: code-quality/deterministic/readlines-in-for
with open("data.txt") as f:
    for line in f.readlines():
        process(line)


# VIOLATION: code-quality/deterministic/open-file-without-context-manager
f = open("data.txt")
content = f.read()
f.close()


# VIOLATION: code-quality/deterministic/unspecified-encoding
with open("data.txt", "r") as f:
    pass


# VIOLATION: code-quality/deterministic/prefer-pathlib
full_path = os.path.join("/home", "user", "file.txt")


# VIOLATION: code-quality/deterministic/print-empty-string
print("")


# NOTE: print-statement-in-production skipped because fixture path contains /tests/
print("processing complete")


# VIOLATION: code-quality/deterministic/pprint-usage
import pprint
pprint.pprint(data)


# VIOLATION: code-quality/deterministic/use-bit-count
count = bin(n).count("1")


# VIOLATION: code-quality/deterministic/use-decorator-syntax
def my_func():
    pass
my_func = staticmethod(my_func)


# VIOLATION: code-quality/deterministic/sys-exit-alias
exit()


# VIOLATION: code-quality/deterministic/check-and-remove-from-set
s = {1, 2, 3}
if 2 in s:
    s.remove(2)


# VIOLATION: code-quality/deterministic/unnecessary-key-check
d = {"a": 1}
if "a" in d:
    del d["a"]


# VIOLATION: code-quality/deterministic/missing-maxsplit-arg
parts = "a.b.c.d".split(".")[0]


# VIOLATION: code-quality/deterministic/dict-fromkeys-for-constant
mapping = {k: 0 for k in keys}


# VIOLATION: code-quality/deterministic/map-int-version-parsing
version = "3.11.5"
major, minor, patch = map(int, version.split("."))
