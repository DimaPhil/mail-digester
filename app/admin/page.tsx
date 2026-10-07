export const dynamic = "force-dynamic";
import { AdminKeys } from "@/components/admin-keys";
import { listApiKeys } from "@/lib/api/keys";
export default function AdminPage() {
  return <AdminKeys initialKeys={listApiKeys()} />;
}
