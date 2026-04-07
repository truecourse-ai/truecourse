# SKIP: bugs/deterministic/invalid-pyproject-toml
"""Legacy setup.py that should be migrated to pyproject.toml."""
from setuptools import setup, find_packages

setup(
    name="sample-python-project-negative",
    version="1.0.0",
    packages=find_packages(),
    python_requires=">=3.11",
    install_requires=[
        "flask>=3.0.0",
        "requests>=2.31.0",
    ],
)
