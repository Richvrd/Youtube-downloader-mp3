#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -f yt-downloader-env/bin/uvicorn ]; then
    echo "El entorno virtual no existe. Ejecuta primero:"
    echo "  ./install.sh"
    exit 1
fi

echo "Arrancando servidor en http://localhost:8000"
yt-downloader-env/bin/uvicorn web_app:app --host 0.0.0.0 --port 8000
