# Deployment

<!-- PLANTED CLASSIFICATION: filename DEPLOYMENT.md should classify as
     'runbook'. The consolidator's discovery picks it up but most of
     this content has no extractable claims (operational, not
     contract-shaped). -->

## Production

- AWS EC2 + RDS Postgres
- Auto-scaling group, 2-3 instances behind ALB
- Deploys via GitHub Actions on push to `main`

## Rollback

Re-deploy the previous tag. There's no in-place rollback.
