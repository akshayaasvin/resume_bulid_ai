import 'server-only';
import { adminClient } from './supabase/admin';
import { mergeConfig, type ConfigKey, CONFIG_DEFAULTS } from './config';

/** Reads a config section (defaults merged with the super_admin override, if any). */
export async function getConfig<K extends ConfigKey>(key: K): Promise<(typeof CONFIG_DEFAULTS)[K]> {
  try {
    const { data } = await adminClient().from('config').select('value').eq('key', key).maybeSingle();
    return mergeConfig(key, data?.value);
  } catch {
    return CONFIG_DEFAULTS[key];
  }
}
