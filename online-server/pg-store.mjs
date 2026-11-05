import cloudbase from '@cloudbase/node-sdk';

const BUSINESS_ERRORS = ['invalid_account', 'invalid_match', 'already_in_match', 'result_conflict', 'same_player'];

export function createPGStore({ env = process.env.TCB_ENV, apiKey = process.env.CLOUDBASE_APIKEY, scope = 'live' } = {}) {
  if (!env || !apiKey) throw new Error('storage_unavailable');
  const db = cloudbase.init({ env, accessKey: apiKey }).rdb();
  return {
    async operation(action, payload = {}) {
      try {
        const { data, error } = await db.rpc('ah_operation', { p_scope: scope, p_action: action, p_payload: payload });
        if (error) throw error;
        return data;
      } catch (error) {
        const message = String(error?.message || '');
        throw new Error(BUSINESS_ERRORS.find(code => message.includes(code)) || 'storage_unavailable');
      }
    },
  };
}
