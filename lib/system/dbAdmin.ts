import "server-only";

import { createDbAdminClient } from "@/lib/db/admin";

export function dbAdmin() {
  return createDbAdminClient();
}
