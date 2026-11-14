# CivicSignal — Cloud Smart Public Issue Reporting & Triage System

> **An AWS Serverless + Hybrid Local AI Civic Reporting Platform that verifies issue photos, auto-scores hazard severity, merges 150m duplicate complaints into priority hotspots, and provides a grounded AI Co-Pilot.**

---

## Team Details (2-Student Team)
- **Team Member 1:** `<Full Name>` (`<College Email / GitHub Handle>`) — *Citizen & Municipal Web Portal, Geo-Hotspot UX & S3 Static Hosting*
- **Team Member 2:** `<Full Name>` (`<College Email / GitHub Handle>`) — *AWS Lambda / FastAPI Backend, Gemini Vision + Local Fallback Triage & Pytest Suite*

---

## Cloud Architecture (AWS Serverless + Dual-Mode Local Resilience)

```text
[Citizen / Admin Web App (frontend/index.html — Amazon S3 Static Hosting or Local)]
                                    │
                                    ▼  (HTTPS + CORS)
                        [Amazon API Gateway (REST/HTTP)]
                                    │
                                    ▼
              [AWS Lambda (Python 3.12 — backend/lambda_function.py)]
               (Mirrored locally by backend/local_server.py FastAPI)
                 ├──► [Amazon S3]          (Stores uploaded issue photos; local preview fallback)
                 ├──► [Gemini Vision API]  (gemini-2.5-flash authenticity + severity + Q&A)
                 │        └──► [Local Rule Fallback] (Deterministic keyword & hotspot scorer)
                 ├──► [Amazon DynamoDB]    (Tickets, GPS, Priority Score, Status; JSON fallback)
                 ├──► [Amazon SNS]         (Citizen status update alerts; local SNS audit log)
                 └──► [Amazon CloudWatch]  (Structured JSON logs for Lambda latency & triage)
```

---

## Key Innovations

1. **AI Photo & Description Triage (`backend/core/triage.py`)**:
   - Uses **Google Gemini (`gemini-2.5-flash`)** Vision + Text to verify uploaded photos (rejects random selfies, blank screens, or memes with HTTP `422`), assign a **Severity Score (1–100)**, and route to the right municipal department (`Highways / Roads`, `Sanitation`, `Electrical`, `Metro Water`).
   - **Zero-Downtime Local Rule Fallback**: If `GEMINI_API_KEY` is missing, rate-limited, or offline, a deterministic Python scorer computes Priority Score using category weights and urgency keywords (`school`, `hospital`, `live wire`, `accident`, `flooding`, `main road`).
2. **150m Geo-Cluster Duplicate Merger (Hotspot Booster)**:
   - Computes Haversine distance between incoming coordinates and existing `OPEN` tickets of the same category.
   - If within **150 meters**, merges into the existing ticket, increments `duplicate_count` (`🔥 X Citizens Reported`), and boosts `priority_score` by `+10` (capped at `100`).
3. **Interactive Civic AI Co-Pilot**:
   - Grounded live-ticket assistant in the dashboard answering natural-language queries like *"Which ward or area has the most unresolved high-priority complaints right now?"* or *"Draft an urgent work-order notice for the top pothole ticket."*

---

## Repository Structure

```text
├── frontend/
│   ├── index.html             # Tab 1: Citizen Portal | Tab 2: Admin Dashboard | AI Co-Pilot
│   ├── styles.css             # Responsive dark-slate command center UI
│   └── app.js                 # Landmark presets, GPS, photo preview, triage & Q&A logic
├── backend/
│   ├── core/
│   │   ├── triage.py          # Gemini Vision + Local Rule Fallback + 150m Haversine merger
│   │   ├── storage.py         # Dual-mode AWS (DynamoDB/S3/SNS) + Local JSON fallback
│   │   └── service.py         # Shared business logic for Lambda & FastAPI
│   ├── lambda_function.py     # AWS Lambda handler (API Gateway v1/v2 + CloudWatch JSON logs)
│   ├── local_server.py        # FastAPI local/EC2 server serving API + frontend/
│   ├── requirements.txt       # Python dependencies
│   └── .env.example           # Environment variable template
├── tests/
│   └── test_triage.py         # Pytest suite (priority scoring, 150m merge, Lambda & fallback)
└── README.md
```

