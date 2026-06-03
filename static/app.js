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

  let currentItems = [];
  let polling = false;
  let pollTimer = null;
  let itemsCache = {};

  const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com"];

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

  function statusLabel(status) {
    return status === "downloading" ? "DOWNLOADING"
         : status === "completed" ? "DONE"
         : status === "error" ? "ERROR"
         : "PENDING";
  }

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
    showValidation("");
    addBtn.disabled = true;
    addBtn.textContent = "Adding…";

    try {
      const resp = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        showValidation(data.detail || "Failed to add URL");
        addBtn.disabled = false;
        addBtn.textContent = "Add";
        return;
      }
      input.value = "";
      startPolling();
      await refreshQueue();
    } catch (e) {
      showValidation("Network error — check server");
    }

    addBtn.disabled = false;
    addBtn.textContent = "Add";
  }

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

  function renderDiff() {
    const newIds = new Set(currentItems.map((i) => i.id));

    for (const id of Object.keys(itemsCache)) {
      if (!newIds.has(id)) {
        const el = document.getElementById(`item-${id}`);
        if (el) el.remove();
        delete itemsCache[id];
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
        || a.error !== b.error;
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
    const isTerminal = isCompleted || isError;

    const titleDisplay = item.title
      ? escapeHtml(item.title)
      : `<span class="pending-title">${isPending ? "—" : "…"}</span>`;

    const urlDisplay = escapeHtml(item.url);

    const badge = `<span class="status-badge ${item.status}">${statusLabel(item.status)}</span>`;

    let progressHtml = "";
    if (isDownloading || isTerminal) {
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
      actionsHtml += `<a href="/api/downloads/${encodeURIComponent(item.filename)}" class="download-btn" download>Download MP3</a>`;
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

    return `
      <div class="item-main">
        <div class="item-info">
          <div class="item-title">${titleDisplay}</div>
          <div class="item-url">${urlDisplay}</div>
          <div class="item-status-row">
            ${badge}
          </div>
          ${progressHtml}
          ${errorHtml}
        </div>
        <div class="item-actions">${actionsHtml}</div>
      </div>`;
  }

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
        (i) => i.status === "completed" || i.status === "error"
      );
      if (allTerminal) {
        stopPolling();
        return;
      }
      pollTimer = setTimeout(poll, 800);
    });
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addUrl();
    }
  });

  input.addEventListener("input", () => showValidation(""));

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

  refreshQueue().then(() => {
    if (currentItems.length > 0 && !currentItems.every((i) => i.status === "completed" || i.status === "error")) {
      startPolling();
    }
  });
});
