import "server-only";

import { createD1DbClient } from "@/lib/db/client";

export function createDbAdminClient() {
  return createD1DbClient();
}

export const dbAdmin = createDbAdminClient;
