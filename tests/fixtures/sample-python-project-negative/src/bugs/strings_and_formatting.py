"""Bug violations: strings, formatting, regex, and template patterns."""
import re
from string import Template


# VIOLATION: bugs/deterministic/fstring-missing-placeholders
msg = f"hello world"


# VIOLATION: bugs/deterministic/fstring-docstring
def documented():
    f"""This docstring is an f-string for no reason."""
    pass


# VIOLATION: bugs/deterministic/missing-fstring-syntax
name = "world"
msg = "hello {name}"


# VIOLATION: bugs/deterministic/bad-string-format-character
msg = "value: %z" % 42


# VIOLATION: bugs/deterministic/string-format-mismatch
msg = "Hello %s, you are %d" % ("Alice",)


# VIOLATION: bugs/deterministic/empty-character-class
pattern = re.compile(r"abc[]def")


# SKIP: bugs/deterministic/unraw-re-pattern
pattern2 = re.compile("\bword\b")


# VIOLATION: bugs/deterministic/regex-invalid-python
pattern3 = re.compile(r"(unclosed")


# VIOLATION: bugs/deterministic/regex-empty-alternative-python
pattern4 = re.compile(r"foo|")


# VIOLATION: bugs/deterministic/regex-backreference-invalid
pattern5 = re.compile(r"(abc)\2")


# VIOLATION: bugs/deterministic/regex-group-reference-mismatch-python
pattern6 = re.sub(r"(a)(b)", r"\3", "ab")


# VIOLATION: bugs/deterministic/regex-alternatives-redundant
pattern7 = re.compile(r"abc|abc")


# VIOLATION: bugs/deterministic/regex-lookahead-contradictory
pattern8 = re.compile(r"(?=a)(?=b)")


# VIOLATION: bugs/deterministic/regex-boundary-unmatchable
pattern9 = re.compile(r"$start")


# VIOLATION: bugs/deterministic/regex-possessive-always-fails
pattern10 = re.compile(r"a{2,3}+a")


# VIOLATION: bugs/deterministic/re-sub-positional-args
re.sub(r"\d+", "num", "abc123", re.IGNORECASE)


# VIOLATION: bugs/deterministic/strip-with-multi-chars
cleaned = "hello".strip("helo")


# VIOLATION: bugs/deterministic/confusing-implicit-concat
names = [
    "alice"
    "bob",
    "charlie",
]


# template-string-not-processed and template-str-concatenation need Python 3.14 t-strings
template = Template("Hello $name")
result = str(template)


# VIOLATION: bugs/deterministic/static-key-dict-comprehension
result = {1: x for x in range(10)}


# VIOLATION: bugs/deterministic/static-key-dict-comprehension-ruff
result2 = {"key": v for v in range(10)}
