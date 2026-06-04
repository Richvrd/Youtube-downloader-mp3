#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -f yt-downloader-env/bin/pyinstaller ]; then
    echo "PyInstaller no encontrado. Instalando..."
    yt-downloader-env/bin/pip install pyinstaller
fi

echo "[1/3] Limpiando builds anteriores..."
rm -rf build dist *.spec

echo "[2/3] Ejecutando PyInstaller..."
yt-downloader-env/bin/pyinstaller \
    --onefile \
    --add-data "static:static" \
    --name "yt-mp3-downloader" \
    web_app.py

echo "[3/3] Copiando binario a dist/..."
mkdir -p dist
mv dist/yt-mp3-downloader dist/yt-mp3-downloader 2>/dev/null || true

echo ""
echo "========================"
echo " Build complete"
echo "========================"
echo ""
echo "Binary ready at: dist/yt-mp3-downloader"
echo ""
echo "Run it directly — no Python needed:"
echo "  ./dist/yt-mp3-downloader"
echo ""
echo "Note: ffmpeg must still be installed on the target machine."
echo ""
