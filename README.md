# Subtitle Studio

A Persian RTL web application for downloading publicly available subtitles from YouTube and Vimeo. Built with FastAPI and yt-dlp.

## Features

- Inspect manually provided and auto-generated caption tracks.
- Download as TXT, SRT, or VTT.
- Responsive RTL interface.
- No DRM bypass, login bypass, or speech-to-text in the MVP.

## Run locally

Requires Python 3.12+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://localhost:8000.

## Docker

```bash
docker build -t subtitle-studio .
docker run --rm -p 8000:8000 subtitle-studio
```

Open http://localhost:8000.

## Deployment

This application requires a Python-capable host (for example, Render, Railway, or a VPS). **GitHub Pages alone cannot execute FastAPI**. Set the start command to:

```bash
uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
```

The root route provides the web interface; `/api/health` is a health-check endpoint.

## Limitations and safety

Video platforms can block or rate-limit subtitle retrieval. Only publicly available caption tracks are supported. YouTube/Vimeo caption URLs are restricted to approved hosts, but production deployment additionally needs DNS/IP-level egress protection, per-IP request limits, concurrency limits, observability, caching, and testing with real videos.

REA (morluto/rea) is a separate reverse-engineering analysis tool, not an extraction dependency. Use it only where useful for examining observable web behavior.

## Project status

MVP source code committed to the `main` branch. Live functional tests and public deployment are pending.
