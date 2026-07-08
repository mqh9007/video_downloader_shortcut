/**
 * ReelFetch 快捷指令解析 Worker
 * 接口：POST /api/v1/shortcut/parse，GET /api/media/download（可选代理下载）。
 *
 * 适配原项目 backend/app/main.py 的 shortcut_parse + media_download。
 */

import { validatePublicUrl, HTTPError } from "./security";
import type {
  PublicParseRequest,
  PublicParseResponse,
  PublicDownloadItem,
  VideoInfo,
} from "./models";
import { extractDouyin } from "./platforms/douyin";
import { extractBilibili } from "./platforms/bilibili";

export interface Env {
  PUBLIC_BASE_URL?: string;
  PUBLIC_API_KEY?: string;
  DOUYIN_COOKIE?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders },
  });
}

function errorResponse(status: number, message: string): Response {
  return json(
    {
      success: false,
      message,
      notification: message,
      error: message,
      source_url: null,
      media: null,
      downloads: [],
      downloads_referer: null,
      task_endpoint: null,
    } satisfies PublicParseResponse,
    status,
  );
}

function douyinUrl(url: string): boolean {
  return /douyin\.com$/i.test(new URL(url).hostname) || new URL(url).hostname.endsWith(".douyin.com");
}

function bilibiliUrl(url: string): boolean {
  const h = new URL(url).hostname.toLowerCase();
  return h === "bilibili.com" || h.endsWith(".bilibili.com") || h === "b23.tv" || h.endsWith(".b23.tv");
}

