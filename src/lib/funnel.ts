import 'server-only';
import { adminClient } from './supabase/admin';

export type FunnelEvent =
  | 'registered' | 'profile_completed' | 'test_started' | 'test_submitted'
  | 'verified_resume' | 'notification_yes' | 'notification_no' | 'applied' | 'training_interest'
  | 'internship_interest';

/** Fire-and-forget analytics; never blocks or fails the user's request. */
export async function track(profileId: string | null, event: FunnelEvent, meta: Record<string, unknown> = {}) {
  try {
    await adminClient().from('funnel_events').insert({ profile_id: profileId, event, meta });
  } catch {
    /* analytics must never break the product */
  }
}
