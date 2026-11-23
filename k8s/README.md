# SQL50 on Kubernetes

Stateless app: progress lives in Postgres, `data/` is embedded in the image with
an optional S3 (Neon object storage) source. No PVC needed.

## Apply

```bash
cp k8s/02-secret.example.yaml k8s/02-secret.yaml   # then fill real values
docker build -t sql50:latest .
kubectl apply -k k8s
kubectl -n sql50 rollout status deploy/sql50
kubectl -n sql50 port-forward svc/sql50 8000:8000
# open http://localhost:8000
```

Images built locally (Docker Desktop, kind, minikube) are visible to the node
only after `kind load docker-image sql50:latest` / `minikube image load
sql50:latest`, or push to a registry and set `images/newName` in
`kustomization.yaml`.

## Files

| File | Purpose |
|---|---|
| `00-namespace.yaml` | `sql50` namespace |
| `01-configmap.yaml` | non-secret env: port, `psql` path, S3 endpoint, AI provider |
| `02-secret.example.yaml` | template for `DATABASE_URL`, AWS keys, Gemini key |
| `03-deployment.yaml` | 1 replica, probes, dropped caps, read-only rootfs |
| `04-service.yaml` | ClusterIP `sql50:8000` |
| `05-ingress.yaml` | optional, blocked by the app's Host guard — read it first |
| `kustomization.yaml` | `kubectl apply -k k8s` |

## Probe choice

- `startupProbe: GET /` — 30 × 3s budget for import-time S3 read + `ensure_tables()`.
- `livenessProbe: GET /` — no DB call, so a Neon outage does not restart pods.
- `readinessProbe: GET /` — no DB call either. A DB-touching probe every few seconds
  keeps Neon compute awake 24/7 and burns the free plan's compute hours.

## Known constraints

1. **Host-header guard.** `app/main.py:44` allows POSTs only from
   `127.0.0.1:<SQL50_PORT>` or `localhost:<SQL50_PORT>`. Port-forward satisfies
   it; an Ingress hostname does not. See `05-ingress.yaml`.
2. **`DATABASE_URL` required.** Without it (or if Neon is unreachable at boot)
   the app exits, so the pod crash-loops until the secret is fixed.
3. **`SQL50_PORT` and the reached port must match**, or POSTs 403.
4. **`maxUnavailable: 0`** means a rollout cannot progress while the new pod's
   readiness probe fails. Handy for safe deploys, painful during a DB outage;
   use `kubectl rollout undo` rather than waiting.
5. Manifests validated with `kubectl kustomize` only — no cluster was reachable
   from this machine, so server-side validation is still pending.
