/**
 * Bilibili 解析模块：通过 bilibili.wbi 公开接口获取播放地址。
 * 适配自原项目 _site_options 逻辑（带 Referer），
 * 含 HTTP 412 回退到 legacy 端点（与 douyin_fallback.py 同源策略）。
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

async function fetchRaw(url: string): Promise<Response> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": BILIBILI_UA,
      Referer: "https://www.bilibili.com/",
      Origin: "https://www.bilibili.com",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  return resp;
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetchRaw(url);
  if (!resp.ok) throw new BilibiliError(`Bilibili 接口 HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

/** 获取播放信息：多端点顺序 fallback（主 WBI / legacy / 外站）。 */
async function fetchPlayInfo(bvid: string, cid: number): Promise<BiliPlayInfo> {
  const userCookie = "";

  // 1) 主 WBI 端点
  const primaryUrl =
    `https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=${cid}&qn=112&fnval=4048&platform=html5`;
  const primaryResp = await fetchRaw(primaryUrl);
  if (primaryResp.ok) {
    const data = (await primaryResp.json()) as BiliPlayInfo;
    if (data.code === 0) return data;
    if (data.code !== -412) {
      throw new BilibiliError(`B站播放接口返回错误: ${data.message ?? "未知"} (code=${data.code})`);
    }
  }

  // 2) legacy 端点 + try_look（老接口，不强制 WBI）
  const legacyUrl =
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=112&fnval=4048&try_look=1&platform=html5`;
  const legacyResp = await fetchRaw(legacyUrl);
  if (legacyResp.ok) {
    const data = (await legacyResp.json()) as BiliPlayInfo;
    if (data.code === 0) return data;
  }

  // 3) 再试一次带 mobi_platform=android（移动端接口）
  const mobileUrl =
    `https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=${cid}&qn=32&fnval=4048&platform=html5&mobi_platform=android`;
  const mobileResp = await fetchRaw(mobileUrl);
  if (mobileResp.ok) {
    const data = (await mobileResp.json()) as BiliPlayInfo;
    if (data.code === 0) return data;
  }

  if (userCookie) {
    // 4) 最后尝试带用户 cookie（如果你的 worker 有 cookie）
    const cookieUrl =
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=112&fnval=4048`;
    const cookieResp = await fetch(cookieUrl, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: "https://www.bilibili.com/",
        Origin: "https://www.bilibili.com",
        Cookie: userCookie,
      },
    });
    if (cookieResp.ok) {
      const data = (await cookieResp.json()) as BiliPlayInfo;
      if (data.code === 0) return data;
    }
  }

  throw new BilibiliError(
    "B站播放地址获取失败（接口返回 412 或被风控）。该视频可能需要登录、大会员，或当前 IP 已被 B站风控。请稍后再试或换用个人 B站 Cookie。",
  );
}

export async function extractBilibili(url: string): Promise<VideoInfo> {
  const bvid = await extractBvid(url);
  if (!bvid) throw new BilibiliError("无法从链接中识别 BVID");

  const info = await fetchJson<BiliVideoInfo>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );

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
  if (!cid) throw new BilibiliError("无法获取视频的 CID");

  const playInfo = await fetchPlayInfo(bvid, cid);
  const data = playInfo.data;
  if (!data) throw new BilibiliError("Bilibili 播放数据为空");

  let downloadUrl: string | null = null;
  const formats: VideoFormat[] = [];

  if (data.dash?.video?.length) {
    const sorted = [...data.dash.video].sort(
      (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
    );
    for (const vid of sorted.slice(0, 4)) {
      const u = vid.base_url || vid.backup_url?.[0];
      if (!u) continue;
      const quality = vid.height ? `${vid.height}p` : "未知画质";
      formats.push({
        id: String(vid.id),
        label: `${quality} · MP4 · 视频轨`,
        ext: "mp4",
        height: vid.height ?? null,
        filesize: null,
        has_audio: false,
      });
      downloadUrl ??= u;
    }
  }

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
