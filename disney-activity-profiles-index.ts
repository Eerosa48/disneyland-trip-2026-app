// Deploy as a NEW Edge Function named: disney-activity-profiles
// Private visitor-group persistence for Greyson's Disney Trip.
// No changes to the existing reporting, ingestion, or historical records.
import { withSupabase } from 'npm:@supabase/server@^1';

const TABLE = 'activity_visitor_profile_links';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'private, no-store' }
});
const invalid = (message: string) => json({ ok: false, error: message }, 400);

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'GET' && req.method !== 'POST')
      return json({ ok: false, error: 'Method not allowed' }, 405);

    const adminId = Deno.env.get('DISNEY_ACTIVITY_ADMIN_USER_ID');
    if (!adminId) return json({ ok: false, error: 'Administrator not configured' }, 503);
    if (ctx.userClaims?.id !== adminId)
      return json({ ok: false, error: 'Access denied' }, 403);

    const db = ctx.supabaseAdmin;
    if (!db) return json({ ok: false, error: 'Database unavailable' }, 503);

    const getLinks = async () => {
      const { data, error } = await db.from(TABLE)
        .select('visitor_id,group_id,group_label').limit(1000);
      if (error) throw new Error('Could not retrieve profile links');
      return data ?? [];
    };

    try {
      if (req.method === 'GET') return json({ ok: true, links: await getLinks() });

      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > 8000) return invalid('Request too large');
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
        if (!body || Array.isArray(body) || typeof body !== 'object') throw 0;
      } catch { return invalid('Invalid JSON request'); }

      if (body.action === 'merge') {
        if (!Array.isArray(body.visitorIds) || body.visitorIds.length < 2 ||
            body.visitorIds.length > 100 ||
            !body.visitorIds.every(id => typeof id === 'string' && UUID.test(id))) {
          return invalid('Choose at least two valid tracking identities');
        }
        const ids: string[] = Array.from(new Set(body.visitorIds as string[]));
        if (ids.length < 2) return invalid('Choose at least two different identities');
        const label = typeof body.label === 'string' ? body.label.trim() : '';
        if (!label || [...label].length > 80 || /[\u0000-\u001f\u007f]/.test(label))
          return invalid('Enter a profile name (1–80 characters)');

        // Validate identities before any changes.
        const found = await db.from('activity_visitors').select('visitor_id').in('visitor_id', ids);
        if (found.error || (found.data ?? []).length !== ids.length)
          return invalid('One or more identities no longer exist');

        // Include ALL members of any previously linked groups, even if they
        // are outside the dashboard's current 100-record report window.
        const current = await db.from(TABLE)
          .select('visitor_id,group_id').in('visitor_id', ids);
        if (current.error) throw new Error('Unable to read existing profile links');
        const groupIds: string[] = Array.from(new Set(
          (current.data ?? []).map((row: {group_id: string}) => row.group_id)
        ));
        if (groupIds.length) {
          const existing = await db.from(TABLE)
            .select('visitor_id').in('group_id', groupIds).limit(1000);
          if (existing.error) throw new Error('Unable to read linked identities');
          for (const row of existing.data ?? []) ids.push(row.visitor_id);
        }
        const mergedIds = Array.from(new Set(ids));
        if (mergedIds.length > 1000) return invalid('Too many linked identities');
        const groupId = crypto.randomUUID();
        const updatedAt = new Date().toISOString();
        const rows = mergedIds.map(visitor_id => ({
          visitor_id, group_id: groupId, group_label: label, updated_at: updatedAt
        }));
        const saved = await db.from(TABLE).upsert(rows, { onConflict: 'visitor_id' });
        if (saved.error) throw new Error('Unable to save profile merge');
        return json({ ok: true, links: await getLinks() });
      }

      if (body.action === 'separate') {
        if (typeof body.visitorId !== 'string' || !UUID.test(body.visitorId))
          return invalid('Invalid visitor identity');
        const found = await db.from('activity_visitors')
          .select('visitor_id').eq('visitor_id', body.visitorId).maybeSingle();
        if (found.error || !found.data) return invalid('Visitor identity was not found');
        // A new unique override keeps this identity separate from same-name
        // automatic groups, without touching sessions or events.
        const saved = await db.from(TABLE).upsert({
          visitor_id: body.visitorId,
          group_id: crypto.randomUUID(),
          group_label: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'visitor_id' });
        if (saved.error) throw new Error('Unable to separate profile');
        return json({ ok: true, links: await getLinks() });
      }
      return invalid('Unknown profile management action');
    } catch (_error) {
      console.error('Profile management operation failed');
      return json({ ok: false, error: 'Unable to save visitor profile changes' }, 500);
    }
  })
};
