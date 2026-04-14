"""Data processing pipeline with pandas, numpy, and ML operations."""
import os
import re
import logging
import asyncio
from typing import Optional, Dict, List, Any

import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
import torch

logger = logging.getLogger(__name__)


# --- NumPy violations ---

# VIOLATION: code-quality/deterministic/numpy-deprecated-type-alias
def create_array() -> np.ndarray:
    return np.zeros(10, dtype=np.float)


# VIOLATION: code-quality/deterministic/numpy-legacy-random
def generate_random_data(n: int) -> np.ndarray:
    return np.random.random(n)


# VIOLATION: code-quality/deterministic/numpy-reproducible-random
def sample_data(data: np.ndarray, n: int) -> np.ndarray:
    indices = np.random.choice(len(data), n)
    return data[indices]


# VIOLATION: code-quality/deterministic/numpy-list-to-array
def convert_to_array(values: list) -> np.ndarray:
    return np.array(float(v) for v in values)


# VIOLATION: code-quality/deterministic/numpy-nonzero-preferred
def find_nonzero(arr: np.ndarray):
    return np.where(arr != 0)


# --- Pandas violations ---

# VIOLATION: code-quality/deterministic/pandas-inplace-argument
def clean_dataframe(df: pd.DataFrame) -> None:
    df.dropna(inplace=True)
    df.reset_index(inplace=True)


# VIOLATION: code-quality/deterministic/pandas-read-csv-dtype
def load_csv(path: str) -> pd.DataFrame:
    return pd.read_csv(path)


# VIOLATION: code-quality/deterministic/pandas-merge-parameters
def merge_datasets(df1: pd.DataFrame, df2: pd.DataFrame) -> pd.DataFrame:
    return df1.merge(df2)


# VIOLATION: code-quality/deterministic/pandas-use-of-dot-values
def get_column_values(df: pd.DataFrame, col: str) -> np.ndarray:
    return df[col].values


# VIOLATION: code-quality/deterministic/pandas-datetime-format
def parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    df["date"] = pd.to_datetime("2024-01-15", dayfirst=True)
    return df


# VIOLATION: code-quality/deterministic/pandas-deprecated-accessor
def get_date_parts(df: pd.DataFrame) -> pd.DataFrame:
    df["year"] = df["date"].dt.year
    return df


# VIOLATION: code-quality/deterministic/pandas-accessor-preference
def get_string_lengths(df: pd.DataFrame) -> pd.Series:
    return df.at["row1", "name"]


# VIOLATION: code-quality/deterministic/pandas-pipe-preferred
def transform_pipeline(df: pd.DataFrame) -> pd.DataFrame:
    return df.fillna(0).groupby("cat").agg("sum").sort_values("val").reset_index()


def clean_nulls(df: pd.DataFrame) -> pd.DataFrame:
    return df.fillna(0)


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include=[np.number]).columns:
        df[col] = (df[col] - df[col].mean()) / (df[col].std() + 1e-8)
    return df


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df["total"] = df.select_dtypes(include=[np.number]).sum(axis=1)
    return df


# VIOLATION: bugs/deterministic/pandas-nunique-constant-series
def check_constant_column(df: pd.DataFrame, col: str) -> bool:
    return pd.Series([1, 1, 1, 1]).nunique() == 1


# --- sklearn violations ---

# VIOLATION: code-quality/deterministic/sklearn-pipeline-memory
def build_pipeline() -> Pipeline:
    return Pipeline([
        ("clf", RandomForestClassifier())
    ])


# VIOLATION: code-quality/deterministic/ml-missing-hyperparameters
def create_model():
    return RandomForestClassifier()


# --- PyTorch violations ---

# VIOLATION: code-quality/deterministic/torch-autograd-variable
def create_variable(data):
    return torch.autograd.Variable(torch.tensor(data))


# VIOLATION: code-quality/deterministic/torch-model-eval-train
class SimpleModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = torch.nn.Linear(10, 2)

    def forward(self, x):
        return self.linear(x)


