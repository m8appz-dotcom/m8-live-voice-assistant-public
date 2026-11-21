# Spark recovery — 2026-11-19

This branch preserves the selected source variant from `/home/m8apps/projects/Gemini Live`, local HEAD `d3332344685b0de66f222d9a358a376416cb7bef`. It is a recovery snapshot, not a deployment or merge proposal. The local clone may predate the current default branch; do not merge its whole tree without reconciliation.

The original Git history is verified in a private bundle on Spark under `/home/m8apps/backups/github-cleanup-20261119-stage13/m8-live/history.private.bundle`. The bundle stays on Spark and is not published: historical credential findings must not be reintroduced into GitHub. Original selected sources and their hash manifests also remain there with private permissions.

Runtime data, databases, outputs, local environment/credentials, Android signing material, Firebase configuration and caches are excluded. Existing services, original files, branches and default GitHub branches were not changed. Recovery is for source preservation; no production deployment or functional acceptance is implied. Supply necessary configuration securely before running a restored copy.
