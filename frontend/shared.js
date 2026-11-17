/* CivicSignal Shared API Client & Utilities */

window.CivicApi = (() => {
  const DEPLOYED_AZURE_API = "https://civicsignal-api-afc4asafb9b4frfr.centralindia-01.azurewebsites.net";
  const DEFAULT_API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? window.location.origin
      : window.location.hostname.endsWith("azurewebsites.net")
      ? window.location.origin
      : DEPLOYED_AZURE_API;

  function getBaseUrl() {
    return (localStorage.getItem("civicsignal_api_base") || DEFAULT_API_BASE).replace(/\/+$/, "");
  }

  function setBaseUrl(url) {
    const clean = (url || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
    localStorage.setItem("civicsignal_api_base", clean);
    return clean;
  }

  function url(path) {
    return `${getBaseUrl()}${path}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatStatusLabel(status) {
    if (status === "IN_PROGRESS") return "In Progress";
    if (status === "RESOLVED") return "Resolved";
    return "Open";
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    const diffMins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.round(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return date.toLocaleDateString();
  }

  async function requestJson(path, options = {}) {
    const resp = await fetch(url(path), options);
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  }

  let inMemoryAdminToken = "";
  try {
    sessionStorage.removeItem("civicsignal_admin_token");
  } catch (_err) {
    // Ignore storage errors
  }

  function getAdminToken() {
    return inMemoryAdminToken;
  }

  function setAdminToken(token) {
    inMemoryAdminToken = token || "";
  }

  function clearAdminToken() {
    inMemoryAdminToken = "";
  }

  function getAdminAuthHeaders(extra = {}) {
    const token = getAdminToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  }

  return {
    getBaseUrl,
    setBaseUrl,
    url,
    escapeHtml,
    formatStatusLabel,
    formatRelativeTime,
    requestJson,
    getAdminToken,
    setAdminToken,
    clearAdminToken,
    getAdminAuthHeaders
  };
})();
