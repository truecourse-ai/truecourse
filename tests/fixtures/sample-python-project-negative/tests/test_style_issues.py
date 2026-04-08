"""Test file with style violations."""
import pytest


# VIOLATION: style/deterministic/pytest-decorator-style
@pytest.mark.parametrize
def test_user_creation():
    """Test that should use parametrize with arguments."""
    assert True


def test_basic_math():
    """Normal test without issues."""
    assert 1 + 1 == 2
