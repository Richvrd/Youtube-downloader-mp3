import sys
import os
import io
import re
import json
import uuid
import time
import zipfile
import logging
import subprocess
import threading
import unicodedata
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from concurrent.futures import ThreadPoolExecutor
from enum import Enum
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
DOWNLOADS_DIR = BASE_DIR / ".dl_cache"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(BASE_DIR))
from yt_downloader import VENV_PYTHON

logger = logging.getLogger("ytd")
logging.basicConfig(level=logging.INFO, format="%(message)s")


class DownloadStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    ERROR = "error"
    EXPIRED = "expired"


class AddRequest(BaseModel):
    url: str
    quality: str = "192"
    trim_start: str = ""
    trim_end: str = ""
    mode: str = "mp3"


class DownloadItem(BaseModel):
    id: str
    url: str
    title: str = ""
    status: DownloadStatus = DownloadStatus.PENDING
    progress: int = 0
    filename: str = ""
    error: str = ""
    quality: str = "192"
    trim_start: str = ""
    trim_end: str = ""
    mode: str = "mp3"
    playlist_id: str = ""


downloads: dict[str, DownloadItem] = {}
lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=3)

PROGRESS_RE = re.compile(r"\[download\]\s+(\d+\.?\d*)%")
ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com"}
VALID_QUALITIES = {"128", "192", "320"}
MAX_FILE_AGE_MINUTES = int(os.environ.get("YT_DL_MAX_AGE_MINUTES", "60"))
YT_DL_PIN = os.environ.get("YT_DL_PIN", "")


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


def parse_timecode(tc: str) -> int | None:
    """Convert MM:SS or HH:MM:SS to total seconds. Returns None if invalid."""
    parts = tc.strip().split(":")
    if len(parts) == 2:
        try:
            return int(parts[0]) * 60 + int(parts[1])
        except ValueError:
            return None
    elif len(parts) == 3:
        try:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except ValueError:
            return None
    return None


def detect_playlist(url: str) -> bool:
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    return "list" in qs


def extract_playlist_items(url: str) -> list[dict]:
    cmd = [
        str(VENV_PYTHON), "-m", "yt_dlp",
        "--flat-playlist", "--dump-json",
        "--no-download",
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return []
        items = []
        for line in result.stdout.strip().split("\n"):
            if line:
                data = json.loads(line)
                items.append(data)
        return items
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception):
        return []


def _run_ytdlp(url: str, item_id: str, quality: str = "192",
               trim_start: str = "", trim_end: str = "",
               mode: str = "mp3") -> tuple[Path, str]:
    tmp_dir = DOWNLOADS_DIR / f".tmp_{item_id}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    ext = "mp4" if mode == "mp4" else "mp3"
    cmd = [str(VENV_PYTHON), "-m", "yt_dlp"]

    if mode == "mp4":
        cmd.extend([
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        ])
    else:
        cmd.extend([
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", quality,
        ])

    if trim_start or trim_end:
        section = "*"
        if trim_start:
            section += trim_start
        section += "-"
        if trim_end:
            section += trim_end
        cmd.extend(["--download-sections", section])

    cmd.extend([
        "--print", "title",
        "--no-simulate",
        "-o", f"{tmp_dir}/%(title)s.%(ext)s",
        url,
    ])

    if mode == "mp3":
        cmd.extend([
            "--embed-thumbnail",
            "--add-metadata",
            "--metadata-from-title", "%(artist)s - %(title)s",
        ])

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

    files = sorted(tmp_dir.glob(f"*.{ext}"), key=os.path.getctime)
    if not files:
        files = sorted(tmp_dir.glob("*"), key=os.path.getctime)
    if not files:
        raise RuntimeError(f"No {ext} file found")

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


def download_worker(item_id: str, quality: str = "192",
                    trim_start: str = "", trim_end: str = "",
                    mode: str = "mp3"):
    with lock:
        item = downloads[item_id]
        item.status = DownloadStatus.DOWNLOADING

    try:
        mp3_path, title = _run_ytdlp(
            item.url, item_id,
            quality=quality,
            trim_start=trim_start,
            trim_end=trim_end,
            mode=mode,
        )
        with lock:
            item = downloads[item_id]
            item.title = title
            item.filename = mp3_path.name
            item.progress = 100
            item.status = DownloadStatus.COMPLETED
    except Exception as e:
        with lock:
            item = downloads[item_id]
            item.status = DownloadStatus.ERROR
            item.error = str(e)[:300]


def add_to_queue(url: str, quality: str = "192",
                 trim_start: str = "", trim_end: str = "",
                 mode: str = "mp3",
                 title: str = "", playlist_id: str = "") -> DownloadItem:
    item_id = uuid.uuid4().hex[:8]
    item = DownloadItem(
        id=item_id, url=url, quality=quality,
        trim_start=trim_start, trim_end=trim_end,
        mode=mode, title=title, playlist_id=playlist_id,
    )
    with lock:
        downloads[item_id] = item
    executor.submit(download_worker, item_id, quality, trim_start, trim_end, mode)
    return item


