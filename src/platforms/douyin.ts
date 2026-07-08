/**
 * 抖音解析模块：Detail API（a_bogus + Cookie） + 公开分享页 fallback。
 * 适配自 backend/app/douyin_fallback.py。
 */

import { signUrl } from "../a_bogus";
import type { MediaAsset, VideoInfo } from "../models";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

const WORK_ID_PATTERN = /(?:\/share)?\/(?:video|note|slides)\/(\d+)/;
const ROUTER_DATA_PATTERN = /<script>window\._ROUTER_DATA\s*=\s*(\{.*?\})<\/script>/s;

class DouyinError extends Error {}

function firstUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const urls = (value as { url_list?: string[] }).url_list;
  return Array.isArray(urls) && urls.length > 0 ? urls[0] : null;
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const urls = (value as { url_list?: string[] }).url_list;
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const jpeg = [...urls].reverse().find((u) => u.includes(".jpeg") || u.includes(".jpg"));
  return jpeg ?? urls[0];
}

function looksLikeVideoUrl(url: string): boolean {
  const n = url.toLowerCase();
  return [".mp4", ".mov", "/play/", "/playwm/", "video_id=", "mime_type=video"].some((h) => n.includes(h));
}

function normalizeVideoUrl(url: string): string {
  return url.replace("/playwm/", "/play/");
}

function liveVideoUrl(value: unknown, inVideoContext = false): string | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of ["play_addr", "download_addr"]) {
      const u = firstUrl(obj[key]);
      if (u && looksLikeVideoUrl(u)) return normalizeVideoUrl(u);
    }
    const direct = firstUrl(value);
    if (direct && inVideoContext && looksLikeVideoUrl(direct)) return normalizeVideoUrl(direct);
    for (const [key, child] of Object.entries(obj)) {
      const keyCtx = inVideoContext || ["video", "video_info", "live_photo", "live_photo_video", "clip_video"].some((h) => key.toLowerCase().includes(h));
      const found = liveVideoUrl(child, keyCtx);
      if (found) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = liveVideoUrl(item, inVideoContext);
      if (found) return found;
    }
  }
  if (typeof value === "string" && inVideoContext && looksLikeVideoUrl(value)) {
    return normalizeVideoUrl(value);
  }
  return null;
}

function itemImages(item: Record<string, unknown>): unknown[] | null {
  const images = item["images"];
  if (Array.isArray(images) && images.length > 0) return images;
  const postInfo = item["image_post_info"];
  if (typeof postInfo === "object" && postInfo !== null) {
    const inner = (postInfo as { images?: unknown[] }).images;
    if (Array.isArray(inner) && inner.length > 0) return inner;
  }
  return null;
}

function galleryVideoUrl(item: Record<string, unknown>): string | null {
  const video = item["video"];
  if (typeof video !== "object" || video === null) return null;
  const v = video as Record<string, unknown>;
  const duration = v["duration"];
  if (typeof duration !== "number" || duration <= 0) return null;
  return liveVideoUrl(video, true);
}

function extractVideoDownload(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const bitRates = (value as { bit_rate?: unknown[] }).bit_rate;
  if (Array.isArray(bitRates) && bitRates.length > 0) {
    const candidates: [number, number, string][] = [];
    for (const br of bitRates) {
      if (typeof br !== "object" || br === null) continue;
      const b = br as Record<string, unknown>;
      const u = firstUrl(b["play_addr"]);
      if (!u) continue;
      candidates.push([Number(b["bit_rate"]) || 0, Number(b["FPS"]) || 0, u]);
    }
    if (candidates.length > 0) {
      return normalizeVideoUrl(candidates.reduce((a, b) => (b[0] > a[0] ? b : a))[2]);
    }
  }
  return liveVideoUrl(value, true);
}

