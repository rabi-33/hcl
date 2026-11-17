# CivicSignal — Cloud Smart Public Issue Reporting & Triage System

> **A Microsoft Azure-hosted Civic Reporting & Municipal Dispatch Platform powered by Google Gemini 2.5 Flash (Vision & Q&A), MapLibre GL + MapTiler Tamil Nadu GIS, 150m Geo-Cluster Duplicate Merging, and a Zero-Downtime Local Rule Fallback.**

- **Live Citizen 311 Portal:** `https://civicsignal-api-afc4asafb9b4frfr.centralindia-01.azurewebsites.net/`
- **Live Municipal Operations Console (Protected):** `https://civicsignal-api-afc4asafb9b4frfr.centralindia-01.azurewebsites.net/admin`

---

## Team Details (2-Student Team)
- **Team Member 1:** `<Full Name>` (`<College Email / GitHub Handle>`) — *Citizen 311 Portal, Municipal Operations Console & Tamil Nadu MapTiler GIS*
- **Team Member 2:** `<Full Name>` (`<College Email / GitHub Handle>`) — *FastAPI Backend, Azure App Service CI/CD, Gemini Vision + Local Fallback & Pytest Suite*

---

## Cloud Architecture (Microsoft Azure + Hybrid AI)

```text
[Citizen 311 Portal (/)]              [Municipal Operations Console (/admin)]
 (frontend/index.html)                  (Protected by Officer Login Gate)
            │                                          │
            └────────────────────┬─────────────────────┘
                                 ▼  (HTTPS + Bearer Auth)
       [Microsoft Azure App Service — Central India (Linux Python 3.12)]
              FastAPI + Gunicorn/Uvicorn (backend/local_server.py)
               ├──► [Google Gemini 2.5 Flash]  (Photo authenticity, severity 1-100 & Q&A)
               │        └──► [Local Rule Fallback] (Deterministic keyword & hotspot scorer)
               ├──► [150m Geo-Cluster Engine]  (Haversine duplicate merge + +10 priority boost)
               ├──► [Azure JSON Persistence]   (Tickets, GPS, priority scores & photo previews)
               └──► [Notification Engine]      (Azure Audit Log / optional SMTP Email & Webhook)

[Frontend GIS]  MapLibre GL JS + MapTiler API (Tamil Nadu street search & reverse geocoding)
[CI/CD Pipeline] GitHub Actions (.github/workflows/main_civicsignal-api.yml) -> Azure Web App
```

*(Note: `backend/lambda_function.py` is also included as an optional serverless adapter if deployed behind API Gateway/AWS.)*

---

## Key Features

1. **AI Photo & Description Triage (`backend/core/triage.py`)**:
   - Uses **Google Gemini (`gemini-2.5-flash`)** Vision + Text to verify uploaded photos (rejects unrelated selfies, blank screens, or memes with HTTP `422`), assign a **Severity Score (1–100)**, and route to the right municipal department (`Highways / Roads`, `Sanitation`, `Electrical`, `Metro Water`).
   - **Zero-Downtime Local Rule Fallback**: If `GEMINI_API_KEY` is missing, rate-limited, or offline, a deterministic Python scorer computes Priority Score using category weights and urgency keywords (`school`, `hospital`, `live wire`, `accident`, `flooding`, `main road`).
2. **150m Geo-Cluster Duplicate Merger (Hotspot Booster)**:
   - Computes Haversine distance between incoming coordinates and existing `OPEN` tickets of the same category.
   - If within **150 meters**, merges into the existing ticket, increments `duplicate_count`, and boosts `priority_score` by `+10` (capped at `100`).
3. **Interactive Tamil Nadu Street GIS (`frontend/tn-map.js`)**:
   - Powered by **MapLibre GL JS + MapTiler** constrained to Tamil Nadu (`Tamil Nadu` / `Chennai` view modes), supporting street search, click-to-pin, and automatic reverse geocoding.
4. **Protected Municipal Operations Console (`frontend/admin.html`)**:
   - Secured by an **Officer Sign-In Gate** (`POST /admin/login` + HMAC-SHA256 Bearer tokens) with priority-sorted dispatch queues, geospatial hotspot markers, photo inspector, crew status workflows (`OPEN` → `IN_PROGRESS` → `RESOLVED`), Notification Audit log, and an **Operations AI Analyst**.