app = FastAPI(title="YouTube MP3 Downloader")


# --- PIN Middleware ---

@app.middleware("http")
async def pin_middleware(request: Request, call_next):
    if not YT_DL_PIN:
        return await call_next(request)

    path = request.url.path
    if path == "/" or path.startswith("/static"):
        return await call_next(request)

    if path.startswith("/api/"):
        pin = request.headers.get("X-PIN", "") or request.query_params.get("pin", "")
        if pin != YT_DL_PIN:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Invalid PIN"})

    return await call_next(request)


# --- Auto-cleanup Background Task ---

def cleanup_loop():
    while True:
        time.sleep(300)
        now = time.time()
        cutoff = now - MAX_FILE_AGE_MINUTES * 60
        for f in DOWNLOADS_DIR.iterdir():
            if f.name.startswith("."):
                continue
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
                logger.info("[cleanup] Deleted expired file: %s", f.name)
                with lock:
                    for item in downloads.values():
                        if item.filename == f.name and item.status in (
                            DownloadStatus.COMPLETED, DownloadStatus.ERROR
                        ):
                            item.status = DownloadStatus.EXPIRED
                            break

cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
cleanup_thread.start()


# --- Endpoints ---

@app.post("/api/add")
async def add_url(req: AddRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(400, "URL is empty")
    if not validate_youtube_url(url):
        raise HTTPException(400, "Invalid or unsupported URL. Only YouTube links are accepted.")
    if req.quality not in VALID_QUALITIES:
        raise HTTPException(400, "Quality must be one of: 128, 192, 320")
    if req.mode not in ("mp3", "mp4"):
        raise HTTPException(400, "Mode must be mp3 or mp4")
    if req.trim_start:
        if parse_timecode(req.trim_start) is None:
            raise HTTPException(400, "Invalid trim_start format. Use MM:SS or HH:MM:SS.")
    if req.trim_end:
        if parse_timecode(req.trim_end) is None:
            raise HTTPException(400, "Invalid trim_end format. Use MM:SS or HH:MM:SS.")

    if detect_playlist(url):
        items = extract_playlist_items(url)
        if items:
            results = []
            pl_id = uuid.uuid4().hex[:8]
            for entry in items:
                vurl = entry.get("webpage_url") or entry.get("url") or ""
                vtitle = entry.get("title", "")
                if vurl:
                    item = add_to_queue(
                        vurl, quality=req.quality,
                        trim_start=req.trim_start, trim_end=req.trim_end,
                        mode=req.mode, title=vtitle, playlist_id=pl_id,
                    )
                    results.append(item)
            return {"playlist": True, "count": len(results), "items": results}

    item = add_to_queue(
        url, quality=req.quality,
        trim_start=req.trim_start, trim_end=req.trim_end,
        mode=req.mode,
    )
    return item


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
    for f in DOWNLOADS_DIR.glob("*.mp4"):
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


@app.get("/api/preview")
async def preview(url: str = ""):
    if not url or not validate_youtube_url(url):
        raise HTTPException(400, "Invalid or unsupported YouTube URL")

    cmd = [
        str(VENV_PYTHON), "-m", "yt_dlp",
        "--dump-json", "--no-download",
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[:200])
        data = json.loads(result.stdout.strip().split("\n")[0])

        resp = {
            "title": data.get("title", ""),
            "duration": data.get("duration", 0),
            "thumbnail": data.get("thumbnail", ""),
            "channel": data.get("channel", "") or data.get("uploader", ""),
            "view_count": data.get("view_count", 0),
        }

        if detect_playlist(url):
            resp["is_playlist"] = True
            qs = parse_qs(urlparse(url).query)
            playlist_id = qs.get("list", [""])[0]
            count_cmd = [
                str(VENV_PYTHON), "-m", "yt_dlp",
                "--flat-playlist", "--dump-json",
                "--no-download", "--playlist-end", "1",
                url,
            ]
            try:
                count_result = subprocess.run(
                    count_cmd, capture_output=True, text=True, timeout=10
                )
                if count_result.returncode == 0:
                    lines = count_result.stdout.strip().split("\n")
                    resp["playlist_count"] = len(lines)
            except Exception:
                pass

        return resp

    except subprocess.TimeoutExpired:
        raise HTTPException(404, "Video info fetch timed out. Check the URL.")
    except Exception as e:
        raise HTTPException(404, f"Could not load video info: {str(e)[:100]}")


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
    ext = Path(filename).suffix.lower()
    mime = "video/mp4" if ext == ".mp4" else "audio/mpeg"
    return FileResponse(
        file_path,
        media_type=mime,
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
