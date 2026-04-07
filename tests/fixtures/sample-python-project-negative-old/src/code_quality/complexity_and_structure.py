"""Code quality violations: complexity, structure, and function design."""
from abc import ABC, abstractmethod
import asyncio


# VIOLATION: code-quality/deterministic/console-log
print("debug output")


# VIOLATION: code-quality/deterministic/no-debugger
breakpoint()


# VIOLATION: code-quality/deterministic/no-debugger
import pdb
pdb.set_trace()


# VIOLATION: code-quality/deterministic/star-import
from os.path import *


# VIOLATION: code-quality/deterministic/global-statement
counter = 0
def increment():
    global counter
    counter += 1


# VIOLATION: code-quality/deterministic/collapsible-if
def check(x, y):
    if x > 0:
        if y > 0:
            return True


# VIOLATION: code-quality/deterministic/no-empty-function
def placeholder():
    pass


# VIOLATION: code-quality/deterministic/unnecessary-else-after-return
def classify(x):
    if x > 0:
        return "positive"
    else:
        return "non-positive"


# VIOLATION: code-quality/deterministic/too-many-lines
def very_long_function():
    a = 1
    b = 2
    c = 3
    d = 4
    e = 5
    f = 6
    g = 7
    h = 8
    i = 9
    j = 10
    k = 11
    l = 12
    m = 13
    n = 14
    o = 15
    p = 16
    q = 17
    r = 18
    s = 19
    t = 20
    u = 21
    v = 22
    w = 23
    x = 24
    y = 25
    z = 26
    aa = 27
    bb = 28
    cc = 29
    dd = 30
    ee = 31
    ff = 32
    gg = 33
    hh = 34
    ii = 35
    jj = 36
    kk = 37
    ll = 38
    mm = 39
    nn = 40
    oo = 41
    pp = 42
    qq = 43
    rr = 44
    ss = 45
    tt = 46
    uu = 47
    vv = 48
    ww = 49
    xx = 50
    yy = 51
    return a + yy


# VIOLATION: code-quality/deterministic/deeply-nested-functions
def outer():
    def middle():
        def inner():
            def deep():
                return 1


# SKIP: code-quality/deterministic/redundant-jump
def process(items):
    for item in items:
        do_work(item)
        continue


# VIOLATION: code-quality/deterministic/commented-out-code
# result = process_data(items)
# return result


# VIOLATION: code-quality/deterministic/abstract-class-without-abstract-method
class AbstractishClass(ABC):
    def concrete_method(self):
        return 42


# VIOLATION: code-quality/deterministic/empty-method-without-abstract
class EmptyMethodClass(ABC):
    @abstractmethod
    def required(self):
        ...

    def do_nothing(self):
        pass


# VIOLATION: code-quality/deterministic/require-await
async def no_await():
    return 42


# VIOLATION: code-quality/deterministic/unused-variable
def has_unused():
    unused_var = compute()
    return 42


# NOTE: assert-in-production skipped because fixture path contains /tests/
def validate(data):
    assert data is not None, "data required"
    return process(data)


# VIOLATION: code-quality/deterministic/bare-raise-outside-except
def bad_raise():
    raise


# VIOLATION: code-quality/deterministic/broad-exception-raised
def vague():
    raise Exception("something happened")


# VIOLATION: code-quality/deterministic/stop-iteration-in-generator
def gen():
    yield 1
    raise StopIteration()


# VIOLATION: code-quality/deterministic/system-exit-not-reraised
def catch_exit():
    try:
        sys.exit(0)
    except SystemExit:
        logging.info("exit caught")
