"""Code quality violations: framework and library patterns."""
import os
import time
import numpy as np
import pandas as pd
import tensorflow as tf
import torch
import boto3
import uvicorn
from sklearn.pipeline import Pipeline
from fastapi import FastAPI, APIRouter, Depends
from flask import Flask


# VIOLATION: code-quality/deterministic/numpy-deprecated-type-alias
arr = np.int(5)


# VIOLATION: code-quality/deterministic/numpy-legacy-random
val = np.random.random()


# VIOLATION: code-quality/deterministic/numpy-nonzero-preferred
mask = np.where(arr > 0)


# VIOLATION: code-quality/deterministic/numpy-list-to-array
data = np.array(x * 2 for x in range(10))


# VIOLATION: code-quality/deterministic/numpy-reproducible-random
result = np.random.randn(10)


# VIOLATION: code-quality/deterministic/pandas-deprecated-accessor
df = pd.DataFrame({"a": [1, 2]})
val = df.ix[0]


# VIOLATION: code-quality/deterministic/pandas-inplace-argument
df.drop("col", inplace=True)


# VIOLATION: code-quality/deterministic/pandas-read-csv-dtype
data = pd.read_csv("data.csv")


# VIOLATION: code-quality/deterministic/pandas-use-of-dot-values
values = df.values


# VIOLATION: code-quality/deterministic/pandas-accessor-preference
subset = df.at["row", "col"]


# VIOLATION: code-quality/deterministic/pandas-pipe-preferred
result = df.groupby("a").agg("sum").sort_values("b").reset_index().rename(columns={"a": "x"})


# VIOLATION: code-quality/deterministic/pandas-datetime-format
dates = pd.to_datetime("2024-01-15", dayfirst=True)


# VIOLATION: code-quality/deterministic/pandas-merge-parameters
merged = pd.merge(df1, df2)


# VIOLATION: code-quality/deterministic/torch-autograd-variable
x = torch.autograd.Variable(torch.randn(3, 4))


# VIOLATION: code-quality/deterministic/torch-model-eval-train
model = torch.nn.Linear(10, 5)
model.load_state_dict(torch.load("weights.pth"))
output = model(input_data)


# VIOLATION: code-quality/deterministic/tf-gather-validate-indices
indices = tf.constant([0, 1, 100])
result = tf.gather(params, indices, validate_indices=True)


# VIOLATION: code-quality/deterministic/tf-function-recursive
@tf.function
def recursive(n):
    if n <= 0:
        return 0
    return n + recursive(n - 1)


# VIOLATION: code-quality/deterministic/tf-function-global-variable
global_var = tf.Variable(0.0)

@tf.function
def increment():
    global global_var
    global_var.assign_add(1.0)


# VIOLATION: code-quality/deterministic/tf-variable-singleton
@tf.function
def create_var():
    w = tf.Variable(tf.zeros([10]))
    return w


# VIOLATION: code-quality/deterministic/tf-keras-input-shape
class MyModel(tf.keras.Model):
    def __init__(self, input_shape):
        super().__init__()


# VIOLATION: code-quality/deterministic/ml-missing-hyperparameters
from sklearn.ensemble import RandomForestClassifier
clf = RandomForestClassifier()


# VIOLATION: code-quality/deterministic/sklearn-pipeline-memory
pipe = Pipeline([("scaler", StandardScaler()), ("model", LogisticRegression())])


# VIOLATION: code-quality/deterministic/boto3-pagination
s3 = boto3.client("s3")
objects = s3.list_objects_v2(Bucket="mybucket")


# VIOLATION: code-quality/deterministic/boto3-client-error
try:
    client = boto3.client("s3")
    client.head_object(Bucket="mybucket", Key="key")
except Exception:
    pass


# VIOLATION: code-quality/deterministic/aws-cloudwatch-namespace
cw = boto3.client("cloudwatch")
cw.put_metric_data(Namespace="AWS/MyApp", MetricData=[])


# VIOLATION: code-quality/deterministic/aws-hardcoded-region
client = boto3.client("s3", region_name="us-east-1")


# VIOLATION: code-quality/deterministic/aws-custom-polling
while True:
    status = client.describe_instances()
    if status == "COMPLETE":
        break
    time.sleep(30)


# VIOLATION: code-quality/deterministic/fastapi-generic-route-decorator
app = FastAPI()

@app.api_route("/items", methods=["GET"])
def get_items():
    return []


# VIOLATION: code-quality/deterministic/fastapi-non-annotated-dependency
@app.get("/users")
def get_users(db=Depends(get_db)):
    return db.query()


# VIOLATION: code-quality/deterministic/fastapi-router-prefix
router = APIRouter()

app.include_router(router, prefix="/api")


# VIOLATION: code-quality/deterministic/fastapi-import-string
uvicorn.run(app, reload=True)


# VIOLATION: code-quality/deterministic/fastapi-testclient-content
from fastapi.testclient import TestClient
test_client = TestClient(app)
resp = test_client.post("/items", data='{"name": "test"}')


# VIOLATION: code-quality/deterministic/fastapi-undocumented-exception
from fastapi import HTTPException

@app.get("/secret")
def secret():
    raise HTTPException(status_code=403, detail="Forbidden")


# VIOLATION: code-quality/deterministic/flask-rest-verb-annotation
flask_app = Flask(__name__)

@flask_app.route("/update")
def update():
    pass


# VIOLATION: code-quality/deterministic/django-locals-in-render
from django.shortcuts import render

def django_view(request):
    name = "alice"
    age = 30
    return render(request, "template.html", locals())


# SKIP: code-quality/deterministic/django-model-form-fields
from django import forms

class UserForm(forms.ModelForm):
    class Meta:
        fields = '__all__'


# VIOLATION: code-quality/deterministic/django-model-without-str
from django.db import models

class Product(models.Model):
    name = models.CharField(max_length=100)
    price = models.DecimalField(max_digits=10, decimal_places=2)


# VIOLATION: code-quality/deterministic/django-nullable-string-field
class Profile(models.Model):
    bio = models.CharField(max_length=500, null=True)


# VIOLATION: code-quality/deterministic/django-receiver-decorator-order
from django.dispatch import receiver
from django.db.models.signals import post_save

@login_required
@receiver(post_save, sender=Product)
def on_save(sender, instance, **kwargs):
    pass


# VIOLATION: code-quality/deterministic/django-unordered-body-content
class BadOrder(models.Model):
    def __str__(self):
        return self.name

    class Meta:
        ordering = ["name"]

    name = models.CharField(max_length=100)


# VIOLATION: code-quality/deterministic/pytz-deprecated
import pytz
tz = pytz.timezone("US/Eastern")


# VIOLATION: code-quality/deterministic/lambda-async-handler
async def lambda_handler(event, context):
    return {"statusCode": 200}


# VIOLATION: code-quality/deterministic/lambda-init-resources
def handler(event, context):
    import boto3
    s3 = boto3.client("s3")
    return s3.list_buckets()


# VIOLATION: code-quality/deterministic/lambda-sync-invocation
lambda_client = boto3.client("lambda")
lambda_client.invoke(FunctionName="other", InvocationType="RequestResponse")


# VIOLATION: code-quality/deterministic/lambda-reserved-env-var
os.environ["AWS_REGION"] = "us-east-1"


# VIOLATION: code-quality/deterministic/airflow-3-migration
from airflow.operators.python_operator import PythonOperator


# VIOLATION: code-quality/deterministic/compression-namespace-import
import gzip
import bz2
