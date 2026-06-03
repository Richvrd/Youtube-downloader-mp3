import sys
import subprocess
import os
from pathlib import Path

VENV_DIR = Path(__file__).resolve().parent / "yt-downloader-env"
VENV_PYTHON = VENV_DIR / "bin" / "python3"


def download_as_mp3(url: str, output_dir: str = "downloads") -> Path | None:
    """Standalone CLI use only — not called by the web app.

    Downloads audio from a YouTube URL as MP3 using yt-dlp.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(VENV_PYTHON), "-m", "yt_dlp",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", f"{output_dir}/%(title)s.%(ext)s",
        url,
    ]

    try:
        subprocess.run(cmd, check=True)
        files = list(out_dir.glob("*.mp3"))
        if files:
            latest = max(files, key=os.path.getctime)
            return latest
        return None
    except subprocess.CalledProcessError as e:
        print(f"Error downloading {url}: {e}", file=sys.stderr)
        return None


def main():
    """Standalone CLI use only — not called by the web app.

    Parses command-line arguments and downloads each URL.
    """
    if len(sys.argv) < 2:
        print("Usage: python yt_downloader.py <youtube-url> [more-urls...]")
        sys.exit(1)

    urls = sys.argv[1:]

    for url in urls:
        print(f"Downloading: {url}")
        result = download_as_mp3(url)
        if result:
            print(f"Done: {result}")
        else:
            print(f"Failed: {url}")


if __name__ == "__main__":
    main()
