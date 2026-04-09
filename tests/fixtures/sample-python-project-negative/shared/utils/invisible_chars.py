# VIOLATION: bugs/deterministic/invalid-character-in-source
def has_hidden_char():
    """Function with an invisible zero-width space in the variable name."""
    name​ = "test"
    return name