def predict(model: SimpleModel, data: torch.Tensor) -> torch.Tensor:
    model.load_state_dict(torch.load("model.pth"))
    output = model(data)
    return output


# --- Async violations ---

# VIOLATION: code-quality/deterministic/async-unused-async
async def fetch_config(url: str) -> dict:
    return {"url": url, "status": "ok"}


# VIOLATION: code-quality/deterministic/async-zero-sleep
async def yield_control():
    await asyncio.sleep(0)
    return True


# VIOLATION: code-quality/deterministic/async-long-sleep
async def wait_forever():
    await asyncio.sleep(100000)


# VIOLATION: code-quality/deterministic/async-single-task-group
async def run_single_task():
    async with asyncio.TaskGroup() as tg:
        tg.start_soon(asyncio.sleep(1))


# --- Complexity violations ---

# VIOLATION: code-quality/deterministic/cyclomatic-complexity
# VIOLATION: code-quality/deterministic/cognitive-complexity
# VIOLATION: code-quality/deterministic/too-many-branches
# VIOLATION: code-quality/deterministic/too-many-return-statements
def classify_data_point(value: float, category: str, source: str,
                        weight: float, active: bool, priority: int) -> str:
    if value > 100:
        if category == "A":
            if source == "internal":
                return "high_internal_a"
            elif source == "external":
                return "high_external_a"
            else:
                return "high_unknown_a"
        elif category == "B":
            return "high_b"
        elif category == "C":
            if weight > 0.5:
                return "high_c_heavy"
            else:
                return "high_c_light"
        else:
            return "high_other"
    elif value > 50:
        if active:
            if priority > 5:
                return "mid_active_priority"
            else:
                return "mid_active_normal"
        else:
            return "mid_inactive"
    elif value > 10:
        return "low"
    else:
        if not active and priority < 2:
            return "negligible"
        return "minimal"


# VIOLATION: code-quality/deterministic/too-many-positional-arguments
def process_record(id: int, name: str, category: str, value: float,
                   weight: float, source: str, priority: int) -> dict:
    return {
        "id": id, "name": name, "category": category,
        "value": value, "weight": weight, "source": source,
        "priority": priority,
    }


# VIOLATION: code-quality/deterministic/too-many-locals
def compute_statistics(data: List[float]) -> dict:
    n = len(data)
    total = sum(data)
    mean = total / n if n else 0
    sorted_data = sorted(data)
    minimum = sorted_data[0] if sorted_data else 0
    maximum = sorted_data[-1] if sorted_data else 0
    median_idx = n // 2
    median = sorted_data[median_idx] if sorted_data else 0
    variance = sum((x - mean) ** 2 for x in data) / n if n else 0
    std_dev = variance ** 0.5
    range_val = maximum - minimum
    q1_idx = n // 4
    q3_idx = 3 * n // 4
    q1 = sorted_data[q1_idx] if sorted_data else 0
    q3 = sorted_data[q3_idx] if sorted_data else 0
    iqr = q3 - q1
    skewness = sum((x - mean) ** 3 for x in data) / (n * std_dev ** 3) if n and std_dev else 0
    return {
        "n": n, "mean": mean, "median": median, "std": std_dev,
        "min": minimum, "max": maximum, "range": range_val,
        "q1": q1, "q3": q3, "iqr": iqr, "skew": skewness,
    }


# VIOLATION: code-quality/deterministic/too-many-nested-blocks
def deep_process(data: dict) -> Optional[str]:
    if "records" in data:
        for record in data["records"]:
            if record.get("active"):
                for item in record.get("items", []):
                    if item.get("valid"):
                        for sub in item.get("subitems", []):
                            if sub.get("status") == "ready":
                                return sub["id"]
    return None


