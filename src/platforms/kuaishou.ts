/**
 * 快手解析模块。
 * 三层策略：
 *   1) GraphQL API（visionVideoDetail）—— 需要 photoId + 正确参数
 *   2) 分享页 HTML 抓取 window.__APOLLO_STATE__ GraphQL 缓存
 *   3) 兜底：解析 HTML 中的 <video> / ld+json / og:video 标签
 */

import type { VideoInfo } from "../models";

const KUAISHOU_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

class KuaishouError extends Error {}

function extractPhotoId(url: string): string | null {
  const m =
    url.match(/v\.kuaishou\.com\/([A-Za-z0-9_-]+)/) ??
    url.match(/kuaishou\.com\/(?:short-video|f|photo\/id|new-video)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

async function followShortLink(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": KUAISHOU_UA, "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
    });
    return resp.url || url;
  } catch {
    return url;
  }
}

/** 策略 1：GraphQL API */
async function tryGraphQL(photoId: string): Promise<VideoInfo | null> {
  try {
    const resp = await fetch("https://www.kuaishou.com/graphql", {
      method: "POST",
      headers: {
        "User-Agent": KUAISHOU_UA,
        "Content-Type": "application/json",
        Referer: `https://www.kuaishou.com/short-video/${photoId}`,
      },
      body: JSON.stringify({
        operationName: "visionVideoDetail",
        query: `query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageArea: String) {
          visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageArea: $webPageArea) {
            photo {
              id duration caption coverUrl photoUrl
              videoResource {
                adaptive { url hdrUrl } hd { url } ld { url } sd { url }
              }
            }
            author { name id }
          }
        }`,
        variables: { photoId, type: "VIDEO", page: "search_instant", webPageArea: "brilliantSearch" },
      }),
    });
    if (!resp.ok) return null;
    const result = (await resp.json()) as any;
    const photo = result?.data?.visionVideoDetail?.photo;
    if (!photo) return null;

    const vr = photo.videoResource;
    const videoUrl =
      vr?.adaptive?.url ?? vr?.adaptive?.hdrUrl ?? vr?.hd?.url ?? vr?.ld?.url ?? vr?.sd?.url;
    const downloadUrl = videoUrl ?? photo.photoUrl;
    if (!downloadUrl) return null;

    return {
      id: photo.id ?? photoId,
      title: photo.caption ?? "快手作品",
      uploader: photo.author?.name ?? null,
      duration: typeof photo.duration === "number" ? photo.duration / 1000 : null,
      thumbnail: photo.coverUrl ?? null,
      webpage_url: `https://www.kuaishou.com/short-video/${photoId}`,
      download_url: downloadUrl,
      media_type: "video",
      assets: [],
      formats: [{ id: "default", label: "MP4 · 大小未知", ext: "mp4", height: null, filesize: null, has_audio: true }],
    };
  } catch {
    return null;
  }
}

/** 策略 2：抓取分享页 HTML 中的 __APOLLO_STATE__ */
async function tryHtmlApollo(url: string): Promise<VideoInfo | null> {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": KUAISHOU_UA } });
    if (!resp.ok) return null;
    const html = await resp.text();

    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.*?\})\s*(?:<\/script>|\n)/s);
    if (!apolloMatch) return null;

    const data = JSON.parse(apolloMatch[1]) as Record<string, any>;
    const graphPayloads = Object.values(data).filter(
      (v: any) => v && typeof v === "object" && ("photo" in v || "photos" in v || "photoId" in v),
    );

    for (const payload of graphPayloads) {
      const photo = (payload as any).photo ?? (payload as any).photos?.[0];
      if (!photo) continue;
      const vr = (photo as any).videoResource;
      const videoUrl =
        vr?.adaptive?.url ?? vr?.adaptive?.hdrUrl ?? vr?.hd?.url ?? vr?.ld?.url ?? vr?.sd?.url;
      const downloadUrl = videoUrl ?? (photo as any).photoUrl;
      if (!downloadUrl) continue;

      return {
        id: (photo as any).id ?? (photo as any).photoId ?? "",
        title: (photo as any).caption ?? "快手作品",
        uploader: (payload as any).author?.name ?? null,
        duration: typeof (photo as any).duration === "number" ? (photo as any).duration / 1000 : null,
        thumbnail: (photo as any).coverUrl ?? null,
        webpage_url: url,
        download_url: downloadUrl,
        media_type: "video",
        assets: [],
        formats: [{ id: "default", label: "MP4 · 大小未知", ext: "mp4", height: null, filesize: null, has_audio: true }],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 策略 3：从 HTML 中直接提取 <video src> / ld+json / og:video */
async function tryHtmlScrape(url: string): Promise<VideoInfo | null> {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": KUAISHOU_UA } });
    if (!resp.ok) return null;
    const html = await resp.text();

    // A) <video src="...">
    const videoMatch = html.match(/<video[^>]+src\s*=\s*["']([^"']+\.(?:mp4|m3u8|mov))["']/i);
    if (videoMatch) {
      return buildFromUrl(url, videoMatch[1], html);
    }

    // B) application/ld+json 中 encoding.contentUrl / thumbnailUrl / name
    const ldMatch = html.match(/"@type"\s*:\s*"VideoObject"[\s\S]*?"contentUrl"\s*:\s*"([^"]+)"/i);
    if (ldMatch) {
      return buildFromUrl(url, ldMatch[1], html);
    }

    // C) og:video / video:secure_url
    const ogMatch = html.match(/<meta[^>]+(?:name|property)="(?:og:video|video:secure_url)"[^>]+content="([^"]+)"/i);
    if (ogMatch) {
      return buildFromUrl(url, ogMatch[1], html);
    }

    return null;
  } catch {
    return null;
  }
}

function buildFromUrl(pageUrl: string, downloadUrl: string, html: string): VideoInfo {
  // 抓 title / thumbnail / description
  const titleMatch =
    html.match(/<meta[^>]+name="title"[^>]+content="([^"]+)"/i) ??
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ??
    html.match(/<title>([^<]+)<\/title>/i);
  const thumbMatch =
    html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ??
    html.match(/<meta[^>]+name="og:image"[^>]+content="([^"]+)"/i);

  return {
    id: "",
    title: titleMatch?.[1]?.trim() ?? "快手作品",
    uploader: null,
    duration: null,
    thumbnail: thumbMatch?.[1] ?? null,
    webpage_url: pageUrl,
    download_url: downloadUrl,
    media_type: "video",
    assets: [],
    formats: [{ id: "default", label: "MP4 · 大小未知", ext: "mp4", height: null, filesize: null, has_audio: true }],
  };
}

export async function extractKuaishou(url: string): Promise<VideoInfo> {
  const finalUrl = await followShortLink(url);
  const photoId = extractPhotoId(finalUrl) ?? extractPhotoId(url);

  // 按序尝试三种策略
  if (photoId) {
    const r1 = await tryGraphQL(photoId);
    if (r1) return r1;
    const r2 = await tryHtmlApollo(finalUrl);
    if (r2) return r2;
    const r3 = await tryHtmlScrape(finalUrl);
    if (r3) return r3;
  } else {
    const r4 = await tryHtmlApollo(finalUrl);
    if (r4) return r4;
    const r5 = await tryHtmlScrape(finalUrl);
    if (r5) return r5;
  }

  throw new KuaishouError(
    "无法解析快手作品信息，请检查链接是否有效，或该作品需要登录/已删除。",
  );
}
