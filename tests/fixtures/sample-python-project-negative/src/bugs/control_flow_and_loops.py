"""Bug violations: control flow, loops, and unreachable code."""


# VIOLATION: bugs/deterministic/unreachable-code
def unreachable():
    return 42
    print("never reached")


# VIOLATION: bugs/deterministic/loop-at-most-one-iteration
def single_iter(items):
    for item in items:
        return item


# VIOLATION: bugs/deterministic/loop-variable-overrides-iterator
items = [1, 2, 3]
for items in items:
    print(items)


# VIOLATION: bugs/deterministic/modified-loop-iterator
def modify_iter():
    data = [1, 2, 3, 4, 5]
    for item in data:
        if item % 2 == 0:
            data.remove(item)


# SKIP: bugs/deterministic/unused-loop-variable
for idx in range(10):
    print("hello")


# VIOLATION: bugs/deterministic/used-dummy-variable
def process_data(_unused):
    print(_unused)


# VIOLATION: bugs/deterministic/nested-try-catch
def nested_try():
    try:
        risky()
    except ValueError:
        try:
            recover()
        except Exception:
            pass


# VIOLATION: bugs/deterministic/star-assignment-error
a, *b, *c = [1, 2, 3, 4]


# VIOLATION: bugs/deterministic/inconsistent-tuple-return-length
def inconsistent_return(flag):
    if flag:
        return (1, 2)
    else:
        return (1, 2, 3)


# SKIP: bugs/deterministic/unary-prefix-increment-decrement
x = 5
y = ++x
# SKIP: bugs/deterministic/unary-prefix-increment-decrement
z = --x
