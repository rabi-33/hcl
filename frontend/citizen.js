/* CivicSignal Citizen Portal Controller */

(() => {
  const { requestJson, escapeHtml, formatStatusLabel, formatRelativeTime, getBaseUrl, setBaseUrl } =
    window.CivicApi;

  const state = {
    selectedCategory: "Pothole",
    imageData: null,
    tickets: [],
    map: null,
    marker: null
  };

  const els = {
    serviceDot: document.getElementById("service-dot"),
    serviceText: document.getElementById("service-status-text"),
    heroOpenCount: document.getElementById("hero-open-count"),
    form: document.getElementById("citizen-report-form"),
    locationName: document.getElementById("location-name"),
    latitude: document.getElementById("latitude"),
    longitude: document.getElementById("longitude"),
    desc: document.getElementById("issue-desc"),
    contact: document.getElementById("citizen-contact"),
    photoFile: document.getElementById("photo-file"),
    dropzone: document.getElementById("photo-dropzone"),
    previewWrap: document.getElementById("photo-preview-wrap"),
    previewImg: document.getElementById("photo-preview"),
    photoName: document.getElementById("photo-filename"),
    clearPhotoBtn: document.getElementById("clear-photo-btn"),
    submitBtn: document.getElementById("submit-report-btn"),
    submitNotice: document.getElementById("submit-notice"),
    trackerSearch: document.getElementById("tracker-search"),
    trackerStatus: document.getElementById("tracker-status"),
    ticketList: document.getElementById("citizen-ticket-list"),
    helpFab: document.getElementById("help-fab"),
    helpDrawer: document.getElementById("help-drawer"),
    closeHelpBtn: document.getElementById("close-help-btn"),
    chatFeed: document.getElementById("citizen-chat-feed"),
    chatInput: document.getElementById("citizen-chat-input"),
    chatSend: document.getElementById("citizen-chat-send"),
    configModal: document.getElementById("config-modal"),
    apiUrlInput: document.getElementById("api-url-input")
  };

  function initMap() {
    if (typeof L === "undefined") {
      document.getElementById("citizen-map").innerHTML =
        '<div style="padding:16px;font-size:12.5px;color:#475569;">Map tiles unavailable offline. Enter coordinates or pick a Chennai area chip above.</div>';
      return;
    }
    const lat = parseFloat(els.latitude.value) || 13.177;
    const lng = parseFloat(els.longitude.value) || 80.097;

    state.map = L.map("citizen-map", { zoomControl: true }).setView([lat, lng], 14);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19
    }).addTo(state.map);

    state.marker = L.marker([lat, lng], { draggable: true }).addTo(state.map);
    state.marker.on("dragend", () => {
      const pos = state.marker.getLatLng();
      els.latitude.value = pos.lat.toFixed(4);
      els.longitude.value = pos.lng.toFixed(4);
    });

    state.map.on("click", (e) => {
      setMapCoordinates(e.latlng.lat, e.latlng.lng);
    });
  }

  function setMapCoordinates(lat, lng, label) {
    els.latitude.value = Number(lat).toFixed(4);
    els.longitude.value = Number(lng).toFixed(4);
    if (label) els.locationName.value = label;
    if (state.map && state.marker) {
      state.marker.setLatLng([lat, lng]);
      state.map.setView([lat, lng], 15);
    }
  }

  function showNotice(msg, kind = "info") {
    els.submitNotice.textContent = msg;
    els.submitNotice.className = `notice show notice-${kind}`;
  }

  async function refreshHealth() {
    try {
      const res = await requestJson("/health");
      if (!res.ok) throw new Error("Unhealthy");
      els.serviceDot.classList.remove("offline");
      els.serviceText.textContent = "Service Operational";
    } catch (_err) {
      els.serviceDot.classList.add("offline");
      els.serviceText.textContent = "Backend Offline";
    }
  }

  async function loadTickets() {
    try {
      const res = await requestJson("/tickets");
      if (!res.ok) throw new Error("Load failed");
      state.tickets = res.data.tickets || [];
      const activeCount = state.tickets.filter((t) => t.status !== "RESOLVED").length;
      els.heroOpenCount.textContent = `${activeCount} Active`;
      renderTickets();
    } catch (_err) {
      els.ticketList.innerHTML =
        '<div style="color:var(--ink-muted);font-size:13px;">Unable to fetch live tickets from backend. Check API Endpoint settings.</div>';
    }
  }

  function renderTickets() {
    const query = (els.trackerSearch.value || "").trim().toLowerCase();
    const statusFilter = els.trackerStatus.value;

    const filtered = state.tickets.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (query) {
        const hay = `${t.ticket_id} ${t.category} ${t.location_name} ${t.description}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      els.ticketList.innerHTML =
        '<div style="padding:24px 0;text-align:center;color:var(--ink-muted);font-size:13px;">No matching service requests found.</div>';
      return;
    }

    els.ticketList.innerHTML = filtered
      .map((t) => {
        const dup = Number(t.duplicate_count || 1);
        return `
        <article class="ticket-row">
          <div class="ticket-row-head">
            <div>
              <span class="mono" style="font-weight:600;color:var(--ink);font-size:12.5px;">${escapeHtml(t.ticket_id)}</span>
              <span style="margin:0 6px;color:var(--border-strong);">&bull;</span>
              <span class="ticket-row-title">${escapeHtml(t.category)}</span>
            </div>
            <span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(formatStatusLabel(t.status))}</span>
          </div>
          <div style="font-size:13px;color:var(--ink-secondary);">${escapeHtml(t.description)}</div>
          <div class="ticket-row-meta">
            <span><strong>Area:</strong> ${escapeHtml(t.location_name)}</span>
            <span><strong>Dept:</strong> ${escapeHtml(t.department)}</span>
            <span><strong>Updated:</strong> ${escapeHtml(formatRelativeTime(t.updated_at || t.created_at))}</span>
            ${dup > 1 ? `<span class="badge badge-cluster">${dup} citizen reports merged</span>` : ""}
          </div>
        </article>`;
      })
      .join("");
  }

  function handleSelectedFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showNotice("Please select a valid JPG or PNG image file.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.imageData = reader.result;
      els.previewImg.src = state.imageData;
      els.photoName.textContent = file.name;
      els.previewWrap.style.display = "flex";
      els.dropzone.style.display = "none";
    };
    reader.readAsDataURL(file);
  }

  // Category selector
  document.querySelectorAll(".cat-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".cat-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedCategory = card.getAttribute("data-category");
    });
  });

  // Preset district buttons & GPS
  document.querySelectorAll(".preset-loc").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMapCoordinates(
        parseFloat(btn.getAttribute("data-lat")),
        parseFloat(btn.getAttribute("data-lng")),
        btn.getAttribute("data-name")
      );
    });
  });

  document.getElementById("gps-detect-btn").addEventListener("click", () => {
    if (!navigator.geolocation) {
      showNotice("Browser GPS is unavailable. Click directly on the map to set coordinates.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setMapCoordinates(pos.coords.latitude, pos.coords.longitude),
      () => showNotice("Location permission denied. Click on the map or pick an area chip.", "error")
    );
  });

  els.latitude.addEventListener("change", () => {
    const lat = parseFloat(els.latitude.value);
    const lng = parseFloat(els.longitude.value);
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && state.marker && state.map) {
      state.marker.setLatLng([lat, lng]);
      state.map.setView([lat, lng]);
    }
  });
  els.longitude.addEventListener("change", () => {
    const lat = parseFloat(els.latitude.value);
    const lng = parseFloat(els.longitude.value);
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && state.marker && state.map) {
      state.marker.setLatLng([lat, lng]);
      state.map.setView([lat, lng]);
    }
  });

  // Dropzone handlers
  els.dropzone.addEventListener("click", () => els.photoFile.click());
  els.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropzone.style.borderColor = "var(--brand)";
  });
  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.style.borderColor = "";
  });
  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropzone.style.borderColor = "";
    if (e.dataTransfer.files?.[0]) handleSelectedFile(e.dataTransfer.files[0]);
  });
  els.photoFile.addEventListener("change", (e) => {
    if (e.target.files?.[0]) handleSelectedFile(e.target.files[0]);
  });
  els.clearPhotoBtn.addEventListener("click", () => {
    state.imageData = null;
    els.photoFile.value = "";
    els.previewWrap.style.display = "none";
    els.dropzone.style.display = "block";
  });

  // Submit Form
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "Verifying & Routing Request...";
    showNotice("Running automated triage and 150m duplicate cluster check...", "info");

    try {
      const payload = {
        category: state.selectedCategory,
        description: els.desc.value.trim(),
        location_name: els.locationName.value.trim(),
        latitude: parseFloat(els.latitude.value),
        longitude: parseFloat(els.longitude.value),
        citizen_contact: els.contact.value.trim(),
        image_data: state.imageData
      };

      const res = await requestJson("/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.status === 422 && res.data.rejected) {
        showNotice(`Submission Declined: ${res.data.reason}`, "error");
        return;
      }
      if (!res.ok) {
        showNotice(res.data.error || "Unable to submit request.", "error");
        return;
      }

      const t = res.data.ticket;
      if (res.data.merged) {
        showNotice(
          `Existing nearby issue detected within 150m. Merged into ${t.ticket_id} (${t.duplicate_count} citizen reports, Priority escalated to ${t.priority_score}/100).`,
          "success"
        );
      } else {
        showNotice(
          `Request ${t.ticket_id} logged and assigned to ${t.department} (Priority ${t.priority_score}/100).`,
          "success"
        );
      }

      els.desc.value = "";
      if (state.imageData) els.clearPhotoBtn.click();
      await loadTickets();
    } catch (_err) {
      showNotice("Network error communicating with CivicSignal API.", "error");
    } finally {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Submit Service Request";
    }
  });

  // Tracker filtering
  els.trackerSearch.addEventListener("input", renderTickets);
  els.trackerStatus.addEventListener("change", renderTickets);
  document.getElementById("refresh-tracker-btn").addEventListener("click", loadTickets);

  // Floating Citizen Help Drawer
  els.helpFab.addEventListener("click", () => els.helpDrawer.classList.toggle("open"));
  els.closeHelpBtn.addEventListener("click", () => els.helpDrawer.classList.remove("open"));

  async function sendCitizenChat() {
    const q = els.chatInput.value.trim();
    if (!q) return;
    els.chatInput.value = "";

    const userMsg = document.createElement("div");
    userMsg.className = "msg-bubble msg-user";
    userMsg.textContent = q;
    els.chatFeed.appendChild(userMsg);
    els.chatFeed.scrollTop = els.chatFeed.scrollHeight;

    try {
      const res = await requestJson("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      const botMsg = document.createElement("div");
      botMsg.className = "msg-bubble msg-ai";
      botMsg.textContent = res.data.answer || "No response received.";
      els.chatFeed.appendChild(botMsg);
    } catch (_err) {
      const errMsg = document.createElement("div");
      errMsg.className = "msg-bubble msg-ai";
      errMsg.textContent = "Assistant unavailable while backend is offline.";
      els.chatFeed.appendChild(errMsg);
    }
    els.chatFeed.scrollTop = els.chatFeed.scrollHeight;
  }

  els.chatSend.addEventListener("click", sendCitizenChat);
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendCitizenChat();
  });

  // API Config Modal
  document.getElementById("open-config-btn").addEventListener("click", () => {
    els.apiUrlInput.value = getBaseUrl();
    els.configModal.classList.add("open");
  });
  document.getElementById("close-config-btn").addEventListener("click", () => {
    els.configModal.classList.remove("open");
  });
  document.getElementById("save-config-btn").addEventListener("click", () => {
    setBaseUrl(els.apiUrlInput.value);
    els.configModal.classList.remove("open");
    refreshHealth();
    loadTickets();
  });

  initMap();
  refreshHealth();
  loadTickets();
})();
