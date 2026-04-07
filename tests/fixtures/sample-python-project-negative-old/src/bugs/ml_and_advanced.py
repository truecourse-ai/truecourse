"""Bug violations: ML frameworks, advanced patterns, and misc."""
import numpy as np
import tensorflow as tf
import torch
import torch.nn as nn
from sklearn.pipeline import Pipeline
from sklearn.base import BaseEstimator
import pytest
from functools import singledispatch, singledispatchmethod
from typing import TYPE_CHECKING


# VIOLATION: bugs/deterministic/pytorch-nn-module-missing-super
class MyModel(nn.Module):
    def __init__(self):
        self.layer = nn.Linear(10, 5)


# VIOLATION: bugs/deterministic/sklearn-estimator-trailing-underscore
class MyEstimator(BaseEstimator):
    def __init__(self):
        self.coef_ = None


# VIOLATION: bugs/deterministic/sklearn-pipeline-invalid-params
pipe = Pipeline([("scaler", StandardScaler()), ("model", LogisticRegression())])
pipe.set_params(scaler_alpha=True)


# VIOLATION: bugs/deterministic/scikit-pipeline-cache-direct-access
pipe.steps[0][1].fit(X)


# VIOLATION: bugs/deterministic/tf-function-side-effects
@tf.function
def train_step(data):
    print("training")
    return tf.reduce_mean(data)


# VIOLATION: bugs/deterministic/ml-reduction-axis-missing
tensor = np.array([1, 2, 3])
means = tensor.mean()


# VIOLATION: bugs/deterministic/einops-pattern-invalid
from einops import rearrange
result = rearrange(tensor, "b c h w -> b c h w z")


# VIOLATION: bugs/deterministic/numpy-weekmask-invalid
cal = np.busdaycalendar(weekmask="MonTuWeFr")


# VIOLATION: bugs/deterministic/pandas-nunique-constant-series
import pandas as pd
n = pd.Series([1, 1, 1]).nunique()


# VIOLATION: bugs/deterministic/pytest-fixture-misuse
@pytest.fixture
@pytest.mark.usefixtures("db")
def my_fixture():
    return 42


# SKIP: bugs/deterministic/pytest-assert-always-false
def test_always_false():
    assert False


# VIOLATION: bugs/deterministic/pytest-raises-ambiguous-pattern
def test_ambiguous():
    with pytest.raises(ValueError, match="invalid value"):
        raise ValueError("invalid value")


# VIOLATION: bugs/deterministic/legacy-pytest-raises
def test_legacy():
    pytest.raises(ValueError, int, "abc")


# VIOLATION: bugs/deterministic/singledispatch-method-mismatch
class Processor:
    @singledispatch
    def process(self, data):
        pass


# VIOLATION: bugs/deterministic/runtime-import-in-type-checking
if TYPE_CHECKING:
    import heavy_module

def use_heavy(obj):
    return isinstance(obj, heavy_module)


# VIOLATION: bugs/deterministic/redefined-slots-in-subclass
class Base:
    __slots__ = ("x", "y")

class Child(Base):
    __slots__ = ("x", "z")


# VIOLATION: bugs/deterministic/method-override-contract-change
class BaseProcessor:
    def process(self, data: str) -> int:
        return len(data)

class ChildProcessor(BaseProcessor):
    def process(self, data: int, flag: bool) -> str:
        return str(data)


# VIOLATION: bugs/deterministic/argument-type-mismatch-python
def add_numbers(a: int, b: int) -> int:
    return a + b

result = add_numbers("hello")


import sys
if sys.version_info >= (3, 10):
    from typing import TypeGuard


# VIOLATION: bugs/deterministic/access-annotations-from-class-dict
class Annotated:
    x: int = 5

annotations = Annotated.__dict__["__annotations__"]


# VIOLATION: bugs/deterministic/airflow-usage-error
from airflow import DAG
from airflow.operators.python import PythonOperator

with DAG("my_dag") as dag:
    task = PythonOperator(task_id="task", python_callable=lambda: None)
    task >> task


# VIOLATION: bugs/deterministic/lambda-network-call-no-timeout
import urllib.request

def lambda_handler(event, context):
    urllib.request.urlopen("https://api.example.com")
    return {"statusCode": 200}


# VIOLATION: bugs/deterministic/lambda-tmp-not-cleaned
def handler(event, context):
    with open("/tmp/data.json", "w") as f:
        f.write("{}")
    return {"statusCode": 200}


# VIOLATION: bugs/deterministic/lambda-handler-returns-non-serializable
def api_handler(event, context):
    return set([1, 2, 3])


# VIOLATION: bugs/deterministic/fstring-in-gettext
from gettext import gettext as _
msg = _(f"Hello {name}")


# VIOLATION: bugs/deterministic/future-feature-not-defined
from __future__ import nonexistent_feature


# invalid-character and bidirectional-unicode tested in ml_special_chars.py
