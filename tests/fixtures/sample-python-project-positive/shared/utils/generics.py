"""Generic utility classes with type parameters."""


class Repository[T]:
    """Generic repository base class for data access."""

    def __init__(self) -> None:
        self._store: dict[int, T] = {}

    def get(self, entity_id: int) -> T:
        """Retrieve an entity by its identifier."""
        if entity_id not in self._store:
            raise NotImplementedError
        return self._store[entity_id]

    def save(self, entity: T) -> None:
        """Persist an entity to storage."""
        self._store[id(entity)] = entity
