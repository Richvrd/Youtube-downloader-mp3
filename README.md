# Youtube Downloader MP3/MP4

Web app para descargar audio (MP3) o vídeo (MP4) de YouTube.

## Requisitos

- Python 3.10+
- ffmpeg (necesario para la conversión de audio y procesamiento)

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

Pega una URL de YouTube, elige calidad y formato (MP3/MP4), y presiona "Add".  
Usa "Download MP3/MP4" para obtener el archivo individual o "Download all (ZIP)" para descargar todos los completados.

### Compartir en la red local

```bash
./run.sh --share
```

Esto expone el servidor en `0.0.0.0` y te permite opcionalmente protegerlo con un PIN.

## Funcionalidades

- **Formatos:** MP3 (128/192/320 kbps) o MP4 (mejor calidad disponible)
- **Listas de reproducción:** pega una URL de playlist y todos los vídeos se encolan automáticamente
- **Recorte de audio:** sección "Advanced options" para recortar por tiempo de inicio/fin
- **Previsualización:** al pegar una URL se muestra la info del vídeo antes de añadirlo
- **Metadatos:** los MP3 incluyen thumbnail incrustado, título y artista
- **Tema claro/oscuro:** persiste la preferencia en localStorage
- **Arrastrar y soltar:** suelta una URL de YouTube en cualquier parte de la página
- **Limpieza automática:** archivos en `.dl_cache` mayores de 60 minutos se eliminan automáticamente
- **Protección PIN:** modo compartido con PIN opcional

## Portabilidad

Copia la carpeta a un pendrive. En cualquier PC con Python y ffmpeg:

```bash
./install.sh   # 1 vez por PC
./run.sh       # cada vez que quieras usarlo
```

## Build (ejecutable portable)

```bash
./build.sh
```

Genera un binario independiente en `dist/yt-mp3-downloader` usando PyInstaller.  
No requiere Python en la máquina destino, pero **ffmpeg debe estar instalado**.

## Stack

- **Backend:** FastAPI + yt-dlp
- **Frontend:** HTML + CSS + JS vanilla
- **Descargas paralelas:** hasta 3 simultáneas con `ThreadPoolExecutor`
