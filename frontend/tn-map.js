/* Interactive Tamil Nadu Street & Geospatial Map (MapLibre GL + MapTiler) */

window.TamilNaduMap = (() => {
  const DEFAULT_MAPTILER_KEY = "lUm1QzpLSvXH2OD5kY30";
  const TN_MAX_BOUNDS = [
    [75.8, 7.6], // Southwest [lng, lat]
    [80.9, 14.0] // Northeast [lng, lat]
  ];
  const TN_BBOX_PARAM = "76.1,8.0,80.4,13.6";

  function getKey() {
    return localStorage.getItem("civicsignal_maptiler_key") || DEFAULT_MAPTILER_KEY;
  }

  function escapeHtml(val) {
    return String(val || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function geocodePlace(query) {
    const url =
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
      `?country=IN&bbox=${TN_BBOX_PARAM}&limit=1&key=${encodeURIComponent(getKey())}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data.features?.[0];
    if (!feat || !Array.isArray(feat.center)) return null;
    return {
      lng: feat.center[0],
      lat: feat.center[1],
      label: feat.place_name || feat.text || query
    };
  }

  async function reverseGeocode(lat, lng) {
    try {
      const url =
        `https://api.maptiler.com/geocoding/${lng.toFixed(5)},${lat.toFixed(5)}.json` +
        `?limit=1&key=${encodeURIComponent(getKey())}`;
      const res = await fetch(url);
      if (!res.ok) return "";
      const data = await res.json();
      const feat = data.features?.[0];
      return feat?.text || feat?.place_name || "";
    } catch (_err) {
      return "";
    }
  }

  function create(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const mapHeight = options.height || 300;
    const styleName = options.style || "streets-v2";
    const initialMode = options.initialMode || "state";
    let draftMarker = null;
    let ticketMarkers = [];
    let selectedTicketId = null;
    let latestTickets = [];

    container.classList.add("tn-map-shell");
    container.innerHTML = `
      <div class="tn-map-toolbar">
        <span class="tn-map-title">Tamil Nadu GIS Map</span>
        ${
          options.enableSearch
            ? `<div class="tn-map-search">
                <input type="text" class="tn-search-input" placeholder="Search street or city in TN..." />
                <button type="button" class="tn-zoom-btn tn-search-go">Find</button>
              </div>`
            : ""
        }
        <div class="tn-map-zoom-group">
          <button type="button" class="tn-zoom-btn ${initialMode === "state" ? "active" : ""}" data-mode="state">Tamil Nadu</button>
          <button type="button" class="tn-zoom-btn ${initialMode === "chennai" ? "active" : ""}" data-mode="chennai">Chennai</button>
        </div>
      </div>
      <div class="tn-gl-canvas" style="height:${mapHeight}px;"></div>
    `;

    const canvasEl = container.querySelector(".tn-gl-canvas");
    const zoomBtns = container.querySelectorAll(".tn-zoom-btn[data-mode]");

    if (typeof maplibregl === "undefined") {
      canvasEl.innerHTML =
        '<div style="padding:18px;font-size:13px;color:#475569;">MapLibre GL library unavailable offline. Use the preset area chips or enter coordinates directly.</div>';
      return {
        setDraftPin: () => {},
        setTickets: () => {},
        setSelectedTicket: () => {},
        setMode: () => {},
        render: () => {}
      };
    }

    const startCenter =
      options.draftPin && !Number.isNaN(options.draftPin.lat) && !Number.isNaN(options.draftPin.lng)
        ? [Number(options.draftPin.lng), Number(options.draftPin.lat)]
        : initialMode === "chennai"
        ? [80.19, 13.08]
        : [78.65, 11.12];

    const startZoom =
      options.draftPin && initialMode === "chennai"
        ? 12
        : initialMode === "chennai"
        ? 10.6
        : 6.3;

    const map = new maplibregl.Map({
      container: canvasEl,
      style: `https://api.maptiler.com/maps/${styleName}/style.json?key=${encodeURIComponent(getKey())}`,
      center: startCenter,
      zoom: startZoom,
      maxBounds: TN_MAX_BOUNDS,
      attributionControl: true
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    function updateDraftMarker(lat, lng, fly = false) {
      const nLat = Number(lat);
      const nLng = Number(lng);
      if (Number.isNaN(nLat) || Number.isNaN(nLng)) return;

      if (!draftMarker) {
        draftMarker = new maplibregl.Marker({ color: "#0f766e", draggable: true })
          .setLngLat([nLng, nLat])
          .addTo(map);
        draftMarker.on("dragend", async () => {
          const pos = draftMarker.getLngLat();
          const label = await reverseGeocode(pos.lat, pos.lng);
          if (options.onPickLocation) {
            options.onPickLocation({ lat: pos.lat, lng: pos.lng, suggestedLabel: label });
          }
        });
      } else {
        draftMarker.setLngLat([nLng, nLat]);
      }

      if (fly) {
        map.flyTo({ center: [nLng, nLat], zoom: Math.max(map.getZoom(), 13), duration: 650 });
      }
    }

    if (options.draftPin) {
      updateDraftMarker(options.draftPin.lat, options.draftPin.lng, false);
    }

    if (options.onPickLocation) {
      map.on("click", async (e) => {
        const { lat, lng } = e.lngLat;
        updateDraftMarker(lat, lng, false);
        const label = await reverseGeocode(lat, lng);
        options.onPickLocation({ lat, lng, suggestedLabel: label });
      });
    }

    // Search bar handler (Citizen Portal)
    if (options.enableSearch) {
      const searchInput = container.querySelector(".tn-search-input");
      const searchBtn = container.querySelector(".tn-search-go");

      const runSearch = async () => {
        const q = (searchInput.value || "").trim();
        if (!q) return;
        searchBtn.textContent = "...";
        try {
          const hit = await geocodePlace(q);
          if (hit) {
            updateDraftMarker(hit.lat, hit.lng, true);
            if (options.onPickLocation) {
              options.onPickLocation({
                lat: hit.lat,
                lng: hit.lng,
                suggestedLabel: hit.label.split(",").slice(0, 2).join(", ")
              });
            }
          }
        } finally {
          searchBtn.textContent = "Find";
        }
      };

      searchBtn.addEventListener("click", runSearch);
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          runSearch();
        }
      });
    }

    function setMode(nextMode) {
      zoomBtns.forEach((b) => b.classList.toggle("active", b.getAttribute("data-mode") === nextMode));
      if (nextMode === "chennai") {
        map.flyTo({ center: [80.19, 13.08], zoom: 10.8, duration: 600 });
      } else {
        map.flyTo({ center: [78.65, 11.12], zoom: 6.3, duration: 600 });
      }
    }

    zoomBtns.forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode")));
    });

    function clearTicketMarkers() {
      ticketMarkers.forEach((m) => m.remove());
      ticketMarkers = [];
    }

    function renderTicketMarkers() {
      clearTicketMarkers();
      latestTickets.forEach((t) => {
        const lat = Number(t.latitude);
        const lng = Number(t.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return;

        const dup = Number(t.duplicate_count || 1);
        const color =
          t.priority_band === "CRITICAL"
            ? "#dc2626"
            : t.priority_band === "HIGH"
            ? "#d97706"
            : "#0284c7";
        const isSelected = t.ticket_id === selectedTicketId;

        const el = document.createElement("button");
        el.type = "button";
        el.className = `tn-pin-dot ${dup > 1 ? "has-cluster" : ""} ${isSelected ? "is-selected" : ""}`;
        el.style.backgroundColor = color;
        el.title = `${t.ticket_id}: ${t.category} (${t.priority_score}/100)`;

        const popupHtml = `
          <div style="font-family:Inter,sans-serif;font-size:12px;line-height:1.4;color:#0f172a;">
            <strong>${escapeHtml(t.ticket_id)}</strong> &bull; ${escapeHtml(t.category)}<br/>
            <span style="color:#475569;">${escapeHtml(t.location_name)}</span><br/>
            <strong>Priority: ${t.priority_score}/100</strong>${dup > 1 ? ` &bull; ${dup} reports` : ""}
          </div>
        `;
        const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(popupHtml);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener("mouseenter", () => popup.addTo(map));
        el.addEventListener("mouseleave", () => popup.remove());
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          selectedTicketId = t.ticket_id;
          renderTicketMarkers();
          if (options.onSelectTicket) options.onSelectTicket(t);
        });

        ticketMarkers.push(marker);
      });
    }

    return {
      setDraftPin: (lat, lng) => updateDraftMarker(lat, lng, true),
      setTickets: (tickets, activeId = null) => {
        latestTickets = Array.isArray(tickets) ? tickets : [];
        if (activeId) selectedTicketId = activeId;
        renderTicketMarkers();
      },
      setSelectedTicket: (ticketId) => {
        selectedTicketId = ticketId;
        renderTicketMarkers();
      },
      setMode,
      render: () => map.resize()
    };
  }

  return { create };
})();
