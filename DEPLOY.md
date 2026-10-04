# Deployment

This is a **Python FastAPI application**. One uvicorn process tree serves both the API and
the web interface, so it needs a host that runs Python — a static host (GitHub Pages,
Netlify, S3) will not work. **Docker is not required** for any of the options below.

- **No database, nothing written to disk.** Uploads are held in memory (the multipart spool
  threshold is raised above the upload limit, so not even a temporary file is written),
  analysed and discarded. Safe on ephemeral and read-only filesystems; scales horizontally
  with no shared state.
- **No Node.js at deploy time.** The interface is compiled into `web/` and committed. The
  only build step is `pip install -r requirements.txt`.
- **Python 3.11.** `render.yaml` pins 3.11.9; `.python-version` and `runtime.txt` state the
  same version for hosts and tools that read them.

---

## Before you deploy

1. **Read the security section below.** There is no authentication: anyone who can reach
   the URL can upload a laboratory report. Fine for a private demo with synthetic data, not
   for real patient data.
2. **Decide what is public.** `samples/` holds synthetic records listed in
   `samples/manifest.toml`. Remove them if you prefer; the sample list then renders empty.
3. **Run the checks** (from a virtualenv):

   ```bash
   pip install -r requirements-dev.txt
   python -m pytest -q          # 324 tests
   python tools/validate.py     # all 7 suites; exits non-zero on failure
   ```

4. **If you changed the interface**, rebuild and commit `web/` (needs Node.js 20.19+):

   ```bash
   cd frontend && npm ci && npm run build
   ```

---

## Option A — Render (recommended, uses `render.yaml`)

1. Push the repository to GitHub.
2. Render dashboard → **New → Blueprint** → select the repository → **Apply**.
3. Wait for the first deploy; Render polls `/api/health` before routing traffic.

`render.yaml` already defines everything:

| Setting | Value |
|---|---|
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app:app --host 0.0.0.0 --port $PORT --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips='*'` |
| Health check path | `/api/health` |
| Python | `PYTHON_VERSION=3.11.9` |
| Branch | `main` — change `branch:` in `render.yaml` if you deploy another branch |

To create the service by hand instead (**New → Web Service**), enter the same build and
start commands and add the environment variable `PYTHON_VERSION=3.11.9`.

The free plan sleeps after ~15 minutes idle; the first request afterwards takes about
30 seconds while the instance wakes. The interface waits up to 45 seconds for its start-up
requests and, if the service is still not answering, says so and offers **Try again**
rather than showing an empty page.

## Option B — Railway or another Procfile-based host

Connect the repository. The host detects Python from `requirements.txt` and runs the
`Procfile`:

```
web: uvicorn app:app --host 0.0.0.0 --port $PORT --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*'
```

Set the health check path to `/api/health` if the platform asks for one.

`--proxy-headers --forwarded-allow-ips='*'` matters on every platform: without the second
flag uvicorn only trusts forwarding headers from 127.0.0.1, so behind the platform's proxy
it would see the proxy's address and plain HTTP instead of the client and HTTPS.

## Option C — your own Linux server (systemd + reverse proxy)

```bash
sudo mkdir -p /srv/labscan && sudo chown "$USER" /srv/labscan
git clone https://github.com/A08rpita0/labscan-lab-report-analyzer.git /srv/labscan
cd /srv/labscan
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`/etc/systemd/system/labscan.service`:

```ini
[Unit]
Description=LabScan
After=network.target

[Service]
User=www-data
WorkingDirectory=/srv/labscan
ExecStart=/srv/labscan/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips='127.0.0.1'
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now labscan
curl http://127.0.0.1:8000/api/health
```

Put nginx or Caddy in front for TLS. With Caddy it is one block and a certificate is
obtained automatically:

```
analytics.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Here the proxy is on the same machine, so `--forwarded-allow-ips` can name it exactly.

## Option D — a laptop, for a demo

Follow **Local setup** and **Run the backend** in the [README](README.md): a virtualenv,
`pip install -r requirements.txt`, then `python -m uvicorn app:app --port 8000`. This works
the same on Windows, macOS and Linux.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8000` | Port to bind (set by the platform on Render/Railway) |
| `WEB_CONCURRENCY` | `2` (`1` on Render free) | uvicorn worker processes |
| `DRE_MAX_UPLOAD_MB` | `20` | Upload size limit, enforced before parsing |
| `DRE_ANALYSIS_TIMEOUT_S` | `60` | Per-analysis time limit; returns 504 when exceeded |
| `DRE_LOG_LEVEL` | `INFO` | Level for the `dre` logger |
| `DRE_ENABLE_OCR` | unset | Enables optional OCR (needs extra packages; see `requirements.txt`) |

