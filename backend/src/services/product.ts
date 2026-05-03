import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const ProductService = {
  /**
   * Fetches product/service memory for a user
   */
  async getProductMemory(userId: string, productId?: string) {
    let query = supabase
      .from('product_memory')
      .select('*')
      .eq('user_id', userId);
    
    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  /**
   * Saves product details to product_memory table (Backend Version).
   * Includes all new fields: product_type, delivery, contact, payment, video, color, sizes.
   */
  async saveProduct(userId: string, productData: any): Promise<string> {
    const { data, error } = await supabase
      .from('product_memory')
      .insert({
        user_id: userId,
        product_name: productData.name,
        description: productData.description,
        price: parseFloat(productData.price) || 0,
        category: productData.category,
        target_audience: productData.targetAudience,
        original_scan_data: productData.scanResult,
        images: productData.imageUri ? [productData.imageUri] : [],
        // New fields
        product_type: productData.productType || productData.product_type || 'physical',
        delivery_type: productData.deliveryType || productData.delivery_type || null,
        delivery_address: productData.deliveryAddress || productData.delivery_address || null,
        contact_phone: productData.phone || productData.contact_phone || null,
        bank_account_details: productData.bankAccount || productData.bank_account_details || null,
        video_url: productData.videoUrl || productData.video_url || null,
        color: productData.color || null,
        available_sizes: productData.sizes || productData.available_sizes || null,
      })
      .select('product_id')
      .single();

    if (error) throw error;
    return data.product_id;
  },

  /**
   * Update product fields by product_id
   */
  async updateProduct(productId: string, fields: Partial<{
    product_type: string;
    delivery_type: string;
    delivery_address: string;
    contact_phone: string;
    bank_account_details: string;
    video_url: string;
    color: string;
    available_sizes: string[];
  }>): Promise<void> {
    const { error } = await supabase
      .from('product_memory')
      .update(fields)
      .eq('product_id', productId);
    if (error) throw error;
  }
};
