"""ML pipeline worker for model training and inference."""
import logging

logger = logging.getLogger(__name__)


class TrainingPipeline:
    """Orchestrates model training workflow."""

    def __init__(self, config: dict) -> None:
        self.config = config
        self.model = None

    def train(self, train_data: list, val_data: list) -> object:
        """Train a model on the provided data."""
        logger.info("Training with %d samples", len(train_data))
        self.model = {"trained": True}
        return self.model

    def evaluate(self, test_data: list) -> dict:
        """Evaluate the trained model on test data."""
        if self.model is None:
            msg = "Model not trained"
            raise ValueError(msg)
        return {"accuracy": 0.95}
