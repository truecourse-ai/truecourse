"""Legacy setup.py for the worker service package."""
from setuptools import setup, find_packages

setup(
    name="worker-service",
    version="1.0.0",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=[
        "celery>=5.0",
        "redis>=4.0",
        "pydantic>=2.0",
    ],
)
