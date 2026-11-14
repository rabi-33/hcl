/* CivicSignal Frontend Controller */

const DEFAULT_API =
  window.location.protocol.startsWith("http") && window.location.port !== ""
    ? window.location.origin
    : "http://localhost:8000";

const state = {
  apiBase: localStorage.getItem("civicsignal_api_base") || DEFAULT_API,
  imageData: null,
  tickets: [],
  snsAlerts: []
};

const els = {
  apiBaseInput: document.getElementById("api-base-input"),
  saveApiBtn: document.getElementById("save-api-btn"),
  enginePill: document.getElementById("engine-pill"),
  cloudPill: document.getElementById("cloud-pill"),
  reportForm: document.getElementById("report-form"),
  category: document.getElementById("issue-category"),
  locationName: document.getElementById("location-name"),
  latitude: document.getElementById("latitude"),
  longitude: document.getElementById("longitude"),
  desc: document.getElementById("issue-desc"),
  contact: document.getElementById("citizen-contact"),
  photoInput: document.getElementById("photo-input"),
  samplePhotoBtn: document.getElementById("sample-photo-btn"),
  photoPreviewBox: document.getElementById("photo-preview-box"),
  photoPreviewImg: document.getElementById("photo-preview-img"),
  submitBanner: document.getElementById("submit-banner"),
  citizenList: document.getElementById("citizen-tracker-list"),
  adminList: document.getElementById("admin-ticket-list"),
  snsList: document.getElementById("sns-log-list"),
  kpiTotal: document.getElementById("kpi-total"),
  kpiCritical: document.getElementById("kpi-critical"),
  kpiMerged: document.getElementById("kpi-merged"),
  kpiSns: document.getElementById("kpi-sns"),
  chatLog: document.getElementById("chat-log"),
  chatInput: document.getElementById("chat-input"),
  chatSendBtn: document.getElementById("chat-send-btn")
};

els.apiBaseInput.value = state.apiBase;

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getApiUrl(path) {
  return `${state.apiBase.replace(/\/+$/, "")}${path}`;
}

