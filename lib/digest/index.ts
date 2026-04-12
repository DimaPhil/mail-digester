import type { DigestSource } from "@/lib/digest/types";
import { TldrDigestSource } from "@/lib/digest/tldr";
import type { ProviderMessage } from "@/lib/mail/types";

const SOURCES: DigestSource[] = [new TldrDigestSource()];

export function pickDigestSource(message: ProviderMessage) {
  return SOURCES.find((source) => source.matches(message)) ?? null;
}
