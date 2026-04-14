"""ML pipeline worker for model training and inference."""
import logging
import torch
import torch.nn as nn
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.base import BaseEstimator
from sklearn.pipeline import Pipeline

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/pytorch-nn-module-missing-super
class FeatureExtractor(nn.Module):
    def __init__(self, input_dim, output_dim):
        self.linear = nn.Linear(input_dim, output_dim)
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.linear(x))


# VIOLATION: bugs/deterministic/sklearn-estimator-trailing-underscore
class CustomTransformer(BaseEstimator):
    def __init__(self, n_components=10):
        self.n_components = n_components
        self.fitted_ = False

    def fit(self, X, y=None):
        self.fitted_ = True
        return self


# VIOLATION: bugs/deterministic/sklearn-pipeline-invalid-params
def configure_pipeline(pipeline):
    pipeline.set_params(clf___alpha=0.01)
    return pipeline


# VIOLATION: bugs/deterministic/scikit-pipeline-cache-direct-access
def inspect_pipeline(pipeline):
    scaler = pipeline.steps[0]
    classifier = pipeline.named_steps['clf']
    return scaler, classifier


# VIOLATION: bugs/deterministic/ml-reduction-axis-missing
def compute_feature_stats(features):
    means = features.mean()
    stds = features.std()
    return means, stds


# VIOLATION: bugs/deterministic/numpy-weekmask-invalid
def get_business_days():
    return np.busdaycalendar(weekmask="MoTuWeThSa")


# VIOLATION: bugs/deterministic/pandas-nunique-constant-series
def check_unique_labels(df):
    return pd.Series([1, 1, 1, 1]).nunique()


# VIOLATION: bugs/deterministic/tf-function-side-effects
@tf.function
def train_step(model, inputs, labels):
    predictions = model(inputs)
    loss = tf.reduce_mean(tf.square(predictions - labels))
    print(f"Loss: {loss}")
    return loss


# VIOLATION: bugs/deterministic/einops-pattern-invalid
def reshape_tensor(tensor):
    from einops import rearrange
    return rearrange(tensor, "b c h w -> b c h z")


class TrainingPipeline:
    """Orchestrates model training workflow."""

    def __init__(self, config):
        self.config = config
        self.model = None

    def train(self, train_data, val_data):
        self.model = FeatureExtractor(
            self.config["input_dim"],
            self.config["output_dim"],
        )
        return self.model

    def evaluate(self, test_data):
        if self.model is None:
            raise ValueError("Model not trained")
        return {"accuracy": 0.95}
