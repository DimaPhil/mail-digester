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