async function fetchHealth() {
  try {
    const res = await fetch(getApiUrl("/health"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    els.enginePill.textContent = data.active_ai_engine || "Local Rule Fallback";
    els.cloudPill.textContent = data.cloud?.aws_configured
      ? `AWS: ${data.cloud.dynamodb_mode}`
      : "Local JSON + S3/SNS Fallback";
  } catch (_err) {
    els.enginePill.textContent = "Backend Unreachable";
    els.cloudPill.textContent = "Start local_server.py";
  }
}

async function loadTickets() {
  try {
    const res = await fetch(getApiUrl("/tickets"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.tickets = data.tickets || [];
    state.snsAlerts = data.sns_alerts || [];
    renderAllLists();
  } catch (err) {
    const msg = `<div class="ticket-meta">Unable to reach backend at ${escapeHtml(state.apiBase)}. Start FastAPI with <code>uvicorn local_server:app --reload</code>.</div>`;
    els.citizenList.innerHTML = msg;
    els.adminList.innerHTML = msg;
  }
}

function renderAllLists() {
  renderCitizenTracker();
  renderAdminDashboard();
  renderSnsLog();
}

function renderCitizenTracker() {
  if (!state.tickets.length) {
    els.citizenList.innerHTML =
      '<div class="ticket-meta">No tickets reported yet. Submit an issue on the left or click "Load Sample Chennai Issues".</div>';
    return;
  }

  els.citizenList.innerHTML = state.tickets
    .map((t) => {
      const band = escapeHtml(t.priority_band || "MODERATE");
      const dupCount = Number(t.duplicate_count || 1);
      return `
      <article class="ticket-card">
        <div class="ticket-top">
          <strong>${escapeHtml(t.ticket_id)} &bull; ${escapeHtml(t.category)}</strong>
          <div>
            <span class="badge badge-status">${escapeHtml(t.status)}</span>
            <span class="badge badge-${band}">Priority ${t.priority_score}/100</span>
          </div>
        </div>
        <div class="ticket-meta">
          Area: <strong>${escapeHtml(t.location_name)}</strong> &bull; Dept: ${escapeHtml(t.department)}
          ${dupCount > 1 ? ` &bull; <span class="badge badge-hotspot">🔥 ${dupCount} Citizens Reported</span>` : ""}
        </div>
        <div class="ticket-desc">${escapeHtml(t.description)}</div>
        <div class="ai-note">${escapeHtml(t.ai_reasoning)}</div>
      </article>`;
    })
    .join("");
}

function renderAdminDashboard() {
  const total = state.tickets.length;
  const critical = state.tickets.filter((t) => t.priority_band === "CRITICAL").length;
  const totalReports = state.tickets.reduce((acc, t) => acc + Number(t.duplicate_count || 1), 0);

  els.kpiTotal.textContent = total;
  els.kpiCritical.textContent = critical;
  els.kpiMerged.textContent = totalReports;
  els.kpiSns.textContent = state.snsAlerts.length;

  if (!state.tickets.length) {
    els.adminList.innerHTML =
      '<div class="ticket-meta">No tickets in queue. Submit a report or load sample Chennai issues in Tab 1.</div>';
    return;
  }

  els.adminList.innerHTML = state.tickets
    .map((t) => {
      const band = escapeHtml(t.priority_band || "MODERATE");
      const dupCount = Number(t.duplicate_count || 1);
      const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(t.latitude)},${encodeURIComponent(t.longitude)}`;
      const thumbHtml = t.photo_url
        ? `<img class="ticket-thumb" src="${escapeHtml(t.photo_url)}" alt="Issue photo" />`
        : "";
      return `
      <article class="ticket-card">
        <div class="ticket-top">
          <div>
            <strong>${escapeHtml(t.ticket_id)}</strong> &mdash; ${escapeHtml(t.category)}
            <span class="badge badge-${band}">${band} (${t.priority_score}/100)</span>
            ${dupCount > 1 ? `<span class="badge badge-hotspot">🔥 ${dupCount} Citizens Reported</span>` : ""}
          </div>
          <span class="badge badge-status">${escapeHtml(t.status)}</span>
        </div>

        <div class="ticket-body">
          ${thumbHtml}
          <div style="flex:1;">
            <div class="ticket-meta">
              <strong>${escapeHtml(t.location_name)}</strong> &bull; Dept: <strong>${escapeHtml(t.department)}</strong> &bull; Engine: ${escapeHtml(t.engine_used)}
            </div>
            <div class="ticket-desc">${escapeHtml(t.description)}</div>
            <div class="ai-note">${escapeHtml(t.ai_reasoning)}</div>
          </div>
        </div>

        <div class="ticket-actions">
          <a class="map-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">
            View GPS (${Number(t.latitude).toFixed(4)}, ${Number(t.longitude).toFixed(4)}) &rarr;
          </a>
          <div class="btn-group" style="margin:0;">
            <button class="btn btn-warn btn-sm status-btn" data-id="${escapeHtml(t.ticket_id)}" data-status="IN_PROGRESS" type="button">
              Mark In-Progress
            </button>
            <button class="btn btn-success btn-sm status-btn" data-id="${escapeHtml(t.ticket_id)}" data-status="RESOLVED" type="button">
              Mark Resolved
            </button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  document.querySelectorAll(".status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const status = btn.getAttribute("data-status");
      await updateStatus(id, status);
    });
  });
}

function renderSnsLog() {
  if (!state.snsAlerts.length) {
    els.snsList.innerHTML =
      '<div class="ticket-meta">No status notifications triggered yet. Mark a ticket In-Progress or Resolved above to fire SNS alerts.</div>';
    return;
  }

  els.snsList.innerHTML = state.snsAlerts
    .map(
      (a) => `
      <div class="sns-log-item">
        <strong>[${escapeHtml(a.channel)}]</strong> &rarr; <em>${escapeHtml(a.recipient)}</em>: ${escapeHtml(a.message)}
      </div>`
    )
    .join("");
}

async function updateStatus(ticketId, status) {
  try {
    const res = await fetch(getApiUrl(`/tickets/${encodeURIComponent(ticketId)}/status`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadTickets();
  } catch (err) {
    alert(`Failed to update status: ${err.message}`);
  }
}

function showSubmitBanner(message, isError = false) {
  els.submitBanner.textContent = message;
  els.submitBanner.className = `banner show ${isError ? "banner-err" : "banner-ok"}`;
}

function generateSampleRoadImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  // Asphalt road + pothole visual for live demo testing
  ctx.fillStyle = "#334155";
  ctx.fillRect(0, 0, 360, 220);
  ctx.fillStyle = "#facc15";
  ctx.fillRect(172, 0, 16, 70);
  ctx.fillRect(172, 145, 16, 75);
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.ellipse(180, 120, 72, 34, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("ROAD POTHOLE SAMPLE", 96, 202);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Event Listeners
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.getAttribute("data-tab")).classList.add("active");
  });
});

