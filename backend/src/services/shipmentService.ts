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

  async dispatchShipment(shipmentId: string): Promise<any> {
    if (!PROVIDER || !API_URL || !API_KEY) throw new Error('Shipment provider is not configured. Set SHIPMENT_PROVIDER, SHIPMENT_API_URL, and SHIPMENT_API_KEY.');
    const { data: shipment } = await this.supabase.from('shipments').select('*').eq('id', shipmentId).single();
    if (!shipment || shipment.product_type !== 'physical') throw new Error('Only physical shipments can be dispatched.');
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
    const trackingNumber = data.tracking_number || data.tracking_id || null;
    await this.supabase.from('shipments').update({
      carrier: PROVIDER,
      tracking_number: trackingNumber,
      status: 'dispatch_requested',
      tracking_events: [{ status: 'dispatch_requested', at: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
      pickup_details: { ...(shipment.pickup_details || {}), provider_id: providerId },
    }).eq('id', shipmentId);
    await pushService.send(shipment.user_id, {
      title: 'Dispatch arranged',
      body: shipment.pickup_details?.dropoff_address
        ? `Please take the product to ${shipment.pickup_details.dropoff_address}. Open Adirum AI to confirm handover.`
        : 'A dispatch agent is scheduled to collect your product. Open Adirum AI to confirm handover.',
      data: { type: 'shipment_dispatch', shipment_id: shipmentId, screen: 'AgentChat' },
    });
    return { provider: PROVIDER, providerId, trackingNumber };
  }

  verifyWebhook(signature: string, rawBody: string): boolean {
    if (!WEBHOOK_SECRET || !signature) return false;
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }

  async applyWebhook(payload: any) {
    const shipmentId = payload.reference || payload.shipment_id || payload.id;
    if (!shipmentId) return;
    const status = String(payload.status || payload.event || 'updated').toLowerCase();
    const { data: shipment } = await this.supabase.from('shipments').select('user_id').eq('id', shipmentId).single();
    await this.supabase.from('shipments').update({
      status,
      tracking_number: payload.tracking_number || payload.tracking_id || undefined,
      tracking_events: [{ status, at: new Date().toISOString(), location: payload.location || null }],
      updated_at: new Date().toISOString(),
    }).eq('id', shipmentId);
    if (shipment?.user_id) await pushService.send(shipment.user_id, {
      title: 'Shipment update',
      body: `Your shipment status is now ${status.replace(/_/g, ' ')}.`,
      data: { type: 'shipment_update', shipment_id: shipmentId, screen: 'Shipments' },
    });
  }
}

export const shipmentService = new ShipmentService();
