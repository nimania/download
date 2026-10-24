import page from "./index.html";

function getVideoId(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new ApiError(400, "لینک ویدئو معتبر نیست."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new ApiError(400, "فقط لینک HTTPS یوتیوب پذیرفته می‌شود.");
  const host = url.hostname.toLowerCase();
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
    else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] || "";
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new ApiError(400, "لینک باید مربوط به یک ویدئوی یوتیوب باشد.");
  return id;
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function playerInfo(id) {
  const playerUrls = [
    `https://www.youtube.com/watch?v=${id}&hl=en`,
    `https://www.youtube.com/embed/${id}?hl=en`
  ];
  let lastData = null;
  for (const playerUrl of playerUrls) {
    const response = await fetch(playerUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",
        "referer": "https://www.youtube.com/"
      },
      redirect: "follow"
    });
    if (!response.ok) continue;
    const html = await response.text();
    const marker = html.indexOf("ytInitialPlayerResponse");
    const start = marker < 0 ? -1 : html.indexOf("{", marker);
    if (start < 0) continue;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) continue;
    try { lastData = JSON.parse(html.slice(start, end)); } catch { continue; }
    if (lastData.playabilityStatus?.status === "OK" && captionTracks(lastData).length) return lastData;
  }
  if (lastData?.playabilityStatus?.status && lastData.playabilityStatus.status !== "OK")
    throw new ApiError(422, "این ویدئو برای دریافت زیرنویس در دسترس نیست.");
  if (lastData) return lastData;
  throw new ApiError(502, "یوتیوب اطلاعات ویدئو را برنگرداند. کمی بعد دوباره تلاش کن.");
}

function captionTracks(data) {
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  return tracks.map(track => ({
    language: track.languageCode || "",
    label: track.name?.simpleText || track.name?.runs?.map(run => run.text).join("") || track.languageCode || "زبان نامشخص",
    kind: track.kind === "asr" || String(track.vssId || "").startsWith(".") ? "automatic" : "manual",
    baseUrl: track.baseUrl
  })).filter(track => track.language && track.baseUrl);
}

