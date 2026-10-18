// Recognizing video URLs, for turning a pasted one into a player. No
// dependencies.

export type VideoSource =
  // A video on a video site, shown in that site's player. `embedUrl` is built
  // here from the id alone — never taken from the pasted URL — so the player
  // frame can only ever point at these sites.
  // The site's name is editor.video.providers[provider].
  | { kind: "embed"; provider: "youtube" | "vimeo" | "niconico"; embedUrl: string }
  // A link straight to a video file, played by the browser.
  | { kind: "file" };

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;

// "90", "90s", "1m30s", "1h2m3s" → seconds.
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!parts) return 0;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

function youtube(url: URL): VideoSource | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | undefined;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (first === "shorts" || first === "embed" || first === "live") id = second;
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return {
    kind: "embed",
    provider: "youtube",
    // The "nocookie" player doesn't set tracking cookies until it's played.
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ""}`,
  };
}

function vimeo(url: URL): VideoSource | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const index = segments.findIndex((s) => /^\d{6,12}$/.test(s));
  if (index < 0) return null;
  // Unlisted videos carry a key: vimeo.com/<id>/<key>, or ?h=<key>.
  const key = url.searchParams.get("h") ?? segments[index + 1];
  const h = key && /^[0-9a-f]{6,16}$/i.test(key) ? `?h=${key}` : "";
  return { kind: "embed", provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${segments[index]}${h}` };
}

function niconico(url: URL): VideoSource | null {
  const host = url.hostname.replace(/^(www|sp)\./, "");
  let id: string | undefined;
  if (host === "nico.ms") id = url.pathname.split("/")[1];
  else if (host === "nicovideo.jp" && url.pathname.startsWith("/watch/")) id = url.pathname.split("/")[2];
  if (!id || !/^(sm|nm|so)\d{1,12}$/.test(id)) return null;
  return { kind: "embed", provider: "niconico", embedUrl: `https://embed.nicovideo.jp/watch/${id}` };
}

// What kind of video `raw` points to, or null if it isn't one we can play.
export function parseVideoUrl(raw: string): VideoSource | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const embed = youtube(url) ?? vimeo(url) ?? niconico(url);
  if (embed) return embed;
  return VIDEO_FILE.test(url.pathname) ? { kind: "file" } : null;
}
