"""A small status module that the service layer imports, and that can also be
run for ad-hoc local debugging through the project's task runtime. It keeps an
``if __name__ == "__main__":`` guard for that convenience, but it is never
invoked as a standalone ``./file.py`` executable, so it needs no shebang.
"""

STATUS_MESSAGE = "ready"


if __name__ == "__main__":
    print(STATUS_MESSAGE)
