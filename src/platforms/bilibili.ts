/**
 * Bilibili 解析模块：通过 bilibili.wbi 公开接口获取播放地址。
 * 适配自原项目 _site_options 逻辑（带 Referer）。
 */

import type { VideoFormat, VideoInfo } from "../models";

const BILIBILI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36";

class BilibiliError extends Error {}

interface BiliPlayInfo {
  code: number;
  message?: string;
  data?: {
    accept_quality?: string[];
    accept_description?: string[];
    durl?: { url: string; size: number }[];
    dash?: {
      video: { id: number; base_url: string; backup_url?: string[]; width?: number; height?: number; bandwidth?: number }[];
      audio: { id: number; base_url: string; backup_url?: string[]; bandwidth?: number }[];
    };
    timelength?: number;
  };
}

interface BiliVideoInfo {
  bvid: string;
  title: string;
  pic: string;
  duration: number;
  owner?: { name: string };
}

/**
 * 从链接中提取 BVID——工作在 Workers 端，对短链用"跟重定向+正则"，
 * 如果无法自己跟随就用备用 API 解析。
 */
async function extractBvid(url: string): Promise<string | null> {
  let u = url;
  try {
    const resp = await fetch(u, { headers: { "User-Agent": BILIBILI_UA }, redirect: "follow" });
    u = resp.url || u;
  } catch {
    // ignore
  }
  const match = u.match(/\/(BV[0-9A-Za-z]+)/) || u.match(/bvid=(BV[0-9A-Za-z]+)/);
  return match?.[1] ?? null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": BILIBILI_UA,
      Referer: "https://www.bilibili.com/",
      Origin: "https://www.bilibili.com",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!resp.ok) throw new BilibiliError(`Bilibili 接口 HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

export async function extractBilibili(url: string): Promise<VideoInfo> {
  const bvid = await extractBvid(url);
  if (!bvid) throw new BilibiliError("无法从链接中识别 BVID");

  // 视频基础信息
  const info = await fetchJson<BiliVideoInfo>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );

  // 通过 pagelist 取 cid
  let cid = 0;
  try {
    const pagelist = await fetchJson<{ data?: { cid: number }[] }>(
      `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`,
    );
    cid = pagelist.data?.[0]?.cid ?? 0;
  } catch {
    // try alternative
  }
  if (!cid) {
    try {
      const alt = await fetchJson<{ data?: { cid: number } }>(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      );
      cid = alt.data?.cid ?? 0;
    } catch {
      // ignore
    }
  }

  // 播放信息
  if (!cid) throw new BilibiliError("无法获取视频的 CID");

  const playInfo = await fetchJson<BiliPlayInfo>(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=112&fnval=1`,
  );
  if (playInfo.code !== 0) throw new BilibiliError(`播放接口返回错误: ${playInfo.message ?? "未知"}`);
  const data = playInfo.data;
  if (!data) throw new BilibiliError("Bilibili 播放数据为空");

  let downloadUrl: string | null = null;
  const formats: VideoFormat[] = [];

  // 优先 DASH 视频轨
  if (data.dash?.video?.length) {
    const sorted = [...data.dash.video].sort(
      (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
    );
    for (const vid of sorted.slice(0, 4)) {
      const url = vid.base_url || vid.backup_url?.[0];
      if (!url) continue;
      const quality = vid.height ? `${vid.height}p` : "未知画质";
      formats.push({
        id: String(vid.id),
        label: `${quality} · MP4 · 视频轨`,
        ext: "mp4",
        height: vid.height ?? null,
        filesize: null,
        has_audio: false,
      });
      downloadUrl ??= url;
    }
  }

  // 回退到 durl（旧接口，自带音频）
  if (!downloadUrl && data.durl?.length) {
    const first = data.durl[0];
    if (first?.url) {
      downloadUrl = first.url;
      formats.push({
        id: "durl",
        label: `FLV/MP4 · 内含音频`,
        ext: "flv",
        height: null,
        filesize: first.size ?? null,
        has_audio: true,
      });
    }
  }

  if (!downloadUrl) throw new BilibiliError("无法获取 Bilibili 视频下载地址");

  return {
    id: bvid,
    title: info.title ?? "未命名视频",
    uploader: info.owner?.name ?? null,
    duration: typeof info.duration === "number" ? info.duration : null,
    thumbnail: info.pic ? (info.pic.startsWith("//") ? `https:${info.pic}` : info.pic) : null,
    webpage_url: url,
    download_url: downloadUrl,
    media_type: "video",
    assets: [],
    formats: formats.length > 0 ? formats : [
      {
        id: "default",
        label: "最佳画质 · MP4 · 大小未知",
        ext: "mp4",
        height: null,
        filesize: null,
        has_audio: true,
      },
    ],
  };
}
