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

`install.sh` crea un entorno virtual e instala las dependencias listadas en `requirements.txt`.

## Uso

```bash
./run.sh
# Abrir http://localhost:8000
```

Pega una URL de YouTube, presiona "Add" y espera a que la descarga termine.  
Usa "Download MP3" para obtener el archivo individual o "Download all (ZIP)" para descargar todos los completados.

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
