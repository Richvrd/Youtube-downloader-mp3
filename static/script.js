document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('urls-input');
    const addBtn = document.getElementById('add-btn');
    const tbody = document.getElementById('queue-body');
    const empty = document.getElementById('empty-msg');
    const urlCount = document.getElementById('url-count');
    const statsPending = document.getElementById('stats-pending');
    const statsDownloading = document.getElementById('stats-downloading');
    const statsCompleted = document.getElementById('stats-completed');
    const statsErrors = document.getElementById('stats-errors');
    const downloadAll = document.getElementById('download-all');
    const clearBtn = document.getElementById('clear-btn');

    input.addEventListener('input', updateUrlCount);

    function updateUrlCount() {
        const count = input.value.trim() ? input.value.trim().split('\n').filter(u => u.trim()).length : 0;
        urlCount.textContent = count > 0 ? `${count} URL${count !== 1 ? 's' : ''}` : '';
    }

    async function addUrls() {
        const urls = input.value.trim().split('\n').filter(u => u.trim());
        if (urls.length === 0) return;

        addBtn.disabled = true;
        addBtn.textContent = 'Agregando...';

        for (const url of urls) {
            try {
                await fetch('/api/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url.trim() })
                });
            } catch (e) {
                console.error('Error adding URL:', e);
            }
        }

        input.value = '';
        updateUrlCount();
        addBtn.disabled = false;
        addBtn.textContent = 'Agregar';
        await refreshQueue();
    }

    async function clearList() {
        if (tbody.children.length === 0) return;
        try {
            await fetch('/api/queue', { method: 'DELETE' });
            await refreshQueue();
        } catch (e) {
            console.error('Error clearing queue:', e);
        }
    }

    async function refreshQueue() {
        try {
            const resp = await fetch('/api/queue');
            const items = await resp.json();
            renderTable(items);
            updateStats(items);
        } catch (e) {
            console.error('Error fetching queue:', e);
        }
    }

    function renderTable(items) {
        if (items.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            downloadAll.style.display = 'none';
            clearBtn.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        clearBtn.style.display = 'inline-flex';

        tbody.innerHTML = items.map((item, i) => {
            const title = item.title || '';
            const isComplete = item.status === 'completed';
            const isDownloading = item.status === 'downloading';
            const isError = item.status === 'error';
            const isPending = item.status === 'pending';

            let statusCell;
            if (isDownloading) {
                statusCell = `
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${item.progress}%"></div>
                        <span class="progress-text">${item.progress}%</span>
                    </div>
                `;
            } else {
                statusCell = `<span class="badge badge-${item.status}">${statusLabel(item.status)}</span>`;
            }

            return `
                <tr class="row-${item.status}">
                    <td class="col-num">${i + 1}</td>
                    <td class="col-title">
                        ${title ? `<div class="name-text">${escapeHtml(title)}</div>` : ''}
                        <div class="url-text">${escapeHtml(isComplete ? '' : item.url)}</div>
                        ${isError && item.error ? `<div class="error-msg">${escapeHtml(item.error)}</div>` : ''}
                    </td>
                    <td class="col-status">${statusCell}</td>
                    <td class="col-action">
                        ${isComplete ? `<a href="/api/downloads/${encodeURIComponent(item.filename)}" class="download-link" download>Descargar</a>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        const hasCompleted = items.some(i => i.status === 'completed');
        downloadAll.style.display = hasCompleted ? 'inline-block' : 'none';
    }

    function updateStats(items) {
        const pending = items.filter(i => i.status === 'pending').length;
        const downloading = items.filter(i => i.status === 'downloading').length;
        const completed = items.filter(i => i.status === 'completed').length;
        const errors = items.filter(i => i.status === 'error').length;

        statsPending.textContent = pending;
        statsDownloading.textContent = downloading;
        statsCompleted.textContent = completed;
        statsErrors.textContent = errors;
    }

    function statusLabel(status) {
        const labels = {
            pending: 'Pendiente',
            downloading: 'Descargando...',
            completed: 'Listo',
            error: 'Error'
        };
        return labels[status] || status;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    addBtn.addEventListener('click', addUrls);
    clearBtn.addEventListener('click', clearList);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            addUrls();
        }
    });

    downloadAll.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = '/api/download-all';
        a.download = 'descargas.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    updateUrlCount();
    refreshQueue();
    setInterval(refreshQueue, 2000);
});
