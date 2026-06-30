import { createD1DbClient } from "@/lib/db/client";

export function createDbServerClient(options?: { currentUserId?: string | null }) {
  return createD1DbClient(options);
}
