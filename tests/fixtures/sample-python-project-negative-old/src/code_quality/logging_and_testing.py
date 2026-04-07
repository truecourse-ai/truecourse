"""Code quality violations: logging, testing, and framework patterns."""
import logging
import unittest
import pytest


# VIOLATION: code-quality/deterministic/logging-string-format
logging.info("User %s logged in at %s" % ("alice", "10:00"))


# VIOLATION: code-quality/deterministic/logging-direct-instantiation
logger = logging.Logger("my_logger")


# VIOLATION: code-quality/deterministic/logging-root-logger-call
logging.info("root logger call")


# VIOLATION: code-quality/deterministic/logging-exc-info-instead-of-exception
def log_error():
    try:
        risky()
    except Exception:
        logging.error("failed", exc_info=True)


# VIOLATION: code-quality/deterministic/logging-extra-attr-clash
logging.info("msg", extra={"message": "clash"})


# VIOLATION: code-quality/deterministic/logging-redundant-exc-info
def redundant_exc():
    try:
        risky()
    except Exception:
        logging.exception("failed", exc_info=True)


# VIOLATION: code-quality/deterministic/pytest-unittest-assertion
class TestOld(unittest.TestCase):
    def test_value(self):
        self.assertEqual(1, 1)


# VIOLATION: code-quality/deterministic/pytest-composite-assertion
def test_composite():
    assert x > 0 and y > 0


# VIOLATION: code-quality/deterministic/pytest-fail-without-message
def test_fail():
    pytest.fail()


# VIOLATION: code-quality/deterministic/pytest-raises-multiple-statements
def test_raises_multi():
    with pytest.raises(ValueError):
        setup()
        trigger_error()
        cleanup()


# VIOLATION: code-quality/deterministic/pytest-assert-in-except
def test_except():
    try:
        risky()
    except ValueError as e:
        assert str(e) == "expected"


# VIOLATION: code-quality/deterministic/pytest-warns-issues
def test_warns():
    with pytest.warns():
        do_something()


# VIOLATION: code-quality/deterministic/pytest-suboptimal-pattern
def test_suboptimal(request):
    request.addfinalizer(cleanup)


# VIOLATION: code-quality/deterministic/pytest-duplicate-parametrize
@pytest.mark.parametrize("x", [1, 1, 3])
def test_dup_param(x):
    assert x > 0


# VIOLATION: code-quality/deterministic/unittest-specific-assertion
class TestSpecific(unittest.TestCase):
    def test_in(self):
        self.assertTrue(1 in [1, 2, 3])


# VIOLATION: code-quality/deterministic/test-not-discoverable
class TestSuite:
    def hidden_check(self):
        assert True


# VIOLATION: code-quality/deterministic/test-skipped-implicitly
@pytest.mark.skip
def test_skip_no_reason():
    pass
