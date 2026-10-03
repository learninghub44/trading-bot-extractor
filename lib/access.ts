import { createHash } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/** Owner = signed-in user on the order, or holder of the guest cookie issued at checkout. */
export async function canAccessOrder(order: { user_id: string | null; customer_token_hash: string | null } | null) {
  if (!order) return false;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id && order.user_id === user.id) return true;
  const token = (await cookies()).get("tbe_access")?.value;
  if (!token || !order.customer_token_hash) return false;
  return createHash("sha256").update(token).digest("hex") === order.customer_token_hash;
}