async function handleShortcutParse(request: Request, env: Env): Promise<Response> {
  // API Key 校验
  const expectedKey = env.PUBLIC_API_KEY;
  if (expectedKey) {
    const provided = request.headers.get("X-API-Key");
    if (provided !== expectedKey) {
      return errorResponse(401, "API Key 无效或缺失");
    }
  }

  let payload: PublicParseRequest;
  try {
    payload = (await request.json()) as PublicParseRequest;
  } catch {
    return errorResponse(400, "请求体需要是 JSON");
  }
  if (!payload.text || typeof payload.text !== "string") {
    return errorResponse(400, "缺少 text 字段");
  }

  // SSRF + 平台识别
  let validatedUrl: string;
  try {
    validatedUrl = await validatePublicUrl(payload.text);
  } catch (exc) {
    if (exc instanceof HTTPError) return errorResponse(exc.status, exc.message);
    throw exc;
  }

  // 分平台抓取
  let media: VideoInfo;
  try {
    if (douyinUrl(validatedUrl)) {
      media = await extractDouyin(validatedUrl, env.DOUYIN_COOKIE ?? "");
    } else if (bilibiliUrl(validatedUrl)) {
      media = await extractBilibili(validatedUrl);
    } else {
      return errorResponse(400, "目前只支持抖音和 Bilibili 的分享链接");
    }
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : "解析失败，请稍后重试";
    return json({
      success: false,
      message: msg,
      notification: msg,
      error: msg,
      source_url: validatedUrl,
      media: null,
      downloads: [],
      downloads_referer: null,
      task_endpoint: null,
    } satisfies PublicParseResponse);
  }

  // 组装 downloads 列表
  // 默认直接返回 CDN 原始链接，由快捷指令在下载时带 Referer 头。
  // 如果希望视频流经 Worker 代理（比如某些 CDN 校验更严格），把 PROXY_DOWNLOADS 设为 "true"。
  const proxyDownloads = (env as any).PROXY_DOWNLOADS === "true";
  const baseUrl = (env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const downloadsReferer = douyinUrl(validatedUrl) ? "https://www.douyin.com/" : "https://www.bilibili.com/";
  const downloads: PublicDownloadItem[] = [];
  if (media.download_url) {
    downloads.push({
      kind: "video",
      filename: media.title || "视频",
      url: proxyDownloads
        ? `${baseUrl}/api/media/download?url=${encodeURIComponent(media.download_url)}&filename=${encodeURIComponent(media.title || "视频")}`
        : media.download_url,
    });
  }
  for (const asset of media.assets) {
    downloads.push({
      kind: asset.kind,
      filename: asset.filename,
      url: proxyDownloads
        ? `${baseUrl}/api/media/download?url=${encodeURIComponent(asset.url)}&filename=${encodeURIComponent(asset.filename)}`
        : asset.url,
    });
  }

  if (downloads.length === 0) {
    const msg = "没有找到可直接保存到相册的媒体文件";
    return json({
      success: false,
      message: msg,
      notification: msg,
      error: msg,
      source_url: validatedUrl,
      media,
      downloads: [],
      downloads_referer: null,
      task_endpoint: baseUrl ? `${baseUrl}/api/tasks` : null,
    } satisfies PublicParseResponse);
  }

  const summary = downloadSummary(downloads);
  return json({
    success: true,
    message: summary,
    notification: summary,
    source_url: validatedUrl,
    media,
    downloads,
    downloads_referer: downloadsReferer,
    task_endpoint: baseUrl ? `${baseUrl}/api/tasks` : null,
  } satisfies PublicParseResponse);
}

function downloadSummary(downloads: PublicDownloadItem[]): string {
  if (downloads.length === 0) return "没有找到可保存到相册的媒体文件";
  const imgs = downloads.filter((d) => d.kind === "image").length;
  const vids = downloads.filter((d) => d.kind === "video").length;
  const parts: string[] = [];
  if (vids) parts.push(`${vids}个视频`);
  if (imgs) parts.push(`${imgs}张图片`);
  return `解析成功，找到${parts.join("、")}`;
}

/**
 * 可选代理下载：把 CDN 的请求头伪装成浏览器，流式转发给 iPhone。
 * 这个端点是"视频流量走 Worker"的入口，按需启用。
 */
async function handleMediaDownload(request: Request, _env: Env): Promise<Response> {
  const urlObj = new URL(request.url);
  let targetUrl = urlObj.searchParams.get("url");
  const filename = urlObj.searchParams.get("filename") || "媒体文件";

  // 支持 GET 直链：/ipfs/VIDEO_URL 形式也能走
  if (!targetUrl) {
    const fallback = urlObj.pathname.replace(/^\/api\/media\/download\/?/, "");
    if (fallback && fallback !== "/") targetUrl = decodeURIComponent(fallback);
  }
  if (!targetUrl) {
    return errorResponse(400, "缺少 url 参数");
  }

  // SSRF 校验
  try {
    targetUrl = await validatePublicUrl(targetUrl);
  } catch (exc) {
    if (exc instanceof HTTPError) return errorResponse(exc.status, exc.message);
    throw exc;
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
        Referer: douyinUrl(targetUrl) ? "https://www.douyin.com/" : "https://www.bilibili.com/",
      },
    });
  } catch (exc) {
    return errorResponse(502, "媒体文件暂时无法下载");
  }

  const contentType = upstream.headers.get("Content-Type") || "application/octet-stream";
  const safeName = sanitizeFilename(filename, contentType);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponentRfc5987(safeName)}`,
      "Cache-Control": "private, no-store",
      ...CORS_HEADERS,
    },
  });
}

function sanitizeFilename(name: string, contentType: string): string {
  let base = name.replace(/[\r\n]/g, "").slice(0, 180) || "媒体文件";
  if (!/\.\w+$/.test(base)) {
    base += contentType.startsWith("video/") ? ".mp4" : ".jpg";
  }
  return base;
}

function encodeURIComponentRfc5987(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 健康检查
    if (url.pathname === "/api/health") {
      return json({ status: "ok" });
    }

    // 快捷指令专用解析接口
    if (url.pathname === "/api/v1/shortcut/parse" && request.method === "POST") {
      return handleShortcutParse(request, env);
    }

    // 可选代理下载
    if (
      (url.pathname === "/api/media/download" || url.pathname.startsWith("/api/media/download/")) &&
      request.method === "GET"
    ) {
      return handleMediaDownload(request, env);
    }

    return errorResponse(404, "接口不存在");
  },
};
