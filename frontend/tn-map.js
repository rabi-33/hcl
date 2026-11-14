/* Interactive Tamil Nadu Vector Map (Zero External Tile Dependencies) */

window.TamilNaduMap = (() => {
  // Geographic bounds covering Tamil Nadu
  const FULL_BOUNDS = { minLat: 7.95, maxLat: 13.75, minLng: 76.1, maxLng: 80.55 };
  const CHENNAI_BOUNDS = { minLat: 12.88, maxLat: 13.26, minLng: 79.98, maxLng: 80.34 };

  // Cartographic outline of Tamil Nadu in [lat, lng] coordinates
  const TN_BORDER = [
    [13.56, 80.28], [13.38, 80.33], [13.08, 80.29], [12.78, 80.25], [12.45, 80.14],
    [12.02, 79.86], [11.74, 79.78], [11.35, 79.83], [10.98, 79.85], [10.30, 79.88],
    [10.12, 79.52], [9.85, 79.12], [9.28, 79.31], [9.18, 78.92], [8.80, 78.16],
    [8.38, 78.05], [8.08, 77.55], [8.29, 77.18], [8.65, 77.22], [9.12, 77.32],
    [9.65, 77.28], [10.05, 77.18], [10.38, 77.25], [10.65, 76.85], [11.02, 76.72],
    [11.48, 76.42], [11.65, 76.55], [11.72, 77.12], [12.18, 77.55], [12.68, 77.78],
    [12.85, 78.15], [12.98, 78.75], [13.18, 79.25], [13.36, 79.68], [13.56, 80.28]
  ];

  // Key highway corridors for visual geographic context
  const HIGHWAYS = [
    [[13.08, 80.27], [12.92, 79.13], [12.52, 78.21], [11.66, 78.15], [11.02, 76.96]], // NH48/NH544 Chennai-Vellore-Salem-Coimbatore
    [[13.08, 80.27], [11.94, 79.49], [10.79, 78.70], [9.93, 78.12], [8.71, 77.76], [8.09, 77.54]], // NH45/NH44 Chennai-Trichy-Madurai-Tirunelveli-Kanyakumari
    [[11.66, 78.15], [10.79, 78.70], [10.78, 79.14]] // Salem-Trichy-Thanjavur
  ];

  const TN_CITIES = [
    { name: "Chennai", lat: 13.0827, lng: 80.2707, major: true },
    { name: "Avadi / Vel Tech", lat: 13.1770, lng: 80.0970, major: false },
    { name: "Anna Nagar", lat: 13.0850, lng: 80.2101, major: false },
    { name: "T. Nagar", lat: 13.0418, lng: 80.2341, major: false },
    { name: "Kanchipuram", lat: 12.8342, lng: 79.7036, major: false },
    { name: "Vellore", lat: 12.9165, lng: 79.1325, major: true },
    { name: "Hosur", lat: 12.7409, lng: 77.8253, major: false },
    { name: "Salem", lat: 11.6643, lng: 78.1460, major: true },
    { name: "Erode", lat: 11.3410, lng: 77.7172, major: false },
    { name: "Coimbatore", lat: 11.0168, lng: 76.9558, major: true },
    { name: "Tiruchirappalli", lat: 10.7905, lng: 78.7047, major: true },
    { name: "Thanjavur", lat: 10.7870, lng: 79.1378, major: false },
    { name: "Madurai", lat: 9.9252, lng: 78.1198, major: true },
    { name: "Tirunelveli", lat: 8.7139, lng: 77.7567, major: true },
    { name: "Thoothukudi", lat: 8.7642, lng: 78.1348, major: false },
    { name: "Kanyakumari", lat: 8.0883, lng: 77.5385, major: false }
  ];

  function create(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const width = 560;
    const height = options.height || 320;
    let mode = options.initialMode || "state"; // "state" | "chennai"
    let tickets = [];
    let selectedTicketId = null;
    let draftPin = options.draftPin || null; // { lat, lng, label }

    container.classList.add("tn-map-shell");
    container.innerHTML = `
      <div class="tn-map-toolbar">
        <span class="tn-map-title">Tamil Nadu GIS Grid</span>
        <div class="tn-map-zoom-group">
          <button type="button" class="tn-zoom-btn active" data-mode="state">All Tamil Nadu</button>
          <button type="button" class="tn-zoom-btn" data-mode="chennai">Chennai Metro</button>
        </div>
      </div>
      <div class="tn-map-canvas-wrap">
        <svg class="tn-map-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="tn-map-tooltip" style="display:none;"></div>
      </div>
    `;

    const svg = container.querySelector(".tn-map-svg");
    const tooltip = container.querySelector(".tn-map-tooltip");
    const zoomBtns = container.querySelectorAll(".tn-zoom-btn");

    zoomBtns.forEach((btn) => {
      if (btn.getAttribute("data-mode") === mode) btn.classList.add("active");
      else btn.classList.remove("active");
      btn.addEventListener("click", () => {
        mode = btn.getAttribute("data-mode");
        zoomBtns.forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });

    function getBounds() {
      return mode === "chennai" ? CHENNAI_BOUNDS : FULL_BOUNDS;
    }

    function project(lat, lng) {
      const b = getBounds();
      const pad = 22;
      const x = pad + ((lng - b.minLng) / (b.maxLng - b.minLng)) * (width - pad * 2);
      const y = height - pad - ((lat - b.minLat) / (b.maxLat - b.minLat)) * (height - pad * 2);
      return { x, y };
    }

    function unproject(x, y) {
      const b = getBounds();
      const pad = 22;
      const lng = b.minLng + ((x - pad) / (width - pad * 2)) * (b.maxLng - b.minLng);
      const lat = b.minLat + ((height - pad - y) / (height - pad * 2)) * (b.maxLat - b.minLat);
      return {
        lat: Math.max(b.minLat, Math.min(b.maxLat, lat)),
        lng: Math.max(b.minLng, Math.min(b.maxLng, lng))
      };
    }

    function nearestCityName(lat, lng) {
      let best = "Tamil Nadu";
      let bestDist = Infinity;
      TN_CITIES.forEach((c) => {
        const d = Math.hypot(c.lat - lat, c.lng - lng);
        if (d < bestDist) {
          bestDist = d;
          best = c.name;
        }
      });
      return bestDist < 0.35 ? `${best} Zone` : `${best} Corridor`;
    }

    function escapeAttr(val) {
      return String(val || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function render() {
      const parts = [];

      // Subtle lat/lng grid lines
      for (let i = 1; i <= 4; i += 1) {
        const gx = (width / 5) * i;
        const gy = (height / 5) * i;
        parts.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${height}" stroke="#e2e8f0" stroke-width="0.8" stroke-dasharray="3 3" />`);
        parts.push(`<line x1="0" y1="${gy}" x2="${width}" y2="${gy}" stroke="#e2e8f0" stroke-width="0.8" stroke-dasharray="3 3" />`);
      }

      // Tamil Nadu landmass polygon
      const borderPts = TN_BORDER.map(([la, ln]) => {
        const p = project(la, ln);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      }).join(" ");
      parts.push(
        `<polygon points="${borderPts}" fill="#ffffff" stroke="#0f766e" stroke-width="1.8" stroke-linejoin="round" />`
      );

      // Highway lines
      HIGHWAYS.forEach((line) => {
        const pts = line
          .map(([la, ln]) => {
            const p = project(la, ln);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          })
          .join(" ");
        parts.push(`<polyline points="${pts}" fill="none" stroke="#cbd5e1" stroke-width="1.3" stroke-dasharray="4 3" />`);
      });

      // City reference nodes
      TN_CITIES.forEach((c) => {
        if (mode === "state" && !c.major && c.name !== "Kanchipuram" && c.name !== "Thanjavur") {
          return;
        }
        if (mode === "chennai" && (c.lat < 12.85 || c.lng < 79.95)) {
          return;
        }
        const p = project(c.lat, c.lng);
        parts.push(
          `<g class="tn-city-node" data-city="${escapeAttr(c.name)}" data-lat="${c.lat}" data-lng="${c.lng}" style="cursor:pointer;">
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${c.major ? 3.8 : 2.8}" fill="#475569" />
            <text x="${(p.x + 6).toFixed(1)}" y="${(p.y + 3).toFixed(1)}" font-size="10.5" font-weight="600" fill="#334155">${escapeAttr(c.name)}</text>
          </g>`
        );
      });

      // Ticket markers (for Operations Console or live overview)
      tickets.forEach((t) => {
        const lat = Number(t.latitude);
        const lng = Number(t.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return;
        const b = getBounds();
        if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return;

        const p = project(lat, lng);
        const dup = Number(t.duplicate_count || 1);
        const color =
          t.priority_band === "CRITICAL"
            ? "#dc2626"
            : t.priority_band === "HIGH"
            ? "#d97706"
            : "#0284c7";
        const isSelected = t.ticket_id === selectedTicketId;
        const radius = 6 + Math.min(5, dup * 1.4);

        if (dup > 1) {
          parts.push(
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radius + 8}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1" stroke-opacity="0.45" />`
          );
        }
        if (isSelected) {
          parts.push(
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radius + 5}" fill="none" stroke="#0f172a" stroke-width="2" />`
          );
        }
        parts.push(
          `<circle class="tn-ticket-pin" data-ticket-id="${escapeAttr(t.ticket_id)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radius}" fill="${color}" stroke="#ffffff" stroke-width="2" style="cursor:pointer;" />`
        );
      });

      // Draft pin (for Citizen location picker)
      if (draftPin && !Number.isNaN(draftPin.lat) && !Number.isNaN(draftPin.lng)) {
        const p = project(draftPin.lat, draftPin.lng);
        parts.push(
          `<g class="tn-draft-pin">
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" fill="#0f766e" fill-opacity="0.18" />
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="#0f766e" stroke="#ffffff" stroke-width="2.2" />
          </g>`
        );
      }

      svg.innerHTML = parts.join("");

      // Bind city click handlers
      svg.querySelectorAll(".tn-city-node").forEach((node) => {
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          const lat = parseFloat(node.getAttribute("data-lat"));
          const lng = parseFloat(node.getAttribute("data-lng"));
          const name = node.getAttribute("data-city");
          if (options.onPickLocation) {
            setDraftPin(lat, lng, name);
            options.onPickLocation({ lat, lng, suggestedLabel: name });
          }
        });
      });

      // Bind ticket pin hover + click
      svg.querySelectorAll(".tn-ticket-pin").forEach((pin) => {
        const tid = pin.getAttribute("data-ticket-id");
        const ticket = tickets.find((x) => x.ticket_id === tid);
        pin.addEventListener("mouseenter", (e) => {
          if (!ticket) return;
          tooltip.style.display = "block";
          tooltip.innerHTML = `<strong>${escapeAttr(ticket.ticket_id)}</strong> &bull; ${escapeAttr(ticket.category)}<br/>${escapeAttr(ticket.location_name)} (Priority ${ticket.priority_score})`;
          const rect = container.querySelector(".tn-map-canvas-wrap").getBoundingClientRect();
          tooltip.style.left = `${Math.min(rect.width - 180, Math.max(8, e.clientX - rect.left + 10))}px`;
          tooltip.style.top = `${Math.max(8, e.clientY - rect.top - 36)}px`;
        });
        pin.addEventListener("mouseleave", () => {
          tooltip.style.display = "none";
        });
        pin.addEventListener("click", (e) => {
          e.stopPropagation();
          if (ticket && options.onSelectTicket) {
            selectedTicketId = ticket.ticket_id;
            render();
            options.onSelectTicket(ticket);
          }
        });
      });
    }

    // Click anywhere on map canvas to drop pin (Citizen Portal)
    svg.addEventListener("click", (e) => {
      if (!options.onPickLocation) return;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const y = ((e.clientY - rect.top) / rect.height) * height;
      const { lat, lng } = unproject(x, y);
      const suggestedLabel = nearestCityName(lat, lng);
      setDraftPin(lat, lng, suggestedLabel);
      options.onPickLocation({ lat, lng, suggestedLabel });
    });

    function setDraftPin(lat, lng, label) {
      draftPin = { lat: Number(lat), lng: Number(lng), label };
      render();
    }

    function setTickets(newTickets, activeId = null) {
      tickets = Array.isArray(newTickets) ? newTickets : [];
      if (activeId) selectedTicketId = activeId;
      render();
    }

    function setSelectedTicket(ticketId) {
      selectedTicketId = ticketId;
      render();
    }

    function setMode(nextMode) {
      mode = nextMode === "chennai" ? "chennai" : "state";
      zoomBtns.forEach((b) => b.classList.toggle("active", b.getAttribute("data-mode") === mode));
      render();
    }

    render();

    return {
      setDraftPin,
      setTickets,
      setSelectedTicket,
      setMode,
      render
    };
  }

  return { create, TN_CITIES };
})();
