/* CivicSignal Municipal Operations Console Controller */

(() => {
  const { requestJson, escapeHtml, formatStatusLabel, formatRelativeTime, getBaseUrl, setBaseUrl } =
    window.CivicApi;

  const state = {
    tickets: [],
    snsAlerts: [],
    selectedTicketId: null,
    map: null,
    markersLayer: null
  };

  const els = {
    viewHeading: document.getElementById("view-heading"),
    opsDot: document.getElementById("ops-dot"),
    opsEngineText: document.getElementById("ops-engine-text"),
    kpiOpen: document.getElementById("kpi-open"),
    kpiCrit: document.getElementById("kpi-crit"),
    kpiReports: document.getElementById("kpi-reports"),
    kpiAlerts: document.getElementById("kpi-alerts"),
    search: document.getElementById("ops-search"),
    deptFilter: document.getElementById("ops-dept-filter"),
    statusFilter: document.getElementById("ops-status-filter"),
    tableBody: document.getElementById("ops-table-body"),
    inspectorId: document.getElementById("inspector-id"),
    inspectorBody: document.getElementById("inspector-body"),
    snsBody: document.getElementById("sns-audit-body"),
    snsChannelPill: document.getElementById("sns-channel-pill"),
    chatFeed: document.getElementById("ops-chat-feed"),
    chatInput: document.getElementById("ops-chat-input"),
    chatSend: document.getElementById("ops-chat-send"),
    apiInput: document.getElementById("ops-api-input"),
    cloudDiag: document.getElementById("cloud-diag-box"),
    settingsNotice: document.getElementById("ops-settings-notice")
  };

  const VIEW_TITLES = {
    "view-dispatch": "Municipal Dispatch Queue",
    "view-sns": "Amazon SNS Notification Audit",
    "view-analyst": "Operations AI Analyst",
    "view-settings": "Cloud & API Configuration"
  };

  function initMap() {
    if (typeof L === "undefined") {
      document.getElementById("admin-map").innerHTML =
        '<div style="padding:18px;font-size:12.5px;color:#475569;">Geospatial map tiles unavailable offline. Select tickets from the table below.</div>';
      return;
    }
    state.map = L.map("admin-map").setView([13.095, 80.175], 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19
    }).addTo(state.map);
    state.markersLayer = L.layerGroup().addTo(state.map);
  }

  function renderMapPins(filteredTickets) {
    if (!state.map || !state.markersLayer) return;
    state.markersLayer.clearLayers();
    const bounds = [];

    filteredTickets.forEach((t) => {
      const lat = Number(t.latitude);
      const lng = Number(t.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;
      bounds.push([lat, lng]);

      const color =
        t.priority_band === "CRITICAL"
          ? "#dc2626"
          : t.priority_band === "HIGH"
          ? "#d97706"
          : "#0284c7";

      if (Number(t.duplicate_count || 1) > 1) {
        L.circle([lat, lng], {
          radius: 150,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.12
        }).addTo(state.markersLayer);
      }

      const marker = L.circleMarker([lat, lng], {
        radius: 7 + Math.min(6, Number(t.duplicate_count || 1) * 1.5),
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.92
      }).addTo(state.markersLayer);

      marker.bindTooltip(`${t.ticket_id}: ${t.category} (${t.priority_score}/100)`);
      marker.on("click", () => {
        state.selectedTicketId = t.ticket_id;
        renderQueue();
        renderInspector(t);
      });
    });

    if (bounds.length > 0) {
      state.map.fitBounds(bounds, { padding: [26, 26], maxZoom: 14 });
    }
  }

  async function refreshHealth() {
    try {
      const res = await requestJson("/health");
      if (!res.ok) throw new Error("Offline");
      const d = res.data;
      els.opsDot.classList.remove("offline");
      els.opsEngineText.textContent = d.active_ai_engine || "Operational";
      els.snsChannelPill.textContent = d.cloud?.sns_mode || "SNS Audit";
      els.cloudDiag.innerHTML = `
        <div><strong>AI Engine:</strong> ${escapeHtml(d.active_ai_engine)}</div>
        <div><strong>Database:</strong> ${escapeHtml(d.cloud?.dynamodb_mode)}</div>
        <div><strong>Object Storage:</strong> ${escapeHtml(d.cloud?.s3_mode)}</div>
        <div><strong>Notifications:</strong> ${escapeHtml(d.cloud?.sns_mode)}</div>
        <div><strong>AWS Region:</strong> ${escapeHtml(d.cloud?.aws_region)}</div>
      `;
    } catch (_err) {
      els.opsDot.classList.add("offline");
      els.opsEngineText.textContent = "Backend Unreachable";
      els.cloudDiag.textContent = "Unable to connect to configured API endpoint.";
    }
  }

  async function loadOperationsData() {
    try {
      const res = await requestJson("/tickets");
      if (!res.ok) throw new Error("Failed");
      state.tickets = res.data.tickets || [];
      state.snsAlerts = res.data.sns_alerts || [];

      if (!state.selectedTicketId && state.tickets.length) {
        state.selectedTicketId = state.tickets[0].ticket_id;
      }
      renderKPIs();
      renderQueue();
      renderSnsTable();

      const selected = state.tickets.find((t) => t.ticket_id === state.selectedTicketId);
      if (selected) renderInspector(selected);
    } catch (_err) {
      els.tableBody.innerHTML =
        '<tr><td colspan="6" style="color:var(--ink-muted);text-align:center;padding:24px;">Unable to load tickets. Check Cloud & API Settings.</td></tr>';
    }
  }

  function renderKPIs() {
    const active = state.tickets.filter((t) => t.status !== "RESOLVED").length;
    const critical = state.tickets.filter((t) => t.priority_band === "CRITICAL" && t.status !== "RESOLVED").length;
    const totalReports = state.tickets.reduce((sum, t) => sum + Number(t.duplicate_count || 1), 0);

    els.kpiOpen.textContent = active;
    els.kpiCrit.textContent = critical;
    els.kpiReports.textContent = totalReports;
    els.kpiAlerts.textContent = state.snsAlerts.length;
  }

  function getFilteredTickets() {
    const q = (els.search.value || "").trim().toLowerCase();
    const dept = els.deptFilter.value;
    const status = els.statusFilter.value;

    return state.tickets.filter((t) => {
      if (dept !== "ALL" && t.department !== dept) return false;
      if (status !== "ALL" && t.status !== status) return false;
      if (q) {
        const hay = `${t.ticket_id} ${t.category} ${t.location_name} ${t.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderQueue() {
    const filtered = getFilteredTickets();
    renderMapPins(filtered);

    if (!filtered.length) {
      els.tableBody.innerHTML =
        '<tr><td colspan="6" style="color:var(--ink-muted);text-align:center;padding:26px;">No tickets match the current filter.</td></tr>';
      return;
    }

    els.tableBody.innerHTML = filtered
      .map((t) => {
        const selectedClass = t.ticket_id === state.selectedTicketId ? "selected-row" : "";
        const dup = Number(t.duplicate_count || 1);
        return `
        <tr class="${selectedClass}" data-id="${escapeHtml(t.ticket_id)}">
          <td><span class="mono" style="font-weight:600;">${escapeHtml(t.ticket_id)}</span></td>
          <td>
            <div style="font-weight:600;color:var(--ink);">${escapeHtml(t.category)}</div>
            <div style="font-size:12px;color:var(--ink-muted);">${escapeHtml(t.location_name)}</div>
          </td>
          <td style="font-size:12.5px;color:var(--ink-secondary);">${escapeHtml(t.department)}</td>
          <td>
            ${dup > 1 ? `<span class="badge badge-cluster">&times;${dup} reports</span>` : '<span style="color:var(--ink-muted);font-size:12px;">1</span>'}
          </td>
          <td><span class="badge badge-${escapeHtml(t.priority_band)}">${escapeHtml(t.priority_band)} (${t.priority_score})</span></td>
          <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(formatStatusLabel(t.status))}</span></td>
        </tr>`;
      })
      .join("");

    els.tableBody.querySelectorAll("tr[data-id]").forEach((row) => {
      row.addEventListener("click", () => {
        state.selectedTicketId = row.getAttribute("data-id");
        const ticket = state.tickets.find((x) => x.ticket_id === state.selectedTicketId);
        renderQueue();
        if (ticket) renderInspector(ticket);
      });
    });
  }

  function renderInspector(t) {
    els.inspectorId.textContent = t.ticket_id;
    const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(t.latitude)},${encodeURIComponent(t.longitude)}`;
    const dup = Number(t.duplicate_count || 1);

    const photoHtml = t.photo_url
      ? `<img class="inspector-photo" src="${escapeHtml(t.photo_url)}" alt="Citizen evidence" />`
      : `<div style="padding:18px;border:1px dashed var(--border-strong);border-radius:8px;text-align:center;color:var(--ink-muted);font-size:12px;margin-bottom:14px;">No photographic evidence attached to this ticket.</div>`;

    els.inspectorBody.innerHTML = `
      ${photoHtml}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        <span class="badge badge-${escapeHtml(t.priority_band)}">${escapeHtml(t.priority_band)} &bull; ${t.priority_score}/100</span>
        <span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(formatStatusLabel(t.status))}</span>
        ${dup > 1 ? `<span class="badge badge-cluster">${dup} Citizens Merged</span>` : ""}
      </div>

      <h3 style="margin:0 0 4px;font-size:16px;">${escapeHtml(t.category)}</h3>
      <div style="font-size:12.5px;color:var(--ink-muted);margin-bottom:10px;">
        ${escapeHtml(t.location_name)} &bull; ${escapeHtml(formatRelativeTime(t.created_at))}
      </div>

      <p style="margin:0 0 12px;font-size:13.5px;color:var(--ink-secondary);">${escapeHtml(t.description)}</p>

      <div style="background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12.5px;margin-bottom:12px;">
        <div style="font-weight:700;color:var(--ink);margin-bottom:3px;">AI Triage Assessment</div>
        <div style="color:var(--ink-secondary);">${escapeHtml(t.ai_reasoning)}</div>
        <div style="margin-top:6px;font-size:11.5px;color:var(--ink-muted);">
          Routed to <strong>${escapeHtml(t.department)}</strong> &bull; Engine: ${escapeHtml(t.engine_used)}
        </div>
      </div>

      <div style="font-size:12px;color:var(--ink-muted);margin-bottom:14px;">
        <div><strong>Citizen Contact:</strong> ${escapeHtml(t.citizen_contact)}</div>
        <div style="margin-top:3px;">
          <strong>Coordinates:</strong> <span class="mono">${Number(t.latitude).toFixed(4)}, ${Number(t.longitude).toFixed(4)}</span>
          &middot; <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--brand);font-weight:600;">Open in Google Maps</a>
        </div>
      </div>

      <div style="display:flex;gap:8px;">
        <button id="btn-in-progress" class="btn btn-amber btn-sm" style="flex:1;" type="button">Dispatch Crew</button>
        <button id="btn-resolved" class="btn btn-emerald btn-sm" style="flex:1;" type="button">Mark Resolved</button>
      </div>
      <div id="inspector-action-msg" style="margin-top:8px;font-size:12px;color:var(--brand);font-weight:600;"></div>
    `;

    document.getElementById("btn-in-progress").addEventListener("click", () => updateTicketStatus(t.ticket_id, "IN_PROGRESS"));
    document.getElementById("btn-resolved").addEventListener("click", () => updateTicketStatus(t.ticket_id, "RESOLVED"));
  }

  async function updateTicketStatus(ticketId, status) {
    const msgEl = document.getElementById("inspector-action-msg");
    if (msgEl) msgEl.textContent = "Updating status & dispatching SNS alert...";
    try {
      const res = await requestJson(`/tickets/${encodeURIComponent(ticketId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error(res.data.detail || "Update failed");
      await loadOperationsData();
      const postMsg = document.getElementById("inspector-action-msg");
      if (postMsg) postMsg.textContent = `Status set to ${formatStatusLabel(status)}. SNS notification queued.`;
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  }

  function renderSnsTable() {
    if (!state.snsAlerts.length) {
      els.snsBody.innerHTML =
        '<tr><td colspan="6" style="color:var(--ink-muted);text-align:center;padding:24px;">No SNS alerts dispatched yet. Dispatch or resolve a ticket to log alerts.</td></tr>';
      return;
    }

    els.snsBody.innerHTML = state.snsAlerts
      .map(
        (a) => `
      <tr>
        <td><span class="mono" style="font-size:12px;">${escapeHtml(a.alert_id)}</span></td>
        <td><span class="mono" style="font-weight:600;">${escapeHtml(a.ticket_id)}</span></td>
        <td><span class="badge badge-${escapeHtml(a.status)}">${escapeHtml(formatStatusLabel(a.status))}</span></td>
        <td style="font-size:12px;">${escapeHtml(a.channel)}</td>
        <td style="font-size:12.5px;">${escapeHtml(a.recipient)}</td>
        <td style="font-size:12.5px;color:var(--ink-secondary);">${escapeHtml(a.message)}</td>
      </tr>`
      )
      .join("");
  }

  async function sendOpsChat(preset) {
    const q = (preset || els.chatInput.value || "").trim();
    if (!q) return;
    els.chatInput.value = "";

    const u = document.createElement("div");
    u.className = "msg-bubble msg-user";
    u.textContent = q;
    els.chatFeed.appendChild(u);
    els.chatFeed.scrollTop = els.chatFeed.scrollHeight;

    try {
      const res = await requestJson("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      const b = document.createElement("div");
      b.className = "msg-bubble msg-ai";
      b.textContent = res.data.answer || "No analysis returned.";
      if (res.data.engine_used) {
        const meta = document.createElement("div");
        meta.className = "msg-source";
        meta.textContent = `Source: ${res.data.engine_used}`;
        b.appendChild(meta);
      }
      els.chatFeed.appendChild(b);
    } catch (_err) {
      const e = document.createElement("div");
      e.className = "msg-bubble msg-ai";
      e.textContent = "Unable to reach Operations AI service.";
      els.chatFeed.appendChild(e);
    }
    els.chatFeed.scrollTop = els.chatFeed.scrollHeight;
  }

  // Rail view navigation
  document.querySelectorAll(".rail-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rail-btn[data-view]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-view");
      document.querySelectorAll(".admin-view").forEach((v) => {
        v.style.display = v.id === target ? "block" : "none";
      });
      els.viewHeading.textContent = VIEW_TITLES[target] || "Operations Console";
      if (target === "view-dispatch" && state.map) {
        setTimeout(() => state.map.invalidateSize(), 120);
      }
    });
  });

  els.search.addEventListener("input", renderQueue);
  els.deptFilter.addEventListener("change", renderQueue);
  els.statusFilter.addEventListener("change", renderQueue);
  document.getElementById("ops-refresh-btn").addEventListener("click", () => {
    refreshHealth();
    loadOperationsData();
  });

  document.querySelectorAll(".ops-prompt").forEach((btn) => {
    btn.addEventListener("click", () => sendOpsChat(btn.getAttribute("data-q")));
  });
  els.chatSend.addEventListener("click", () => sendOpsChat());
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendOpsChat();
  });

  els.apiInput.value = getBaseUrl();
  document.getElementById("ops-save-api").addEventListener("click", () => {
    setBaseUrl(els.apiInput.value);
    els.settingsNotice.textContent = `Endpoint updated to ${getBaseUrl()}`;
    els.settingsNotice.className = "notice show notice-success";
    refreshHealth();
    loadOperationsData();
  });

  document.getElementById("ops-seed-btn").addEventListener("click", async () => {
    const res = await requestJson("/tickets/seed", { method: "POST" });
    els.settingsNotice.textContent = res.data.seeded
      ? `Initialized ${res.data.count} baseline municipal tickets.`
      : res.data.message || "Tickets already present.";
    els.settingsNotice.className = "notice show notice-info";
    await loadOperationsData();
  });

  initMap();
  refreshHealth();
  loadOperationsData();
})();
