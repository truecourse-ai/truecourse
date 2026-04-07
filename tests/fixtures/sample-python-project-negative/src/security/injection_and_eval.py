"""Security violations: injection, eval, and command execution."""
import os
import subprocess
import sqlite3


# VIOLATION: security/deterministic/sql-injection
def get_user(user_id):
    conn = sqlite3.connect("db.sqlite")
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
    return cursor.fetchone()


# VIOLATION: security/deterministic/eval-usage
def dynamic_eval(expr):
    return eval(expr)


# VIOLATION: security/deterministic/eval-usage
def dynamic_exec(code):
    exec(code)


# VIOLATION: security/deterministic/os-command-injection
def run_cmd(user_input):
    os.system(f"echo {user_input}")


# VIOLATION: security/deterministic/os-command-injection
def run_shell(cmd):
    subprocess.call(cmd, shell=True)


# VIOLATION: security/deterministic/subprocess-security
def run_relative():
    subprocess.Popen(["curl", "http://example.com"])


# VIOLATION: security/deterministic/subprocess-without-shell
def run_no_shell(user_input):
    subprocess.run(user_input, shell=True)


# VIOLATION: security/deterministic/process-start-no-shell
def start_proc():
    subprocess.Popen("ls -la")


# VIOLATION: security/deterministic/process-with-partial-path
def partial_path():
    subprocess.run(["python", "script.py"])


# VIOLATION: security/deterministic/partial-path-execution
def exec_partial():
    os.execvp("python", ["python", "script.py"])


# VIOLATION: security/deterministic/wildcard-in-os-command
def wildcard_cmd():
    os.system("rm -rf /tmp/*")


# VIOLATION: security/deterministic/django-raw-sql
def django_raw(user_input):
    from django.db import models
    users = models.User.objects.raw(f"SELECT * FROM users WHERE name = '{user_input}'")
