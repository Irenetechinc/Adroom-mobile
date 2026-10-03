import crypto from 'crypto';
import fetch from 'node-fetch';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';

const PROVIDER = process.env.SHIPMENT_PROVIDER || '';
const API_URL = (process.env.SHIPMENT_API_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SHIPMENT_API_KEY || '';
const WEBHOOK_SECRET = process.env.SHIPMENT_WEBHOOK_SECRET || '';

export class ShipmentService {
  private supabase = getServiceSupabaseClient();

  static getConfigurationStatus() {
    const dispatchMissing = [
      !PROVIDER && 'SHIPMENT_PROVIDER',
      !API_URL && 'SHIPMENT_API_URL',
      !API_KEY && 'SHIPMENT_API_KEY',
    ].filter(Boolean) as string[];
    return {
      dispatchReady: dispatchMissing.length === 0,
      trackingWebhooksReady: dispatchMissing.length === 0 && Boolean(WEBHOOK_SECRET),
      missingDispatchKeys: dispatchMissing,
      missingTrackingKeys: [...dispatchMissing, ...(!WEBHOOK_SECRET ? ['SHIPMENT_WEBHOOK_SECRET'] : [])],
    };
  }

  async dispatchShipment(shipmentId: string): Promise<any> {
    if (!ShipmentService.getConfigurationStatus().dispatchReady) {
      throw new Error('Shipment provider is not configured. Set SHIPMENT_PROVIDER, SHIPMENT_API_URL, and SHIPMENT_API_KEY.');
    }
    const { data: shipment, error: readError } = await this.supabase.from('shipments').select('*').eq('id', shipmentId).single();
    if (readError) throw new Error(`Could not load shipment: ${readError.message}`);
    if (!shipment || shipment.product_type !== 'physical') throw new Error('Only physical shipments can be dispatched.');
    if (!shipment.pickup_address || String(shipment.pickup_address).trim().length < 10) {
      throw new Error('A complete pickup address is required before dispatch.');
    }
    if (!shipment.delivery_address || String(shipment.delivery_address).trim().length < 10) {
      throw new Error('A complete delivery address is required before dispatch. Add it in Orders & Shipping.');
    }
    if (shipment.pickup_details?.provider_id && shipment.status !== 'awaiting_dispatch') {
      return {
        provider: shipment.carrier || PROVIDER,
        providerId: shipment.pickup_details.provider_id,
        trackingNumber: shipment.tracking_number || null,
        alreadyDispatched: true,
      };
    }
    const response = await fetch(`${API_URL}/shipments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': shipmentId },
      body: JSON.stringify({
        reference: shipment.id,
        pickup_address: shipment.pickup_address,
        delivery_address: shipment.delivery_address,
        pickup_details: shipment.pickup_details,
      }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || `Shipment provider failed (${response.status})`);
    const providerId = data.id || data.shipment_id || data.reference;
    if (!providerId) throw new Error('Shipment provider response is missing id, shipment_id, or reference.');
    const trackingNumber = data.tracking_number || data.tracking_id || null;
    const trackingEvents = Array.isArray(shipment.tracking_events) ? shipment.tracking_events : [];
    const { error: updateError } = await this.supabase.from('shipments').update({
      carrier: PROVIDER,
      tracking_number: trackingNumber,
      status: 'dispatch_requested',
      tracking_events: [...trackingEvents, { status: 'dispatch_requested', at: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
      pickup_details: { ...(shipment.pickup_details || {}), provider_id: providerId },
    }).eq('id', shipmentId);
    if (updateError) throw new Error(`Provider accepted the shipment, but its local status could not be saved: ${updateError.message}`);
    try {
      await pushService.send(shipment.user_id, {
        title: 'Dispatch arranged',
        body: shipment.pickup_details?.dropoff_address
          ? `Please take the product to ${shipment.pickup_details.dropoff_address}. Open Adirum AI to confirm handover.`
          : 'A dispatch agent is scheduled to collect your product. Open Adirum AI to confirm handover.',
        data: { type: 'shipment_dispatch', shipment_id: shipmentId, screen: 'AgentChat' },
      });
    } catch (error: any) {
      console.error(`[Shipment] Could not send dispatch notification: ${error.message}`);
    }
    return { provider: PROVIDER, providerId, trackingNumber };
  }

  verifyWebhook(signature: string, rawBody: string): boolean {
    if (!WEBHOOK_SECRET || !signature) return false;
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = Buffer.from(digest, 'hex');
    const received = Buffer.from(signature, 'hex');
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  async applyWebhook(payload: any) {
    const providerReference = String(payload.reference || payload.client_reference || payload.shipment_id || payload.id || '');
    if (!providerReference) throw new Error('Shipment webhook is missing a shipment reference.');

    let shipment: any = null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerReference)) {
      const { data, error } = await this.supabase.from('shipments').select('*').eq('id', providerReference).maybeSingle();
      if (error) throw new Error(`Could not find shipment: ${error.message}`);
      shipment = data;
    }
    if (!shipment) {
      const { data, error } = await this.supabase
        .from('shipments')
        .select('*')
        .contains('pickup_details', { provider_id: providerReference })
        .maybeSingle();
      if (error) throw new Error(`Could not find provider shipment: ${error.message}`);
      shipment = data;
    }
    if (!shipment) throw new Error('Shipment webhook reference did not match a known shipment.');

    const status = String(payload.status || payload.event || 'updated').toLowerCase().slice(0, 80);
    const trackingEvents = Array.isArray(shipment.tracking_events) ? shipment.tracking_events : [];
    const eventId = payload.event_id || payload.tracking_event_id || null;
    const isDuplicate = eventId && trackingEvents.some((event: any) => event?.provider_event_id === eventId);
    if (isDuplicate) return;
    const event = {
      status,
      at: payload.timestamp || new Date().toISOString(),
      location: payload.location || null,
      ...(eventId ? { provider_event_id: eventId } : {}),
    };
    const { error: updateError } = await this.supabase.from('shipments').update({
      status,
      tracking_number: payload.tracking_number || payload.tracking_id || undefined,
      tracking_events: [...trackingEvents, event],
      updated_at: new Date().toISOString(),
    }).eq('id', shipment.id);
    if (updateError) throw new Error(`Could not save shipment tracking update: ${updateError.message}`);
    if (shipment.user_id) {
      try {
        await pushService.send(shipment.user_id, {
          title: 'Shipment update',
          body: `Your shipment status is now ${status.replace(/_/g, ' ')}.`,
          data: { type: 'shipment_update', shipment_id: shipment.id, screen: 'Shipments' },
        });
      } catch (error: any) {
        console.error(`[Shipment] Could not send tracking notification: ${error.message}`);
      }
    }
  }
}

export const shipmentService = new ShipmentService();
