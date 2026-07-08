/**
 * 快手解析模块。
 * 通过快手公开分享页 + video info 接口解析视频地址。
 * 参考自快手开放分享页结构（www.kuaishou.com/short-video/{id} 等）。
 */

import type { VideoInfo } from "../models";

const KUAISHOU_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

class KuaishouError extends Error {}

interface KsGraphQLData {
  visionVideoDetail?: {
    photoId?: string;
    photo?: {
      id?: string;
      duration?: number;
      caption?: string;
      coverUrl?: string;
      photoUrl?: string;
      videoResource?: {
        adaptive?: { url?: string; hdrUrl?: string };
        hd?: { url?: string };
        ld?: { url?: string };
        sd?: { url?: string };
      };
    };
    author?: { name?: string; id?: string };
  };
  visionPlaylist?: {
    playlistType?: string;
    photos?: Array<{
      id?: string;
      photoUrl?: string;
      coverUrl?: string;
      caption?: string;
      photoId?: string;
      videoResource?: {
        adaptive?: { url?: string; hdrUrl?: string };
        hd?: { url?: string };
        ld?: { url?: string };
        sd?: { url?: string };
      };
    }>;
    author?: { name?: string };
    title?: string;
  };
}

function extractPhotoId(url: string): string | null {
  // 短链 v.kuaishou.com/XXXXX、www.kuaishou.com/f/XXXXX、www.kuaishou.com/short-video/XXXXX
  const shortMatch = url.match(/v\.kuaishou\.com\/([A-Za-z0-9_-]+)/);
  if (shortMatch) return shortMatch[1];
  const idMatch = url.match(/kuaishou\.com\/(?:short-video|f)\/([A-Za-z0-9_-]+)/);
  return idMatch?.[1] ?? null;
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

export async function extractKuaishou(url: string): Promise<VideoInfo> {
  // 先尝试跟随短链，提取 photoId
  const finalUrl = await followShortLink(url);
  let photoId = extractPhotoId(finalUrl) ?? extractPhotoId(url);

  // 如果 URL 里找不到 ID，尝试从分享页 HTML 抓 GraphQL 数据
  let gqlData: KsGraphQLData | null = null;
  if (!photoId) {
    try {
      const htmlResp = await fetch(finalUrl, { headers: { "User-Agent": KUAISHOU_UA } });
      if (htmlResp.ok) {
        const html = await htmlResp.text();
        const jsonMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.*?\})(?:;|\n)/s);
        if (jsonMatch) {
          gqlData = JSON.parse(jsonMatch[1]);
        }
      }
    } catch {
      // ignore
    }
  }

  if (photoId) {
    // km 官方 graphql
    const gqlResp = await fetch(
      `https://www.kuaishou.com/graphql`,
      {
        method: "POST",
        headers: {
          "User-Agent": KUAISHOU_UA,
          "Content-Type": "application/json",
          Referer: "https://www.kuaishou.com/",
        },
        body: JSON.stringify({
          operationName: "visionVideoDetail",
          query: "query visionVideoDetail($photoId: String, $type: String) { visionVideoDetail(photoId: $photoId, type: $type) { photo { id duration caption coverUrl photoUrl videoResource { adaptive { url } hd { url } ld { url } sd { url } } } author { name id } } }",
          variables: { photoId, type: " VIDEO " },
        }),
      },
    );
    if (gqlResp.ok) {
      const result = (await gqlResp.json()) as { data?: KsGraphQLData };
      gqlData = result.data ?? null;
    }
  }

  if (!gqlData) throw new KuaishouError("无法解析快手作品信息");

  // 视频
  const detailPhoto = gqlData.visionVideoDetail?.photo;
  const listPhoto = gqlData.visionPlaylist?.photos?.[0];
  const photo = detailPhoto ?? listPhoto;
  if (!photo) throw new KuaishouError("快手作品数据为空");

  const vr = photo.videoResource;
  const videoUrl =
    vr?.adaptive?.url ?? vr?.adaptive?.hdrUrl ?? vr?.hd?.url ?? vr?.ld?.url ?? vr?.sd?.url;
  const photoUrl = photo.photoUrl;
  const downloadUrl = videoUrl ?? photoUrl;

  if (!downloadUrl) throw new KuaishouError("无法获取快手视频下载地址");

  const author = gqlData.visionVideoDetail?.author ?? gqlData.visionPlaylist?.author;
  const title = photo.caption ?? gqlData.visionPlaylist?.title ?? "快手作品";
  const id = "id" in photo ? photo.id : ("photoId" in photo ? photo.photoId : undefined);
  const dur = "duration" in photo ? photo.duration : undefined;

  return {
    id: id ?? "",
    title,
    uploader: author?.name ?? null,
    duration: typeof dur === "number" ? dur / 1000 : null,
    thumbnail: photo.coverUrl ?? null,
    webpage_url: url,
    download_url: downloadUrl,
    media_type: "video",
    assets: [],
    formats: [
      {
        id: "default",
        label: `MP4 · 大小未知`,
        ext: downloadUrl.includes(".mp4") ? "mp4" : "video",
        height: null,
        filesize: null,
        has_audio: true,
      },
    ],
  };
}
