"""Code patterns for additional analyzer rules."""
import threading
from dataclasses import dataclass
from typing import ClassVar


# ===========================================================================
# if-else-dict-lookup: Long if-elif chain that assigns to the same variable
# ===========================================================================

def get_status_label(code):
    """Convert status code to label."""
    # VIOLATION: code-quality/deterministic/if-else-dict-lookup
    if code == 1:
        label = "pending"
    elif code == 2:
        label = "active"
    elif code == 3:
        label = "paused"
    elif code == 4:
        label = "completed"
    return label


# ===========================================================================
# if-else-instead-of-dict-get: if key in dict pattern
# ===========================================================================

def get_config_value(config, key):
    """Get a config value with default."""
    # VIOLATION: code-quality/deterministic/if-else-instead-of-dict-get
    if key in config:
        val = config[key]
    else:
        val = "default"
    return val


# ===========================================================================
# if-else-instead-of-ternary: Simple if/else assigning to same var
# ===========================================================================

def classify_number(x):
    """Classify number as positive or negative."""
    # VIOLATION: code-quality/deterministic/if-else-instead-of-ternary
    if x > 0:
        result = "positive"
    else:
        result = "negative"
    return result


# ===========================================================================
# redefined-loop-name: Loop var reassigned inside body
# ===========================================================================

def process_items(items):
    """Process items but accidentally redefine loop variable."""
    output = []
    # VIOLATION: code-quality/deterministic/redefined-loop-name
    for item in items:
        item = item.strip().lower()
        output.append(item)
    return output


# ===========================================================================
# unnecessary-generator-comprehension: list(x for x in ...)
# ===========================================================================

def get_names(users):
    """Extract names from user list."""
    # VIOLATION: code-quality/deterministic/unnecessary-generator-comprehension
    return list(u.name for u in users)


# ===========================================================================
# useless-with-lock: Creating a new Lock inside with statement
# ===========================================================================

def unsafe_increment(counter):
    """Increment counter with useless lock."""
    # VIOLATION: code-quality/deterministic/useless-with-lock
    with threading.Lock():
        counter["value"] += 1
    return counter


# ===========================================================================
# django-model-form-fields: ModelForm with fields = '__all__'
# ===========================================================================

class ModelForm:
    """Base class stub."""
    pass


class UserProfileForm(ModelForm):
    """Form that exposes all fields."""
    class Meta:
        model = None
        # VIOLATION: code-quality/deterministic/django-model-form-fields
        fields = "__all__"


# ===========================================================================
# implicit-classvar-in-dataclass: ALL_CAPS var without ClassVar in dataclass
# ===========================================================================

@dataclass
class AppConfig:
    """Application configuration."""
    # VIOLATION: bugs/deterministic/implicit-classvar-in-dataclass
    MAX_RETRIES: int = 3
    name: str = "default"


# ===========================================================================
# template-str-concatenation: t-string + regular string
# ===========================================================================

def build_greeting(name):
    """Build greeting with template concatenation."""
    # VIOLATION: bugs/deterministic/template-str-concatenation
    message = t"hello {name}" + " welcome"
    return message


# ===========================================================================
# template-string-not-processed: t-string used without processing
# ===========================================================================

def greet(name):
    """Greet user with unprocessed template."""
    # VIOLATION: bugs/deterministic/template-string-not-processed
    return t"hello {name}"


# ===========================================================================
# assert-in-production: assert in non-test code
# ===========================================================================

def validate_input(data):
    """Validate input using assert."""
    # VIOLATION: code-quality/deterministic/assert-in-production
    assert data is not None


# ===========================================================================
# print-statement-in-production: print() in non-test code
# ===========================================================================

def log_status(status):
    """Log status using print."""
    # VIOLATION: code-quality/deterministic/print-statement-in-production
    print(f"Status: {status}")


# ===========================================================================
# deeply-nested-fstring: f-string inside another f-string
# ===========================================================================

def format_user_info(user):
    """Format user info with nested f-strings."""
    # VIOLATION: code-quality/deterministic/deeply-nested-fstring
    return f"User: {f'{user.name} ({user.id})'}"


# ===========================================================================
# invalid-print-syntax: Python 2 print >> stderr
# ===========================================================================

import sys

# VIOLATION: bugs/deterministic/invalid-print-syntax
print >> sys.stderr, "error occurred"


# ===========================================================================
# yield-return-outside-function: yield at module level
# ===========================================================================

# VIOLATION: bugs/deterministic/yield-return-outside-function
yield 42
