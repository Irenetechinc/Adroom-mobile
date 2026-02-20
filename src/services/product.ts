
import { supabase } from './supabase';
import { RemoteLogger } from './remoteLogger';

export const ProductService = {
  /**
   * Saves product details to product_memory table.
   */
  async saveProduct(productData: any): Promise<string> {
    RemoteLogger.log('PRODUCT', 'Saving product data');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('product_memory')
        .insert({
          user_id: user.id,
          product_name: productData.name,
          description: productData.description,
          price: parseFloat(productData.price) || 0,
          category: productData.category,
          target_audience: productData.targetAudience,
          original_scan_data: productData.scanResult,
          images: productData.imageUri ? [productData.imageUri] : [],
          // Other fields map directly or are optional
        })
        .select('product_id')
        .single();

      if (error) {
        console.error('Product Save Error:', error);
        throw new Error(error.message);
      }

      RemoteLogger.log('PRODUCT', `Product saved with ID: ${data.product_id}`);
      return data.product_id;
    } catch (error: any) {
      RemoteLogger.error('PRODUCT', 'Save Failed', error);
      throw error;
    }
  }
};