---

## Repository Structure

```text
├── .github/workflows/
│   └── main_civicsignal-api.yml  # Auto-deploy pipeline to Azure App Service
├── frontend/
│   ├── index.html                # Public Citizen 311 Portal
│   ├── admin.html                # Protected Municipal Operations Console
│   ├── styles.css                # GovTech UI design system
│   ├── shared.js                 # Shared API client & admin session token helpers
│   ├── tn-map.js                 # MapLibre GL + MapTiler Tamil Nadu map & geocoding
│   ├── citizen.js                # Citizen intake, photo upload & ticket tracker
│   └── admin.js                  # Login gate, dispatch queue, inspector & AI analyst
├── backend/
│   ├── core/
│   │   ├── auth.py               # Admin credentials & HMAC Bearer token verification
│   │   ├── triage.py             # Gemini Vision + Local Fallback + 150m Haversine merger
│   │   ├── storage.py            # Ticket storage & Azure Notification / SMTP / Webhook log
│   │   └── service.py            # Shared business logic
│   ├── local_server.py           # FastAPI production & local server (Gunicorn/Uvicorn)
│   ├── lambda_function.py        # Optional serverless handler adapter
│   ├── requirements.txt          # Backend Python dependencies
│   ├── startup.txt               # Azure App Service startup command
│   └── .env.example              # Environment variable template
├── tests/
│   └── test_triage.py            # Pytest suite (triage, 150m merge, auth & fallback)
├── requirements.txt              # Root requirements include for Azure Oryx builds
└── README.md
```

---

## Quick Start (Local Development)

### 1. Run Backend & Both Portals Locally
```bash
cd backend
pip install -r requirements.txt

# Optional: enable Gemini Vision & Q&A locally (omit to test Local Rule Fallback)
# Windows PowerShell: $env:GEMINI_API_KEY="your_api_key_here"
# macOS/Linux: export GEMINI_API_KEY="your_api_key_here"

uvicorn local_server:app --reload --port 8000
```
- **Citizen 311 Portal**: `http://localhost:8000/`
- **Municipal Operations Console**: `http://localhost:8000/admin`
  - Default credentials: `admin` / `CivicAdmin@2026` (override via `ADMIN_USERNAME` and `ADMIN_PASSWORD`).

### 2. Run Automated Tests (`pytest`)
From the repository root:
```bash
pytest -v
```

---

## Microsoft Azure Deployment Setup
1. Create a **Python 3.12 Linux Web App** on **Microsoft Azure App Service** (e.g., `Central India`, `Free F1` or `Basic B1`).
2. Under **Settings → Environment variables**, configure:
   - `GEMINI_API_KEY` = `<your-gemini-api-key>`
   - `SCM_DO_BUILD_DURING_DEPLOYMENT` = `true`
   - *(Optional)* `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_AUTH_SECRET`
   - *(Optional)* `SMTP_USER` / `SMTP_PASSWORD` or `AZURE_WEBHOOK_URL` for external notifications
3. Under **Settings → Configuration → Startup Command**, set:
   ```text
   gunicorn -w 1 -k uvicorn.workers.UvicornWorker --chdir backend local_server:app --bind=0.0.0.0:8000 --timeout 120
   ```
4. Connect your GitHub repository in **Deployment → Deployment Center** — pushes to `main` deploy automatically via GitHub Actions.

---

## 30-Second Review Demo Script
1. Open the **Citizen 311 Portal** (`/`), pick **Pothole**, click **Vel Tech / Avadi** (or search any Tamil Nadu street on the map), enter *"Deep pothole outside school gate"*, and submit to generate a `CS-XXXXXX` ticket scored by **Gemini 2.5 Flash**.
2. Submit a second **Pothole** report at the same coordinates to demonstrate the **150m Geo-Cluster Duplicate Merger** (`2 citizen reports merged`, `+10` Priority Score escalation).
3. Open **`/admin`** and sign in (`admin` / `CivicAdmin@2026`) to show the protected **Municipal Operations Console**, hotspot pins on the Tamil Nadu map, and **Ticket Inspector**.
4. Click **Dispatch Crew** to update status to **In Progress** and log a citizen alert in **Notification Audit**, then open **AI Operations Analyst** and click **Draft Pothole Work Order**.
