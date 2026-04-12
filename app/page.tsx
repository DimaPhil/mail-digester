export const dynamic = "force-dynamic";

import { InboxClient } from "@/components/inbox-client";
import { getInboxPayload } from "@/lib/inbox/service";

export default async function HomePage() {
  const payload = await getInboxPayload();
  return <InboxClient initialData={payload} />;
}
