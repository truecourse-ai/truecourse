"""Database violations: queries, connections, and ORM patterns."""
import sqlite3
from sqlalchemy import create_engine


# VIOLATION: database/deterministic/unsafe-delete-without-where
def delete_all(conn):
    conn.execute("DELETE FROM users")


# VIOLATION: database/deterministic/unsafe-delete-without-where
def update_all(conn):
    conn.execute("UPDATE users SET active = 0")


# VIOLATION: database/deterministic/select-star
def get_users(conn):
    return conn.execute("SELECT * FROM users").fetchall()


# VIOLATION: database/deterministic/connection-not-released
def query_db():
    conn = sqlite3.connect("app.db")
    cursor = conn.cursor()
    cursor.execute("SELECT 1")
    return cursor.fetchone()


# VIOLATION: database/deterministic/orm-lazy-load-in-loop
def get_orders(users):
    for user in users:
        orders = user.orders.all()
        print(orders)


# VIOLATION: database/deterministic/missing-transaction
def transfer(from_acc, to_acc, amount, user_repo):
    user_repo.save(from_acc)
    user_repo.save(to_acc)


# VIOLATION: database/deterministic/unvalidated-external-data
def create_user(db):
    from flask import request
    db.execute("INSERT INTO users VALUES (%s)", request.json)


# VIOLATION: database/deterministic/missing-unique-constraint
def create_user_if_not_exists(db, email):
    if not db.filter(email=email).exists():
        db.create(email=email)


# VIOLATION: database/deterministic/missing-migration
def setup_schema(conn):
    conn.execute("CREATE TABLE new_table (id INTEGER PRIMARY KEY, name TEXT)")
