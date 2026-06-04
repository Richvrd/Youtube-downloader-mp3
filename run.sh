#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -f yt-downloader-env/bin/uvicorn ]; then
    echo "El entorno virtual no existe. Ejecuta primero:"
    echo "  ./install.sh"
    exit 1
fi

HOST="127.0.0.1"
PIN=""

if [ "$1" = "--share" ]; then
    HOST="0.0.0.0"
    echo "Modo compartido activado."
    echo "Introduce un PIN para proteger el acceso (o presiona Enter para dejarlo abierto):"
    read -r PIN
    export YT_DL_PIN="$PIN"

    LOCAL_IP=$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[\d.]+' | grep -v '127.0.0.1' | head -1 || echo "")
    if [ -z "$LOCAL_IP" ]; then
        LOCAL_IP="<your-local-ip>"
    fi

    echo ""
    echo "Comparte esta direccion con otros dispositivos en la red:"
    echo "  http://$LOCAL_IP:8000"
    echo ""
fi

export YT_DL_HOST="$HOST"

if [ -n "$PIN" ]; then
    echo "PIN protection: ON"
else
    echo "PIN protection: OFF"
fi

echo "Listening on http://$HOST:8000"
yt-downloader-env/bin/uvicorn web_app:app --host "$HOST" --port 8000
