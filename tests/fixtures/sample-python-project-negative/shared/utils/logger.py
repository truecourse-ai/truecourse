# VIOLATION: style/deterministic/docstring-completeness
class Logger:
    # VIOLATION: style/deterministic/docstring-completeness
    def info(self, message: str, *args) -> None:
        # VIOLATION: code-quality/deterministic/console-log
        print(f"[INFO] {message}", *args)

    # VIOLATION: style/deterministic/docstring-completeness
    def error(self, message: str, *args) -> None:
        # VIOLATION: code-quality/deterministic/console-log
        print(f"[ERROR] {message}", *args)

    # VIOLATION: style/deterministic/docstring-completeness
    def warn(self, message: str, *args) -> None:
        # VIOLATION: code-quality/deterministic/console-log
        print(f"[WARN] {message}", *args)


logger = Logger()
