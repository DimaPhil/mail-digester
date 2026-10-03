import { isIP } from "node:net";

function privateIpv4(host: string) {
  const [a, b] = host.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export function isPublicAddress(host: string) {
  const ip = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) return !privateIpv4(ip);
  if (isIP(ip) === 6)
    return (
      /^2[0-9a-f]{3}:/.test(ip) &&
      !ip.startsWith("2001:") &&
      !ip.startsWith("2002:")
    );
  return false;
}
export function safeExternalUrl(input: string): string | null {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(input)) return null;
    const url = new URL(input);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (url.port && !["80", "443"].includes(url.port)) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (isIP(host.replace(/^\[|\]$/g, "")))
      return isPublicAddress(host) ? url.href : null;
    if (
      !host.includes(".") ||
      /(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(host)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
