class Logger:
    def info(self, message: str, *args) -> None:
        print(f"[INFO] {message}", *args)

    def error(self, message: str, *args) -> None:
        print(f"[ERROR] {message}", *args)

    def warn(self, message: str, *args) -> None:
        print(f"[WARN] {message}", *args)


logger = Logger()
