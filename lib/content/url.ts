import { cleanText } from "@/lib/utils";

export type CanonicalUrlResult = {
  trackedUrl: string;
  canonicalUrl: string | null;
  needsNetworkResolution: boolean;
};

const STRIP_QUERY_PREFIXES = [
  "utm_",
  "mc_",
  "fbclid",
  "gclid",
  "ref",
  "ref_src",
];

export function canonicalizeUrl(input: string) {
  const url = new URL(input);
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (STRIP_QUERY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      url.searchParams.delete(key);
    }
  }

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = url.searchParams.toString()
    ? `?${url.searchParams.toString()}`
    : "";

  return url.toString();
}

function extractEmbeddedTrackingUrl(input: URL) {
  const marker = "/CL0/";
  const index = input.pathname.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const encoded = input.pathname.slice(index + marker.length);
  const beforeMetadata = encoded.split("/1/")[0];
  return decodeURIComponent(beforeMetadata);
}

export function normalizeTrackedUrl(rawUrl: string): CanonicalUrlResult {
  const trackedUrl = cleanText(rawUrl);
  if (!trackedUrl) {
    return {
      trackedUrl,
      canonicalUrl: null,
      needsNetworkResolution: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trackedUrl);
  } catch {
    return {
      trackedUrl,
      canonicalUrl: null,
      needsNetworkResolution: false,
    };
  }

  if (parsed.hostname === "tracking.tldrnewsletter.com") {
    const embedded = extractEmbeddedTrackingUrl(parsed);
    if (!embedded) {
      return {
        trackedUrl,
        canonicalUrl: canonicalizeUrl(trackedUrl),
        needsNetworkResolution: false,
      };
    }

    return normalizeTrackedUrl(embedded);
  }

  if (parsed.hostname === "links.tldrnewsletter.com") {
    return {
      trackedUrl,
      canonicalUrl: canonicalizeUrl(trackedUrl),
      needsNetworkResolution: true,
    };
  }

  return {
    trackedUrl,
    canonicalUrl: canonicalizeUrl(trackedUrl),
    needsNetworkResolution: false,
  };
}
