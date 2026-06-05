"""Architecture regression: spec asserts a data-store that is not detected.

Contract `arch.regression.data-store-chosen-absent` asserts `chosen dynamodb`.
The codebase (requirements.txt) has `psycopg2-binary` (postgres signal) but no
DynamoDB package — so `dynamodb` is never observed while `postgres` is.

Expected drifts:
  - unmet-choice:           dynamodb not detected in the code
  - forbidden-alternative:  postgres is detected but is not the chosen value

# IL-DRIFT: ArchitectureDecision:arch.regression.data-store-chosen-absent / architecture.data-store.unmet-choice
# IL-DRIFT: ArchitectureDecision:arch.regression.data-store-chosen-absent / architecture.data-store.forbidden-alternative
"""