**Sizing.** Measured on a fresh install (Windows, Python 3.11): each worker settles at about
60–65 MB working set after start-up and a few analyses, plus about 30 MB for the uvicorn
supervisor, so two workers fit comfortably in 512 MB. Each worker loads and validates the
configuration and imports the PDF library at start-up (~0.1–0.4 s). Analysis is CPU-bound:
the bundled JSON/CSV samples take 3–20 ms of server time and the two-page PDF sample about
0.1–0.25 s, so add workers before adding memory.

---

## Security — read before exposing this publicly

**Already in place**
- Upload size cap enforced before parsing (Content-Length and streamed count) and an
  extension allowlist (`.json .pdf .csv .tsv .txt`); content checks for empty, non-PDF and
  invalid JSON files
- Samples resolved only through the `samples/manifest.toml` allowlist, never as a path
- One error envelope with codes and hints; no exception text, tracebacks or paths reach clients
- Security headers: CSP without inline script/style, `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`; analysis responses are `Cache-Control: no-store`
- CPU-bound analysis runs in a worker thread with a time limit, never on the event loop
- No SQL, no shell execution, no deserialisation of untrusted pickles
- Nothing written to disk; no upload is retained after the response
- Logs record method, path, status, byte count, result counts and timings with a request
  id — never filenames, patient fields or results

**Not in place — add before handling real patient data**
- **Authentication.** There is none. Add a reverse-proxy auth layer, an API key
  dependency, or put it behind a VPN/SSO.
- **Rate limiting.** A large PDF ties up a worker; nothing stops repeated submissions.
- **CORS.** No middleware is configured, so browsers block cross-origin calls by default.
  That is the safe default — only add `CORSMiddleware` with an explicit origin list if you
  genuinely need a separate front end.
- **Platform logging.** The app's own logs are privacy-safe, but check what your proxy or
  platform logs (some record full request metadata) and its retention.
- **TLS.** Terminate HTTPS at the proxy or platform. Never send laboratory data over
  plain HTTP.

**Regulatory.** Health data is regulated in most jurisdictions (HIPAA, GDPR Article 9,
India's DPDP Act). A publicly reachable deployment that accepts real reports puts you in
scope. A private, authenticated deployment used with synthetic or consented data does not
carry the same exposure. This is a product and legal decision, not a technical one. Nothing
in this repository establishes HIPAA or GDPR compliance.

---

## After deploying

```bash
curl https://YOUR-URL/api/health
```

Expected — `status: ok` and zero config errors:

```json
{"status":"ok","version":"2.0.0","config":{"diseases":129,"parameters":252,"aliases":1094,
 "cohorts":82,"disease_links":255,"diseases_linked":128,"diseases_intentionally_unmapped":8},
 "config_fingerprint":{"sha256":"…","files":14,…},"errors":[],…}
```

If `status` is `config_error`, the `errors` array names exactly which cross-reference
broke; the start-up log line `startup config_ok=False` says the same. The app still serves,
so this is diagnosable in place. Then open `https://YOUR-URL/`, run a sample analysis, and
check `https://YOUR-URL/docs`.

| Route | Purpose |
|---|---|
| `/` | Web interface (from `web/`) |
| `/docs` | OpenAPI documentation |
| `/api/health` | Health check — point the platform's probe here |
| `/api/analyse` | `POST` multipart upload |
| `/api/analyse/sample` | `POST` analyse a bundled sample by name |
| `/api/samples`, `/api/samples/{name}` | Sample manifest and raw sample inputs |
| `/api/config/summary` | Disease Master provenance, scoring model, rule catalogue |
| `/api/diseases`, `/api/diseases/{id}` | Disease Master rows and the rules mapping onto them |

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Blank page, console says a module script was served as `text/plain` | A host with a broken MIME registry. `app.py` pins the types; make sure you run this version of `app.py`. |
| `/` returns "The frontend has not been built" | `web/` is missing from the deployed files. It is committed; check that your host does not exclude it. |
| Client IPs or HTTPS wrong in logs | The start command is missing `--proxy-headers --forwarded-allow-ips=…`. |
| First request after idle takes ~30 s | Free-tier sleep (Render). The page waits and offers a retry; use a paid instance to keep it warm. |
| `413 file_too_large` | Raise `DRE_MAX_UPLOAD_MB` deliberately, or upload the CSV/JSON export. |
| Windows: `python -m venv` fails with `WinError 206 … too long` | The checkout is too deep for the 260-character path limit. Clone to a shorter path (e.g. `C:\src`) or enable Windows long paths. |

---

## Optional — Docker

A `Dockerfile` is included for hosts that only run containers (Cloud Run, Fly.io, ECS). It
is not needed for any option above. Its build runs the same configuration check, so a broken
configuration fails the image build:

```bash
docker build -t labscan .
docker run --rm -p 8000:8000 labscan
```