---

## Quick Start (Runs Locally in < 2 Minutes)

### 1. Install Dependencies & Start Server
```bash
cd backend
pip install -r requirements.txt

# Optional: enable Gemini Vision & Q&A locally (omit to run in Local Rule Fallback mode)
# Windows PowerShell: $env:GEMINI_API_KEY="your_api_key_here"
# macOS/Linux: export GEMINI_API_KEY="your_api_key_here"

uvicorn local_server:app --reload --port 8000
```
Open **`http://localhost:8000`** in your browser — FastAPI serves both the API and `frontend/index.html` automatically.

### 2. Run Automated Tests (`pytest`)
From the repository root:
```bash
pytest -v
```

---

## AWS Production Deployment Guide

1. **Amazon DynamoDB**:
   - Create table **`civicsignal-tickets`** with Partition Key **`ticket_id`** (`String`).
2. **Amazon S3 (Photos & Static Frontend)**:
   - Create a private photo bucket (e.g., `civicsignal-issue-photos`) for backend `PutObject` + presigned `GetObject` URLs.
   - Optionally create a second static website hosting bucket for `frontend/` (`index.html`, `styles.css`, `app.js`).
3. **Amazon SNS**:
   - Create an SNS Standard Topic (e.g., `civicsignal-citizen-alerts`), subscribe a demo email address, and copy the **Topic ARN**.
4. **AWS Lambda (`Python 3.12`)**:
   - Package `/backend` (with dependencies installed into the package folder) and set Handler to **`lambda_function.lambda_handler`**.
   - Attach IAM permissions for `dynamodb:Scan`, `dynamodb:PutItem`, `s3:PutObject`, `s3:GetObject`, `sns:Publish`, and `logs:CreateLogGroup/Stream/PutLogEvents` (CloudWatch).
   - Set Lambda Environment Variables:
     - `GEMINI_API_KEY` = *(your Gemini key)*
     - `DYNAMODB_TABLE` = `civicsignal-tickets`
     - `S3_BUCKET` = `<your-photo-bucket>`
     - `SNS_TOPIC_ARN` = `<your-sns-topic-arn>`
5. **Amazon API Gateway (HTTP API)**:
   - Create routes `GET /health`, `GET /tickets`, `POST /tickets`, `POST /tickets/seed`, `PATCH /tickets/{ticket_id}/status`, `POST /chat` pointing to the Lambda function.
   - Enable **CORS** (`Allow-Origin: *`, `Allow-Methods: GET, POST, PATCH, OPTIONS`, `Allow-Headers: Content-Type`).
   - Paste the API Gateway Invoke URL into the **Connect** box in the top-right of the CivicSignal UI.

---

## 30-Second Sunday Demo Script
1. Open **`http://localhost:8000`** (or your S3 URL) and click **"Load Sample Chennai Issues"** to show the priority-sorted Municipal Dashboard.
2. In **Tab 1**, select **Pothole**, click **Vel Tech Avadi Rd** (`13.1770, 80.0970`), attach a photo (or click **Use Sample Photo**), enter *"Deep pothole outside school gate"*, and submit — watch **Geo-Cluster Duplicate Merger** merge it into the nearby hotspot with `🔥 2 Citizens Reported` and `+10 Priority Boost`.
3. Switch to **Tab 2**, click **Mark In-Progress** or **Mark Resolved** to show **Amazon SNS** citizen notification logs firing in real time.
4. In the **Civic AI Co-Pilot** sidebar, click **"Work-order notice"** to generate an instant grounded dispatch notice.
