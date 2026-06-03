# Youtube Downloader MP3

App web para descargar audio de videos de YouTube en formato MP3.

## Requisitos

- Python 3.10+
- ffmpeg (para conversion a MP3)

## Instalacion

```bash
git clone <repo-url>
cd Youtube-downloader-mp3
./install.sh
```

## Uso

```bash
./run.sh
# Abrir http://localhost:8000
```

Pega una o mas URLs de YouTube (una por linea) y presiona "Agregar".  
Cuando la descarga termine, haz clic en "Descargar" para obtener el MP3 individual o "Descargar todo (ZIP)" para descargar todos en un archivo comprimido.

## Portabilidad

Copia la carpeta a un pendrive. En cualquier PC con Python y ffmpeg:

```bash
./install.sh   # 1 vez por PC
./run.sh       # cada vez que quieras usarlo
```

## Stack

- **Backend:** FastAPI + yt-dlp
- **Frontend:** HTML + CSS + JS vanilla
- **Descargas paralelas:** hasta 3 simultaneas con `ThreadPoolExecutor`