# VIOLATION: code-quality/deterministic/too-many-statements
def long_data_pipeline(raw: List[dict]) -> dict:
    validated = []
    errors = []
    warnings = []
    totals = {}
    counts = {}
    categories = set()
    sources = set()
    for item in raw:
        if "id" not in item:
            errors.append("missing id")
            continue
        if "value" not in item:
            warnings.append(f"missing value for {item['id']}")
            continue
        validated.append(item)
        cat = item.get("category", "unknown")
        categories.add(cat)
        src = item.get("source", "unknown")
        sources.add(src)
        if cat not in totals:
            totals[cat] = 0
        totals[cat] += item["value"]
        if cat not in counts:
            counts[cat] = 0
        counts[cat] += 1
    averages = {}
    for cat in totals:
        if counts[cat] > 0:
            averages[cat] = totals[cat] / counts[cat]
        else:
            averages[cat] = 0
    summary = {
        "total_records": len(raw),
        "valid_records": len(validated),
        "error_count": len(errors),
        "warning_count": len(warnings),
        "categories": list(categories),
        "sources": list(sources),
        "totals": totals,
        "counts": counts,
        "averages": averages,
    }
    max_cat = max(totals, key=totals.get) if totals else None
    min_cat = min(totals, key=totals.get) if totals else None
    summary["top_category"] = max_cat
    summary["bottom_category"] = min_cat
    total_sum = sum(totals.values())
    summary["grand_total"] = total_sum
    overall_avg = total_sum / len(totals) if totals else 0
    summary["overall_average"] = overall_avg
    pct_valid = len(validated) / len(raw) * 100 if raw else 0
    summary["pct_valid"] = pct_valid
    logger.info(f"Pipeline complete: {len(validated)}/{len(raw)} valid")
    logger.info(f"Categories: {len(categories)}, Sources: {len(sources)}")
    logger.info(f"Top category: {max_cat}")
    return summary


# VIOLATION: code-quality/deterministic/too-many-lines
def transform_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """Transform a dataset through multiple stages."""
    df = df.copy()
    df.columns = [c.lower().strip() for c in df.columns]
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    string_cols = df.select_dtypes(include=["object"]).columns
    for col in numeric_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)
    for col in string_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            df[col] = df[col].fillna("unknown")
    for col in numeric_cols:
        col_min = df[col].min()
        col_max = df[col].max()
        if col_max > col_min:
            df[f"{col}_normalized"] = (df[col] - col_min) / (col_max - col_min)
        else:
            df[f"{col}_normalized"] = 0
    for col in string_cols:
        value_counts = df[col].value_counts()
        if len(value_counts) < 20:
            dummies = pd.get_dummies(df[col], prefix=col)
            df = pd.concat([df, dummies], axis=1)
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["year"] = df["date"].dt.year
        df["month"] = df["date"].dt.month
        df["day"] = df["date"].dt.day
        df["dayofweek"] = df["date"].dt.dayofweek
    for col in numeric_cols:
        q1 = df[col].quantile(0.25)
        q3 = df[col].quantile(0.75)
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        df[f"{col}_outlier"] = (df[col] < lower_bound) | (df[col] > upper_bound)
    if len(numeric_cols) >= 2:
        col_a = numeric_cols[0]
        col_b = numeric_cols[1]
        df["interaction"] = df[col_a] * df[col_b]
        df["ratio"] = df[col_a] / (df[col_b] + 1e-8)
        df["sum_ab"] = df[col_a] + df[col_b]
        df["diff_ab"] = df[col_a] - df[col_b]
    df["row_sum"] = df[numeric_cols].sum(axis=1)
    df["row_mean"] = df[numeric_cols].mean(axis=1)
    df["row_std"] = df[numeric_cols].std(axis=1)
    df["row_min"] = df[numeric_cols].min(axis=1)
    df["row_max"] = df[numeric_cols].max(axis=1)
    df["row_range"] = df["row_max"] - df["row_min"]
    for col in numeric_cols:
        df[f"{col}_squared"] = df[col] ** 2
        df[f"{col}_log"] = np.log1p(df[col].clip(lower=0))
    return df
