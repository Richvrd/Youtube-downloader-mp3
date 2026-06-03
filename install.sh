#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "[1/4] Verificando dependencias..."
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 no encontrado. Instalalo primero."; exit 1; }

if command -v ffmpeg >/dev/null 2>&1; then
    echo "  ffmpeg: OK"
else
    echo "  [AVISO] ffmpeg no instalado. Los MP3 no podran convertirse."
    echo "          Instalalo con: sudo apt install ffmpeg"
fi

echo "[2/4] Creando entorno virtual..."
rm -rf yt-downloader-env
python3 -m venv yt-downloader-env

echo "[3/4] Instalando paquetes..."
yt-downloader-env/bin/pip install --quiet yt-dlp fastapi uvicorn

echo "[4/4] Limpiando cache..."
rm -rf .dl_cache

echo ""
echo "========================"
echo " Instalacion completa"
echo "========================"
echo ""
echo "Para arrancar:"
echo "  ./run.sh"
echo "  Abre http://localhost:8000"
