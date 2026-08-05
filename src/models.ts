/** 与原项目 backend/app/models.ts 对齐的类型定义。 */

export type PublicParseRequest = {
  text: string;
};

export type MediaAsset = {
  url: string;
  kind: "image" | "video";
  filename: string;
};

export type VideoFormat = {
  id: string;
  label: string;
  ext: string;
  height: number | null;
  filesize: number | null;
  has_audio: boolean;
};

export type VideoInfo = {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
  download_url?: string | null;
  media_type: "video" | "gallery";
  assets: MediaAsset[];
  formats: VideoFormat[];
};

export type PublicDownloadItem = {
  kind: "image" | "video";
  filename: string;
  url: string;
};

export type PublicParseResponse = {
  success: boolean;
  /**
   * 业务状态码，快捷指令据此判断结果并发送通知：
   *   0   成功（高清，Cookie 有效）
   *   1   成功（标清，Cookie 未配置）
   *   2   成功（标清，Cookie 已失效）
   *   3   成功（标清，Cookie 诊断异常）
   *   100 请求参数错误（缺少 text / URL）
   *   101 不支持的平台
   *   200 解析失败（平台 API 返回错误）
   *   401 API Key 无效或缺失
   */
  code: number;
  message: string;
  notification: string;
  source_url: string | null;
  media: VideoInfo | null;
  downloads: PublicDownloadItem[];
  /** 所有 downloads 项下载时都使用同一个 Referer，快捷指令取这个值加到 Header 里即可。 */
  downloads_referer: string | null;
  task_endpoint: string | null;
  error?: string | null;
};
