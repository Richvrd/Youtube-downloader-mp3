import sys
import os
import io
import re
import uuid
import zipfile
import subprocess
import threading
import unicodedata
from pathlib import Path
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from enum import Enum

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
DOWNLOADS_DIR = BASE_DIR / ".dl_cache"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(BASE_DIR))
from yt_downloader import VENV_PYTHON


class DownloadStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    ERROR = "error"


class AddRequest(BaseModel):
    url: str


class DownloadItem(BaseModel):
    id: str
    url: str
    title: str = ""
    status: DownloadStatus = DownloadStatus.PENDING
    progress: int = 0
    filename: str = ""
    error: str = ""


downloads: dict[str, DownloadItem] = {}
lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=3)

PROGRESS_RE = re.compile(r"\[download\]\s+(\d+\.?\d*)%")
ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com"}


def validate_youtube_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and parsed.netloc in ALLOWED_HOSTS
    except Exception:
        return False


def sanitize_filename(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    return name.strip()[:180]


def _run_ytdlp(url: str, item_id: str) -> tuple[Path, str]:
    tmp_dir = DOWNLOADS_DIR / f".tmp_{item_id}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(VENV_PYTHON), "-m", "yt_dlp",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--print", "title",
        "--no-simulate",
        "-o", f"{tmp_dir}/%(title)s.%(ext)s",
        url,
    ]

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    title = None
    stderr_lines = []

    def read_stdout():
        nonlocal title
        for line in process.stdout:
            line = line.strip()
            if line:
                title = line

    def read_stderr():
        for line in process.stderr:
            stderr_lines.append(line)
            m = PROGRESS_RE.search(line)
            if m:
                pct = int(float(m.group(1)))
                with lock:
                    if item_id in downloads:
                        downloads[item_id].progress = pct

    t1 = threading.Thread(target=read_stdout, daemon=True)
    t2 = threading.Thread(target=read_stderr, daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    process.wait()

    if process.returncode != 0:
        err = "".join(stderr_lines[-10:]).strip() or f"Error code {process.returncode}"
        raise RuntimeError(err[:300])

    if not title:
        raise RuntimeError("Could not get video title")

    files = sorted(tmp_dir.glob("*.mp3"), key=os.path.getctime)
    if not files:
        raise RuntimeError("No MP3 file found")

    mp3_path = files[-1]
    safe_name = sanitize_filename(mp3_path.name)
    dest = DOWNLOADS_DIR / safe_name
    if dest.exists():
        dest = DOWNLOADS_DIR / f"{item_id}_{safe_name}"
    mp3_path.rename(dest)

    for p in tmp_dir.iterdir():
        p.unlink()
    tmp_dir.rmdir()

    return dest, title


def download_worker(item_id: str):
    with lock:
        item = downloads[item_id]
        item.status = DownloadStatus.DOWNLOADING

    try:
        mp3_path, title = _run_ytdlp(item.url, item_id)
        with lock:
            item = downloads[item_id]
            item.title = title
            item.filename = mp3_path.name
            item.progress = 100
            item.status = DownloadStatus.COMPLETED
    except Exception as e:
        with lock:
            downloads[item_id].status = DownloadStatus.ERROR
            downloads[item_id].error = str(e)[:300]


def add_to_queue(url: str) -> DownloadItem:
    item_id = uuid.uuid4().hex[:8]
    item = DownloadItem(id=item_id, url=url)
    with lock:
        downloads[item_id] = item
    executor.submit(download_worker, item_id)
    return item


app = FastAPI(title="YouTube MP3 Downloader")


@app.post("/api/add")
async def add_url(req: AddRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(400, "URL is empty")
    if not validate_youtube_url(url):
        raise HTTPException(400, "Invalid or unsupported URL. Only YouTube links are accepted.")
    return add_to_queue(url)


@app.get("/api/queue")
async def get_queue():
    with lock:
        return list(downloads.values())


@app.delete("/api/queue")
async def clear_queue():
    removed = 0
    with lock:
        ids = list(downloads.keys())
        for k in ids:
            if downloads[k].status != DownloadStatus.DOWNLOADING:
                del downloads[k]
                removed += 1
    return {"removed": removed}


@app.delete("/api/queue/{item_id}")
async def remove_item(item_id: str):
    with lock:
        if item_id not in downloads:
            raise HTTPException(404, "Item not found")
        if downloads[item_id].status == DownloadStatus.DOWNLOADING:
            raise HTTPException(400, "Cannot remove a downloading item")
        del downloads[item_id]
    return {"removed": item_id}


@app.delete("/api/downloads")
async def delete_downloads():
    with lock:
        downloads.clear()
    for f in DOWNLOADS_DIR.glob("*.mp3"):
        f.unlink()
    for f in DOWNLOADS_DIR.glob("*.zip"):
        f.unlink()
    return {"ok": True}


@app.get("/api/status")
async def status():
    with lock:
        counts = {s.value: 0 for s in DownloadStatus}
        for item in downloads.values():
            counts[item.status.value] += 1
    return {"ok": True, "queue": counts}


@app.get("/api/download-all")
async def download_all():
    with lock:
        completed = [item for item in downloads.values()
                     if item.status == DownloadStatus.COMPLETED and item.filename]

    if not completed:
        raise HTTPException(404, "No files completed")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in completed:
            file_path = DOWNLOADS_DIR / item.filename
            if file_path.exists():
                zf.write(file_path, item.filename)

    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"downloads_{timestamp}.zip"

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@app.get("/api/downloads/{filename:path}")
async def download_file(filename: str):
    file_path = DOWNLOADS_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(
        file_path,
        media_type="audio/mpeg",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static"), html=True),
    name="static",
)


@app.get("/")
async def root():
    return FileResponse(str(BASE_DIR / "static" / "index.html"))
