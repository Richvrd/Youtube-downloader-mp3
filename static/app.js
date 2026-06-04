document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("url-input");
  const addBtn = document.getElementById("add-btn");
  const queueList = document.getElementById("queue-list");
  const emptyState = document.getElementById("empty-state");
  const footerBar = document.getElementById("footer-bar");
  const counterText = document.getElementById("counter-text");
  const validationMsg = document.getElementById("validation-msg");
  const downloadAllBtn = document.getElementById("download-all-btn");
  const clearListBtn = document.getElementById("clear-list-btn");
  const deleteFilesBtn = document.getElementById("delete-files-btn");
  const themeToggle = document.getElementById("theme-toggle");
  const previewCard = document.getElementById("preview-card");
  const previewSpinner = document.getElementById("preview-spinner");
  const qualBtns = document.querySelectorAll(".qual-btn");
  const modeBtns = document.querySelectorAll(".mode-btn");
  const qualitySelector = document.getElementById("quality-selector");
  const advancedToggle = document.getElementById("advanced-toggle");
  const advancedPanel = document.getElementById("advanced-panel");
  const trimStart = document.getElementById("trim-start");
  const trimEnd = document.getElementById("trim-end");
  const pinScreen = document.getElementById("pin-screen");
  const pinInput = document.getElementById("pin-input");
  const pinUnlockBtn = document.getElementById("pin-unlock-btn");
  const pinError = document.getElementById("pin-error");
  const dropOverlay = document.getElementById("drop-overlay");

  let currentItems = [];
  let polling = false;
  let pollTimer = null;
  let itemsCache = {};
  let selectedQuality = "192";
  let selectedMode = "mp3";
  let previewData = null;
  let previewTimer = null;
  let pinStored = sessionStorage.getItem("yt-dl-pin") || "";

  const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com"];

  // --- Theme ---

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("yt-dl-theme", theme);
  }

  function initTheme() {
    const stored = localStorage.getItem("yt-dl-theme");
    if (stored) {
      applyTheme(stored);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      applyTheme("light");
    } else {
      applyTheme("dark");
    }
  }

  initTheme();

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "light" ? "dark" : "light");
  });

  // --- Quality & Mode ---

  qualBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      qualBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedQuality = btn.dataset.value;
    });
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMode = btn.dataset.value;
      qualitySelector.style.display = selectedMode === "mp4" ? "none" : "flex";
    });
  });

  // --- Advanced options ---

  advancedToggle.querySelector("button").addEventListener("click", () => {
    const hidden = advancedPanel.classList.toggle("hidden");
    advancedToggle.querySelector("button").textContent = hidden ? "Advanced options ▾" : "Advanced options ▴";
  });

  // --- Validation ---

  function validateUrl(url) {
    try {
      const u = new URL(url);
      return ALLOWED_HOSTS.includes(u.hostname);
    } catch {
      return false;
    }
  }

  function showValidation(msg) {
    validationMsg.textContent = msg;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function formatDuration(seconds) {
    if (!seconds) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatViewCount(n) {
    if (!n) return "";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(".0", "")}M views`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".0", "")}K views`;
    return `${n} views`;
  }

  function statusLabel(status) {
    return status === "downloading" ? "DOWNLOADING"
         : status === "completed" ? "DONE"
         : status === "error" ? "ERROR"
         : status === "expired" ? "EXPIRED"
         : "PENDING";
  }

  // --- Preview ---

  async function fetchPreview(url) {
    if (!url || !validateUrl(url)) {
      previewCard.classList.add("hidden");
      previewData = null;
      addBtn.disabled = true;
      return;
    }

    previewSpinner.classList.remove("hidden");
    previewCard.classList.add("hidden");
    previewData = null;
    addBtn.disabled = true;

    try {
      const resp = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
      if (!resp.ok) {
        previewSpinner.classList.add("hidden");
        return;
      }
      const data = await resp.json();
      previewData = data;
      renderPreview(data);
      addBtn.disabled = false;
    } catch {
      previewCard.classList.add("hidden");
      addBtn.disabled = true;
    }

    previewSpinner.classList.add("hidden");
  }

  function renderPreview(data) {
    previewCard.classList.remove("hidden");

    if (data.is_playlist) {
      previewCard.innerHTML = `
        <div class="preview-info">
          <div class="preview-playlist">📋 Playlist · ${data.playlist_count || "?"} videos — first: ${escapeHtml(data.title)}</div>
          <div class="preview-meta">
            <span>${escapeHtml(data.channel || "Unknown")}</span>
            <span>${formatDuration(data.duration)}</span>
          </div>
        </div>`;
      return;
    }

    const thumb = data.thumbnail
      ? `<img class="preview-thumb" src="${escapeHtml(data.thumbnail)}" alt="" loading="lazy">`
      : `<div class="preview-thumb"></div>`;

    previewCard.innerHTML = `
      ${thumb}
      <div class="preview-info">
        <div class="preview-title">${escapeHtml(data.title || "—")}</div>
        <div class="preview-meta">
          <span>${escapeHtml(data.channel || "Unknown")}</span>
          <span>${formatDuration(data.duration)}</span>
          <span>${formatViewCount(data.view_count)}</span>
        </div>
      </div>`;
  }

  function schedulePreview(url) {
    clearTimeout(previewTimer);
    if (!url) {
      previewCard.classList.add("hidden");
      previewData = null;
      addBtn.disabled = true;
      return;
    }
    previewTimer = setTimeout(() => fetchPreview(url), 600);
  }

  input.addEventListener("input", () => {
    showValidation("");
    schedulePreview(input.value.trim());
  });

  input.addEventListener("blur", () => {
    if (input.value.trim()) {
      fetchPreview(input.value.trim());
    }
  });

  // --- Add URL ---

  async function addUrl() {
    const url = input.value.trim();
    if (!url) {
      showValidation("Please enter a URL");
      return;
    }
    if (!validateUrl(url)) {
      showValidation("Invalid or unsupported URL. Only YouTube links are accepted.");
      return;
    }

    const body = {
      url,
      quality: selectedMode === "mp4" ? "" : selectedQuality,
      mode: selectedMode,
      trim_start: trimStart.value.trim(),
      trim_end: trimEnd.value.trim(),
    };

    showValidation("");
    addBtn.disabled = true;
    addBtn.textContent = "Adding…";

    try {
      const resp = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const data = await resp.json();
        showValidation(data.detail || "Failed to add URL");
        addBtn.disabled = false;
        addBtn.textContent = "Add";
        return;
      }

      const result = await resp.json();
      if (result.playlist) {
        showValidation(`Playlist detected — ${result.count} videos added to queue.`);
        setTimeout(() => showValidation(""), 3000);
      }

      input.value = "";
      previewCard.classList.add("hidden");
      previewData = null;
      addBtn.disabled = true;
      startPolling();
      await refreshQueue();
    } catch (e) {
      showValidation("Network error — check server");
    }

    addBtn.disabled = false;
    addBtn.textContent = "Add";
  }

  // --- Per-item actions ---

  async function removeItem(itemId) {
    try {
      await fetch(`/api/queue/${itemId}`, { method: "DELETE" });
      delete itemsCache[itemId];
      await refreshQueue();
    } catch (e) {
      console.error("Remove failed", e);
    }
  }

  async function clearList() {
    try {
      await fetch("/api/queue", { method: "DELETE" });
      itemsCache = {};
      await refreshQueue();
    } catch (e) {
      console.error("Clear failed", e);
    }
  }

  async function deleteDownloads() {
    try {
      await fetch("/api/downloads", { method: "DELETE" });
      itemsCache = {};
      await refreshQueue();
    } catch (e) {
      console.error("Delete downloads failed", e);
    }
  }

  // --- Queue polling ---

  async function refreshQueue() {
    try {
      const resp = await fetch("/api/queue");
      currentItems = await resp.json();
    } catch {
      return;
    }
    renderDiff();
    updateFooter();
  }

  function getPlaylistGroups(items) {
    const groups = {};
    for (const item of items) {
      if (item.playlist_id) {
        if (!groups[item.playlist_id]) groups[item.playlist_id] = [];
        groups[item.playlist_id].push(item);
      }
    }
    return groups;
  }

  function renderDiff() {
    const newIds = new Set(currentItems.map((i) => i.id));

    for (const id of Object.keys(itemsCache)) {
      if (!newIds.has(id)) {
        const el = document.getElementById(`item-${id}`);
        if (el) el.remove();
        delete itemsCache[id];
      }
    }

    const groups = getPlaylistGroups(currentItems);
    const groupedIds = new Set();

    for (const plId of Object.keys(groups)) {
      const items = groups[plId];
      const labelId = `pl-label-${plId}`;
      if (!document.getElementById(labelId)) {
        const label = document.createElement("div");
        label.className = "playlist-group-label";
        label.id = labelId;
        label.textContent = `📋 Playlist · ${items.length} tracks`;
        const firstItem = document.getElementById(`item-${items[0].id}`);
        if (firstItem) {
          queueList.insertBefore(label, firstItem);
        } else {
          queueList.appendChild(label);
        }
      }
      for (const item of items) {
        groupedIds.add(item.id);
      }
    }

    const seenLabels = new Set();
    for (const id of Object.keys(groups)) {
      seenLabels.add(`pl-label-${id}`);
    }
    for (const el of queueList.querySelectorAll(".playlist-group-label")) {
      if (!seenLabels.has(el.id)) {
        el.remove();
      }
    }

    for (const item of currentItems) {
      const cached = itemsCache[item.id];
      if (!cached) {
        itemsCache[item.id] = item;
        appendItem(item);
      } else if (hasChanged(cached, item)) {
        itemsCache[item.id] = item;
        updateItem(item);
      }
    }

    const hasItems = currentItems.length > 0;
    emptyState.style.display = hasItems ? "none" : "block";
    footerBar.classList.toggle("hidden", !hasItems);
  }

  function hasChanged(a, b) {
    return a.status !== b.status
        || a.progress !== b.progress
        || a.title !== b.title
        || a.filename !== b.filename
        || a.error !== b.error
        || a.quality !== b.quality
        || a.mode !== b.mode;
  }

  function appendItem(item) {
    const el = document.createElement("div");
    el.className = "queue-item";
    el.id = `item-${item.id}`;
    el.dataset.id = item.id;
    el.innerHTML = buildItemHtml(item);
    queueList.appendChild(el);

    const removeBtn = el.querySelector(".remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeItem(item.id));
    }
  }

  function updateItem(item) {
    const el = document.getElementById(`item-${item.id}`);
    if (!el) return;
    el.innerHTML = buildItemHtml(item);

    const removeBtn = el.querySelector(".remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeItem(item.id));
    }
  }

  function buildItemHtml(item) {
    const isPending = item.status === "pending";
    const isDownloading = item.status === "downloading";
    const isCompleted = item.status === "completed";
    const isError = item.status === "error";
    const isExpired = item.status === "expired";
    const isTerminal = isCompleted || isError || isExpired;

    const titleDisplay = item.title
      ? escapeHtml(item.title)
      : `<span class="pending-title">${isPending ? "—" : "…"}</span>`;

    const urlDisplay = escapeHtml(item.url);

    let tagsHtml = "";
    if (item.mode) {
      tagsHtml += `<span class="item-tag mode-tag">${escapeHtml(item.mode.toUpperCase())}</span>`;
    }
    if (item.quality && item.quality !== "" && item.mode !== "mp4") {
      tagsHtml += `<span class="item-tag quality-tag">${escapeHtml(item.quality)} kbps</span>`;
    }
    if (item.trim_start || item.trim_end) {
      const trimLabel = (item.trim_start || "00:00") + " → " + (item.trim_end || "end");
      tagsHtml += `<span class="item-tag trim-tag">✂ ${escapeHtml(trimLabel)}</span>`;
    }
    if (tagsHtml) {
      tagsHtml = `<div class="item-tags">${tagsHtml}</div>`;
    }

    const badge = `<span class="status-badge ${item.status}">${statusLabel(item.status)}</span>`;

    let progressHtml = "";
    if (isDownloading || isCompleted || isError) {
      const pct = Math.min(item.progress, 100);
      const fillClass = isCompleted ? "completed" : isError ? "error" : "";
      progressHtml = `
        <div class="progress-wrapper">
          <div class="progress-track">
            <div class="progress-fill ${fillClass}" style="width:${pct}%"></div>
          </div>
          <span class="progress-pct">${pct}%</span>
        </div>`;
    }

    let actionsHtml = "";
    if (isCompleted && item.filename) {
      actionsHtml += `<a href="/api/downloads/${encodeURIComponent(item.filename)}" class="download-btn" download>Download ${item.mode === "mp4" ? "MP4" : "MP3"}</a>`;
    }
    actionsHtml += `<button class="btn-icon remove-btn" title="Remove" ${isDownloading ? "disabled" : ""}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;

    let errorHtml = "";
    if (isError && item.error) {
      const errText = escapeHtml(item.error);
      if (item.error.length > 120) {
        const truncated = escapeHtml(item.error.slice(0, 120));
        errorHtml = `<div class="item-error"><span class="error-short">${truncated}…</span> <span class="error-toggle" data-full="${errText}">[show more]</span></div>`;
      } else {
        errorHtml = `<div class="item-error">${errText}</div>`;
      }
    }

    let expiredHtml = "";
    if (isExpired) {
      expiredHtml = `<div class="expired-msg">File expired — re-add to download again</div>`;
    }

    return `
      <div class="item-main">
        <div class="item-info">
          <div class="item-title">${titleDisplay}</div>
          <div class="item-url">${urlDisplay}</div>
          ${tagsHtml}
          <div class="item-status-row">${badge}</div>
          ${progressHtml}
          ${errorHtml}
          ${expiredHtml}
        </div>
        <div class="item-actions">${actionsHtml}</div>
      </div>`;
  }

  // --- Footer ---

  function updateFooter() {
    const pending = currentItems.filter((i) => i.status === "pending").length;
    const downloading = currentItems.filter((i) => i.status === "downloading").length;
    const completed = currentItems.filter((i) => i.status === "completed").length;
    const errors = currentItems.filter((i) => i.status === "error").length;

    const parts = [];
    if (completed) parts.push(`${completed} completed`);
    if (downloading) parts.push(`${downloading} downloading`);
    if (pending) parts.push(`${pending} pending`);
    if (errors) parts.push(`${errors} errors`);
    counterText.textContent = parts.join(" · ") || "0 completed";

    downloadAllBtn.disabled = completed === 0;
  }

  // --- Polling ---

  function startPolling() {
    if (polling) return;
    polling = true;
    poll();
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function poll() {
    if (!polling) return;
    refreshQueue().then(() => {
      const allTerminal = currentItems.length > 0 && currentItems.every(
        (i) => i.status === "completed" || i.status === "error" || i.status === "expired"
      );
      if (allTerminal) {
        stopPolling();
        return;
      }
      pollTimer = setTimeout(poll, 800);
    });
  }

  // --- Drag and drop ---

  let dragCounter = 0;

  document.body.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove("hidden");
  });

  document.body.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  document.body.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.add("hidden");
    }
  });

  document.body.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add("hidden");

    const text = e.dataTransfer.getData("text");
    if (!text) return;

    const url = text.trim();
    if (!validateUrl(url)) {
      input.classList.add("drop-error");
      showValidation("Invalid URL dropped");
      setTimeout(() => {
        input.classList.remove("drop-error");
        showValidation("");
      }, 2000);
      return;
    }

    input.value = url;
    input.classList.add("drop-highlight");
    setTimeout(() => input.classList.remove("drop-highlight"), 1000);
    fetchPreview(url);
  });

  // --- PIN handling ---

  async function checkPin() {
    if (!pinStored) {
      try {
        const resp = await fetch("/api/status");
        if (resp.status === 401) {
          pinScreen.classList.remove("hidden");
        }
      } catch {
        // server unreachable, show PIN screen anyway
        pinScreen.classList.remove("hidden");
      }
      return;
    }

    try {
      const resp = await fetch("/api/status", {
        headers: { "X-PIN": pinStored },
      });
      if (resp.status === 401) {
        sessionStorage.removeItem("yt-dl-pin");
        pinStored = "";
        pinScreen.classList.remove("hidden");
      }
    } catch {
      pinScreen.classList.remove("hidden");
    }
  }

  function addPinHeader(opt) {
    if (pinStored) {
      opt.headers = opt.headers || {};
      opt.headers["X-PIN"] = pinStored;
    }
    return opt;
  }

  const origFetch = window.fetch;
  window.fetch = function(url, opt) {
    opt = opt || {};
    addPinHeader(opt);
    return origFetch.call(window, url, opt);
  };

  pinUnlockBtn.addEventListener("click", () => {
    const pin = pinInput.value.trim();
    if (!pin) {
      pinError.textContent = "Enter a PIN";
      pinInput.classList.add("shake");
      setTimeout(() => pinInput.classList.remove("shake"), 300);
      return;
    }

    fetch("/api/status", {
      headers: { "X-PIN": pin },
    }).then((resp) => {
      if (resp.ok) {
        pinStored = pin;
        sessionStorage.setItem("yt-dl-pin", pin);
        pinScreen.classList.add("hidden");
        pinError.textContent = "";
        pinInput.value = "";
        refreshQueue();
      } else {
        pinError.textContent = "Incorrect PIN";
        pinInput.classList.add("shake");
        setTimeout(() => pinInput.classList.remove("shake"), 300);
      }
    }).catch(() => {
      pinError.textContent = "Server unreachable";
    });
  });

  pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pinUnlockBtn.click();
  });

  // --- Event listeners ---

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addUrl();
    }
  });

  addBtn.addEventListener("click", addUrl);
  downloadAllBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = "/api/download-all";
    a.download = "downloads.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  clearListBtn.addEventListener("click", clearList);
  deleteFilesBtn.addEventListener("click", deleteDownloads);

  queueList.addEventListener("click", (e) => {
    const toggle = e.target.closest(".error-toggle");
    if (!toggle) return;
    const full = toggle.dataset.full;
    const short = toggle.previousElementSibling;
    if (toggle.textContent === "[show more]") {
      short.style.display = "none";
      toggle.textContent = "[show less]";
      toggle.insertAdjacentHTML("beforebegin", `<span class="error-full">${full}</span>`);
      const fullEl = toggle.previousElementSibling;
      fullEl.style.display = "inline";
    } else {
      const fullEl = toggle.parentElement.querySelector(".error-full");
      if (fullEl) fullEl.remove();
      const shortEl = toggle.parentElement.querySelector(".error-short");
      if (shortEl) shortEl.style.display = "inline";
      toggle.textContent = "[show more]";
    }
  });

  // --- Init ---

  checkPin();

  refreshQueue().then(() => {
    if (currentItems.length > 0 && !currentItems.every(
      (i) => i.status === "completed" || i.status === "error" || i.status === "expired"
    )) {
      startPolling();
    }
  });
});