function detailApiUrl(awemeId: string): string {
  const params: Record<string, string> = {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    aweme_id: awemeId,
    update_version_code: "170400",
    pc_client_type: "1",
    pc_libra_divert: "Windows",
    support_h265: "1",
    support_dash: "1",
    version_code: "290100",
    version_name: "29.1.0",
    cookie_enabled: "true",
    screen_width: "1536",
    screen_height: "864",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Chrome",
    browser_version: "139.0.0.0",
    browser_online: "true",
    engine_name: "Blink",
    engine_version: "139.0.0.0",
    os_name: "Windows",
    os_version: "10",
    cpu_core_num: "16",
    device_memory: "8",
    platform: "PC",
    downlink: "10",
    effective_type: "4g",
    round_trip_time: "200",
    uifid: "",
    msToken: "",
  };
  const qs = new URLSearchParams(params).toString();
  const aBogus = signUrl(qs, BROWSER_UA);
  return `https://www.douyin.com/aweme/v1/web/aweme/detail/?${qs}&a_bogus=${encodeURIComponent(aBogus)}`;
}

function extractDetailAssets(item: Record<string, unknown>): MediaAsset[] {
  const images = itemImages(item);
  if (!Array.isArray(images)) return [];
  const assets: MediaAsset[] = [];
  images.forEach((image, idx) => {
    if (typeof image !== "object" || image === null) return;
    const img = image as Record<string, unknown>;
    const iu = imageUrl(image);
    if (iu) assets.push({ url: iu, kind: "image", filename: `图片_${String(idx + 1).padStart(2, "0")}` });
    const vu = extractVideoDownload(img["video"]);
    if (vu) assets.push({ url: vu, kind: "video", filename: `实况_${String(idx + 1).padStart(2, "0")}` });
  });
  return assets;
}

async function fetchDetail(
  awemeId: string,
  sourceUrl: string,
  cookie: string,
): Promise<VideoInfo | null> {
  if (!cookie) return null;
  const headers: HeadersInit = {
    Accept: "*/*",
    "User-Agent": BROWSER_UA,
    Referer: "https://www.douyin.com/?recommend=1",
    Cookie: cookie,
  };
  let data: any;
  try {
    const resp = await fetch(detailApiUrl(awemeId), { headers });
    if (!resp.ok) return null;
    data = await resp.json();
  } catch {
    return null;
  }
  const item = data?.aweme_detail;
  if (typeof item !== "object" || item === null) return null;
  const assets = extractDetailAssets(item);
  if (assets.length === 0 || !assets.some((a) => a.kind === "video")) return null;
  const firstImage = assets.find((a) => a.kind === "image")?.url ?? null;
  return {
    id: String(item.aweme_id ?? awemeId),
    title: item.desc || "抖音图文作品",
    uploader: item.author?.nickname ?? null,
    duration: null,
    thumbnail: firstImage,
    webpage_url: sourceUrl,
    media_type: "gallery",
    assets,
    formats: [
      {
        id: "gallery",
        label: `图文合集 · ${assets.filter((a) => a.kind === "image").length} 张图片 · ${assets.filter((a) => a.kind === "video").length} 个实况视频`,
        ext: "zip",
        height: null,
        filesize: null,
        has_audio: false,
      },
    ],
  };
}

