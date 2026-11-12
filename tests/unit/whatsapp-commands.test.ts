import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseWhatsappCommands, parseWhatsappConsent, parseWhatsappJournal,
} from '../../src/services/adapters/SupabaseWhatsappCommands';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const wash = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const phone = '+2250700000000';

describe('commandes WhatsApp — réponses et confirmation', () => {
  it('transmet le numéro vu pour un accord mais ne l’exige pas pour un retrait', async () => {
    const rpc = vi.fn(async () => ({ data: id, error: null }));
    const commands = new SupabaseWhatsappCommands({ rpc });
    await commands.saveConsent(customer, true, 'Accord au comptoir', phone);
    await commands.saveConsent(customer, false, 'Retrait du client', phone);
    expect(rpc).toHaveBeenNthCalledWith(1, 'save_customer_whatsapp_consent', {
      p_customer_id: customer, p_granted: true, p_source: 'Accord au comptoir', p_expected_phone: phone,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'save_customer_whatsapp_consent', {
      p_customer_id: customer, p_granted: false, p_source: 'Retrait du client', p_expected_phone: null,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/company_id|service_role|access_token/i);
  });

  it('retourne l’identifiant de la demande sans prétendre qu’elle a été livrée', async () => {
    const rpc = vi.fn(async () => ({ data: id, error: null }));
    const commands = new SupabaseWhatsappCommands({ rpc });
    await expect(commands.enqueue(wash, 'ma-cle-idempotente-unique')).resolves.toBe(id);
    expect(rpc).toHaveBeenCalledWith('enqueue_wash_whatsapp', {
      p_wash_id: wash, p_idempotency_key: 'ma-cle-idempotente-unique',
    });
  });

  it.each([null, '', 'pas-un-uuid', {}, 42])('refuse une confirmation RPC invalide : %j', async (data) => {
    const rpc = vi.fn(async () => ({ data, error: null }));
    const commands = new SupabaseWhatsappCommands({ rpc });
    await expect(commands.enqueue(wash, 'ma-cle-idempotente-unique')).rejects.toThrow('identifiant absent');
    await expect(commands.saveConsent(customer, true, 'Accord au comptoir', phone)).rejects.toThrow('identifiant absent');
  });

  it('signale une migration absente sans inventer une réponse', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    const commands = new SupabaseWhatsappCommands({ rpc });
    await expect(commands.consent(customer)).rejects.toThrow('migration et les fonctions serveur');
  });

  it('refuse un consentement actif sans numéro ou date et les journaux mal formés', () => {
    expect(() => parseWhatsappConsent({ granted: true, phone: null, at: '2026-11-12T10:00:00Z', history: [] })).toThrow();
    expect(() => parseWhatsappConsent({ granted: true, phone, at: null, history: [] })).toThrow();
    expect(() => parseWhatsappConsent({ granted: false, phone: null, at: null, history: [] })).not.toThrow();
    expect(() => parseWhatsappJournal(null)).toThrow();
    expect(() => parseWhatsappJournal([{ id, origin: 'manual', status: 'inventé', events: [] }])).toThrow();
  });
});
