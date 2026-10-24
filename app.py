import html
import json
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Subtitle Studio")

class VideoRequest(BaseModel):
    url: str = Field(max_length=2048)

class DownloadRequest(VideoRequest):
    language: str = Field(max_length=100)
    kind: str = Field(pattern="^(manual|automatic)$")
    format: str = Field(pattern="^(srt|vtt|txt)$")

def allowed(host, domains):
    return bool(host and any(host == d or host.endswith("." + d) for d in domains))

def validate(url):
    p = urlparse(url)
    if p.scheme != "https" or p.username or p.password or not allowed(p.hostname, ("youtube.com", "youtu.be", "vimeo.com")):
        raise HTTPException(400, "Only public HTTPS YouTube and Vimeo video links are supported")

def extract(url):
    validate(url)
    opts = {"skip_download": True, "quiet": True, "no_warnings": True, "socket_timeout": 12,
            "retries": 1, "noplaylist": True, "extract_flat": False}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        raise HTTPException(422, "Unable to inspect the video or access its captions")
    if not isinstance(info, dict) or info.get("_type") == "playlist":
        raise HTTPException(422, "Please provide one video")
    return info

def tracks(info):
    result = []
    for kind, key in (("manual", "subtitles"), ("automatic", "automatic_captions")):
        for lang, variants in (info.get(key) or {}).items():
            if isinstance(variants, list) and any(x.get("ext") in ("vtt", "srt", "json3") and x.get("url") for x in variants):
                result.append({"language": lang, "kind": kind})
    return sorted(result, key=lambda x: (x["language"], x["kind"]))

@app.get("/", response_class=HTMLResponse)
def home():
    return Path(__file__).with_name("index.html").read_text(encoding="utf-8")

@app.get("/api/health")
def health():
    return {"ok": True}

@app.post("/api/inspect")
def inspect(req: VideoRequest):
    info = extract(req.url)
    return {"title": info.get("title"), "duration": info.get("duration"), "tracks": tracks(info)}

def stamp(ms):
    h, rest = divmod(ms, 3600000)
    m, rest = divmod(rest, 60000)
    s, milli = divmod(rest, 1000)
    return f"{h:02}:{m:02}:{s:02}.{milli:03}"

def to_vtt(raw, ext):
    if ext == "vtt":
        return raw
    if ext == "srt":
        return "WEBVTT\n\n" + re.sub(r"(?m)^\d+\s*\n", "", raw).replace(",", ".")
    if ext == "json3":
        events = json.loads(raw).get("events", [])
        rows = ["WEBVTT", ""]
        for event in events:
            start = event.get("tStartMs", 0)
            end = start + event.get("dDurationMs", 1000)
            value = "".join(x.get("utf8", "") for x in event.get("segs", [])).strip()
            if value:
                rows.extend([f"{stamp(start)} --> {stamp(end)}", value, ""])
        return "\n".join(rows)
    raise ValueError("Unsupported format")

def cues(vtt):
    output = []
    for block in re.split(r"\n\s*\n", vtt.replace("\r", "")):
        lines = block.strip().splitlines()
        index = next((i for i, line in enumerate(lines) if "-->" in line), -1)
        if index < 0:
            continue
        match = re.match(r"\s*(\d\d:\d\d:\d\d[.,]\d+)\s*-->\s*(\d\d:\d\d:\d\d[.,]\d+)", lines[index])
        if not match:
            continue
        body = html.unescape(re.sub(r"<[^>]+>", "", "\n".join(lines[index + 1:]))).strip()
        if body:
            output.append((match.group(1).replace(".", ","), match.group(2).replace(".", ","), body))
    return output

@app.post("/api/download")
async def download(req: DownloadRequest):
    info = extract(req.url)
    key = "subtitles" if req.kind == "manual" else "automatic_captions"
    variants = (info.get(key) or {}).get(req.language, [])
    choice = next((item for ext in ("vtt", "srt", "json3") for item in variants
                   if item.get("ext") == ext and item.get("url")), None)
    if not choice:
        raise HTTPException(404, "Requested captions are unavailable")
    target = choice["url"]
    parsed = urlparse(target)
    if parsed.scheme != "https" or parsed.username or parsed.password or not allowed(parsed.hostname,
          ("googlevideo.com", "youtube.com", "vimeo.com", "vimeocdn.com", "akamaized.net")):
        raise HTTPException(422, "Unsupported caption host")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.get(target)
            response.raise_for_status()
            if len(response.content) > 4_000_000:
                raise ValueError("Subtitle file is too large")
            raw = response.text
        vtt = to_vtt(raw, choice["ext"])
    except Exception:
        raise HTTPException(502, "Unable to retrieve caption file")
    if req.format == "vtt":
        output = vtt
    else:
        items = cues(vtt)
        if req.format == "txt":
            output = "\n".join(dict.fromkeys(body.replace("\n", " ") for _, _, body in items))
        else:
            output = "\n\n".join(f"{i}\n{a} --> {b}\n{body}" for i, (a, b, body) in enumerate(items, 1)) + "\n"
    lang = re.sub(r"[^a-zA-Z0-9_-]", "-", req.language)
    return PlainTextResponse(output, headers={"Content-Disposition": f'attachment; filename="subtitles-{lang}.{req.format}"'})
