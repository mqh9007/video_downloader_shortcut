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
  /** 下载此链接时应在 Referer 头里填的值，快捷指令直接用这个值即可。 */
  referer: string;
};

export type PublicParseResponse = {
  success: boolean;
  message: string;
  notification: string;
  source_url: string | null;
  media: VideoInfo | null;
  downloads: PublicDownloadItem[];
  task_endpoint: string | null;
  error?: string | null;
};
