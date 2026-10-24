# Subtitle Studio

A Persian right-to-left subtitle tool. Paste a public YouTube video link, choose an available caption track, and download it as TXT, SRT, or VTT. You can also convert an existing SRT/VTT file locally in your browser.

## Cloudflare Workers

The public Worker serves the interface and reads YouTube's publicly available caption tracks. It does not download video files. Private, age-restricted, blocked, or captionless videos may not work; YouTube may also rate-limit automated requests.

Deploy the Worker from this repository with the Cloudflare Workers build settings:

- Deploy command: `npx wrangler deploy`
- Main entry: `worker.js`
- Free Workers plan

## Run the Python version locally or on a Python host

Requires Python 3.12+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://localhost:8000. The Python version uses FastAPI and yt-dlp to inspect caption tracks and retrieve captions without downloading the video.

## Docker

```bash
docker build -t subtitle-studio .
docker run --rm -p 8000:8000 subtitle-studio
```

## Limitations

Only public caption tracks are supported. No DRM bypass, login bypass, video download, or speech-to-text is provided. The Worker fetches YouTube pages and caption data, so platform rate limits or changes to YouTube's page format can temporarily prevent extraction.