async function legacyCaptionTracks(id) {
  for (const endpoint of ["https://www.youtube.com/api/timedtext", "https://video.google.com/timedtext"]) {
    const listUrl = new URL(endpoint);
    listUrl.searchParams.set("type", "list");
    listUrl.searchParams.set("v", id);
    try {
      const response = await fetch(listUrl, { headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
        "referer": "https://www.youtube.com/"
      }});
      if (!response.ok) continue;
      const xml = await response.text();
      const tracks = [];
      for (const match of xml.matchAll(/<track\b([^>]*)\/?\s*>/gi)) {
        const attrs = {};
        for (const item of match[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[item[1]] = item[2];
        const language = attrs.lang_code;
        if (!language) continue;
        const kind = attrs.kind === "asr" ? "automatic" : "manual";
        const captionUrl = new URL(endpoint);
        captionUrl.searchParams.set("v", id);
        captionUrl.searchParams.set("lang", language);
        if (attrs.name) captionUrl.searchParams.set("name", attrs.name);
        if (kind === "automatic") captionUrl.searchParams.set("kind", "asr");
        tracks.push({
          language,
          label: attrs.lang_translated || attrs.lang_original || language,
          kind,
          baseUrl: captionUrl.href
        });
      }
      if (tracks.length) return tracks;
    } catch { /* Try the other public YouTube timed-text endpoint. */ }
  }
  return [];
}

async function inspect(raw) {
  const id = getVideoId(raw);
  let data = null, playerError = null;
  try { data = await playerInfo(id); } catch (error) { playerError = error; }
  let tracks = data ? captionTracks(data) : [];
  if (!tracks.length) tracks = await legacyCaptionTracks(id);
  if (!tracks.length) {
    if (playerError) throw playerError;
    if (data?.playabilityStatus?.status && data.playabilityStatus.status !== "OK")
      throw new ApiError(422, "این ویدئو برای دریافت زیرنویس در دسترس نیست.");
    throw new ApiError(404, "برای این ویدئو زیرنویسی در دسترس نیست.");
  }
  return { id, title: data?.videoDetails?.title || "ویدئوی یوتیوب", tracks };
}

function cleanCaptionText(text) {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function timecode(ms) {
  const value = Math.max(0, Number(ms) || 0);
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value % 3600000 / 60000);
  const seconds = Math.floor(value % 60000 / 1000);
  const millis = Math.floor(value % 1000);
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${String(millis).padStart(3,"0")}`;
}
function cuesFromJson3(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new ApiError(502, "قالب زیرنویس یوتیوب قابل‌خواندن نیست."); }
  return (data.events || []).map(event => {
    const text = cleanCaptionText((event.segs || []).map(segment => segment.utf8 || "").join("")).trim();
    if (!text || event.tStartMs == null) return null;
    const start = Number(event.tStartMs);
    const end = start + Number(event.dDurationMs || 1500);
    return { start, end, text };
  }).filter(Boolean);
}
function makeSubtitle(cues, format) {
  if (format === "txt") return [...new Set(cues.map(cue => cue.text.replace(/\s+/g, " ").trim()))].join("\n") + "\n";
  if (format === "vtt") return "WEBVTT\n\n" + cues.map(cue => `${timecode(cue.start)} --> ${timecode(cue.end)}\n${cue.text}`).join("\n\n") + "\n";
  return cues.map((cue, index) => `${index + 1}\n${timecode(cue.start).replace(".", ",")} --> ${timecode(cue.end).replace(".", ",")}\n${cue.text}`).join("\n\n") + "\n";
}

async function handleApi(request, pathname) {
  try {
    if (request.method !== "POST") return Response.json({ detail: "Method not allowed" }, { status: 405 });
    let body;
    try { body = await request.json(); } catch { throw new ApiError(400, "درخواست قابل‌خواندن نیست."); }
    if (typeof body.url !== "string" || body.url.length > 2048) throw new ApiError(400, "لینک ویدئو را وارد کن.");
    const result = await inspect(body.url);
    if (pathname === "/api/inspect") {
      return Response.json({ title: result.title, tracks: result.tracks.map(({ language, label, kind }) => ({ language, label, kind })) });
    }
    const { language, kind, format } = body;
    if (typeof language !== "string" || !["manual", "automatic"].includes(kind) || !["txt", "srt", "vtt"].includes(format))
      throw new ApiError(400, "زبان و قالب زیرنویس را انتخاب کن.");
    const track = result.tracks.find(item => item.language === language && item.kind === kind);
    if (!track) throw new ApiError(404, "این زبان یا نوع زیرنویس دیگر در دسترس نیست.");
    const captionUrl = new URL(track.baseUrl);
    if (captionUrl.protocol !== "https:" || !["youtube.com", "www.youtube.com", "video.google.com"].includes(captionUrl.hostname))
      throw new ApiError(502, "نشانی زیرنویس یوتیوب نامعتبر است.");
    captionUrl.searchParams.set("fmt", "json3");
    const response = await fetch(captionUrl, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36", "referer": "https://www.youtube.com/" } });
    if (!response.ok) throw new ApiError(502, "یوتیوب نتوانست فایل زیرنویس را برگرداند.");
    const raw = await response.text();
    if (raw.length > 4_000_000) throw new ApiError(413, "فایل زیرنویس بیش از اندازه بزرگ است.");
    const cues = cuesFromJson3(raw);
    if (!cues.length) throw new ApiError(404, "متن زیرنویس خالی است یا برای این ویدئو در دسترس نیست.");
    const output = makeSubtitle(cues, format);
    const safeLanguage = language.replace(/[^a-zA-Z0-9_-]/g, "-");
    return new Response(output, { headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="subtitles-${safeLanguage}.${format}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }});
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502;
    return Response.json({ detail: error instanceof ApiError ? error.message : "ارتباط با یوتیوب ناموفق بود. کمی بعد دوباره تلاش کن." }, { status });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return Response.json({ ok: true, runtime: "cloudflare-workers" });
    if (url.pathname === "/api/inspect" || url.pathname === "/api/download") return handleApi(request, url.pathname);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : page, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'" }
    });
  }
};