function parseRouterData(html: string, sourceUrl: string): VideoInfo {
  const match = ROUTER_DATA_PATTERN.exec(html);
  if (!match) throw new DouyinError("抖音公开分享页没有返回作品数据");
  let routerData: any;
  try {
    routerData = JSON.parse(match[1]);
  } catch {
    throw new DouyinError("无法解析公开分享页的 JSON 数据");
  }
  let item: any;
  try {
    const loaderData = routerData.loaderData;
    const pageData = Object.values(loaderData).find(
      (v) => typeof v === "object" && v !== null && "videoInfoRes" in (v as object),
    ) as any;
    item = pageData.videoInfoRes.item_list[0];
  } catch {
    throw new DouyinError("无法读取抖音公开分享页中的作品数据");
  }

  const images = itemImages(item);
  if (Array.isArray(images) && images.length > 0) {
    const assets: MediaAsset[] = [];
    images.forEach((image: unknown, idx: number) => {
      if (typeof image !== "object" || image === null) return;
      const iu = imageUrl(image);
      if (iu) assets.push({ url: iu, kind: "image", filename: `图片_${String(idx + 1).padStart(2, "0")}` });
      const liveUrl = liveVideoUrl(image);
      if (liveUrl) assets.push({ url: liveUrl, kind: "video", filename: `实况_${String(idx + 1).padStart(2, "0")}` });
    });
    if (!assets.some((a) => a.kind === "video")) {
      const gv = galleryVideoUrl(item);
      if (gv) assets.push({ url: gv, kind: "video", filename: "实况_合集" });
    }
    if (assets.length === 0) throw new DouyinError("抖音图文分享页没有返回可下载的图片");
    const firstImage = assets.find((a) => a.kind === "image")?.url ?? null;
    return {
      id: String(item.aweme_id ?? ""),
      title: item.desc || "抖音图文作品",
      uploader: item.author?.nickname ?? null,
      duration: null,
      thumbnail: firstImage,
      webpage_url: sourceUrl,
      media_type: "gallery",
      assets,
      formats: [
        {
          id: "gallery",
          label: `图文合集 · ${images.length} 张图片${assets.some((a) => a.kind === "video") ? ` · ${assets.filter((a) => a.kind === "video").length} 个实况视频` : ""}`,
          ext: "zip",
          height: null,
          filesize: null,
          has_audio: false,
        },
      ],
    };
  }

  const video = item.video;
  if (typeof video !== "object" || video === null) {
    throw new DouyinError("抖音公开分享页没有返回可下载的视频数据");
  }
  let playUrl = firstUrl(video.play_addr);
  if (!playUrl) throw new DouyinError("抖音公开分享页没有返回可下载的视频地址");
  playUrl = normalizeVideoUrl(playUrl);
  const thumbnail = firstUrl(video.cover) || firstUrl(video.origin_cover);
  const durationMs = video.duration;
  const duration = typeof durationMs === "number" ? durationMs / 1000 : null;
  const height = typeof video.height === "number" ? video.height : null;
  const width = typeof video.width === "number" ? video.width : null;
  const quality = width && height ? `${width}×${height}` : "最佳画质";

  return {
    id: String(item.aweme_id ?? ""),
    title: item.desc || "抖音视频",
    uploader: item.author?.nickname ?? null,
    duration,
    thumbnail,
    webpage_url: sourceUrl,
    download_url: playUrl,
    media_type: "video",
    assets: [],
    formats: [
      {
        id: "",
        label: `${quality} · MP4 · 大小未知`,
        ext: "mp4",
        height,
        filesize: null,
        has_audio: true,
      },
    ],
  };
}

/** 解析抖音分享链接或短链，返回 VideoInfo。 */
export async function extractDouyin(url: string, cookie: string): Promise<VideoInfo> {
  // 先把短链 follow 一下，拿到 aweme_id
  let finalUrl = url;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": MOBILE_UA, "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
    });
    finalUrl = resp.url || url;
  } catch {
    // 忽略，用原始 url
  }
  const idMatch = WORK_ID_PATTERN.exec(finalUrl);
  if (!idMatch) throw new DouyinError("无法从抖音分享链接中识别作品 ID");
  const videoId = idMatch[1];

  // 优先走 detail API
  const detail = await fetchDetail(videoId, url, cookie);
  if (detail) return detail;

  // fallback：公开分享页
  const workTypeMatch = finalUrl.match(/\/(video|note|slides)\//);
  const workType = workTypeMatch?.[1] === "slides" ? "note" : workTypeMatch?.[1] ?? "video";
  const shareUrl = `https://www.iesdouyin.com/share/${workType}/${videoId}/`;
  const resp = await fetch(shareUrl, { headers: { "User-Agent": MOBILE_UA } });
  if (!resp.ok) throw new DouyinError("抖音公开分享页访问失败");
  const html = await resp.text();
  return parseRouterData(html, url);
}