document.querySelectorAll(".landmark-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.locationName.value = btn.getAttribute("data-name");
    els.latitude.value = btn.getAttribute("data-lat");
    els.longitude.value = btn.getAttribute("data-lng");
  });
});

document.getElementById("gps-btn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showSubmitBanner("Browser geolocation is unavailable; use a preset landmark button.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.latitude.value = pos.coords.latitude.toFixed(4);
      els.longitude.value = pos.coords.longitude.toFixed(4);
      if (!els.locationName.value.trim()) {
        els.locationName.value = "Detected GPS Location";
      }
    },
    () => {
      showSubmitBanner("GPS permission denied; using preset Chennai coordinates.", true);
    }
  );
});

els.photoInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.imageData = reader.result;
    els.photoPreviewImg.src = state.imageData;
    els.photoPreviewBox.style.display = "block";
  };
  reader.readAsDataURL(file);
});

els.samplePhotoBtn.addEventListener("click", () => {
  state.imageData = generateSampleRoadImage();
  els.photoPreviewImg.src = state.imageData;
  els.photoPreviewBox.style.display = "block";
});

els.reportForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showSubmitBanner("Running AI Vision & Geo-Cluster Triage...");

  const payload = {
    category: els.category.value,
    description: els.desc.value.trim(),
    location_name: els.locationName.value.trim(),
    latitude: parseFloat(els.latitude.value),
    longitude: parseFloat(els.longitude.value),
    citizen_contact: els.contact.value.trim(),
    image_data: state.imageData
  };

  try {
    const res = await fetch(getApiUrl("/tickets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.status === 422 && data.rejected) {
      showSubmitBanner(`Rejected by AI Authenticity Check: ${data.reason}`, true);
      return;
    }
    if (!res.ok) {
      showSubmitBanner(data.error || "Submission failed.", true);
      return;
    }

    const prefix = data.merged ? "Hotspot Merged! " : "New Ticket Created! ";
    showSubmitBanner(`${prefix}${data.message} (Engine: ${data.engine_used})`);
    els.desc.value = "";
    await loadTickets();
  } catch (err) {
    showSubmitBanner(`Network error: ${err.message}`, true);
  }
});

document.getElementById("seed-demo-btn").addEventListener("click", async () => {
  try {
    await fetch(getApiUrl("/tickets/seed"), { method: "POST" });
    await loadTickets();
    showSubmitBanner("Loaded sample Chennai civic issues for live demo.");
  } catch (err) {
    showSubmitBanner(`Unable to seed demo issues: ${err.message}`, true);
  }
});

document.getElementById("refresh-citizen-btn").addEventListener("click", loadTickets);
document.getElementById("refresh-admin-btn").addEventListener("click", loadTickets);

els.saveApiBtn.addEventListener("click", () => {
  state.apiBase = els.apiBaseInput.value.trim() || DEFAULT_API;
  localStorage.setItem("civicsignal_api_base", state.apiBase);
  fetchHealth();
  loadTickets();
});

function appendChatMessage(text, isUser, engine = "") {
  const div = document.createElement("div");
  div.className = `chat-msg ${isUser ? "chat-user" : "chat-bot"}`;
  div.textContent = text;
  if (!isUser && engine) {
    const meta = document.createElement("div");
    meta.className = "chat-engine";
    meta.textContent = `Engine: ${engine}`;
    div.appendChild(meta);
  }
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function sendChat(questionText) {
  const q = (questionText || els.chatInput.value || "").trim();
  if (!q) return;
  els.chatInput.value = "";
  appendChatMessage(q, true);

  try {
    const res = await fetch(getApiUrl("/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });
    const data = await res.json();
    appendChatMessage(data.answer, false, data.engine_used);
  } catch (err) {
    appendChatMessage(`Unable to reach Civic AI backend: ${err.message}`, false, "Offline");
  }
}

document.querySelectorAll(".qa-chip").forEach((chip) => {
  chip.addEventListener("click", () => sendChat(chip.getAttribute("data-q")));
});
els.chatSendBtn.addEventListener("click", () => sendChat());
els.chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

fetchHealth();
loadTickets();
