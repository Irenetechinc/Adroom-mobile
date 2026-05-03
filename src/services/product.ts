
import { supabase } from './supabase';
import { RemoteLogger } from './remoteLogger';

export const ProductService = {
  /**
   * Saves product details to product_memory table.
   * Includes all product type, delivery, payment, contact, and media fields.
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
          images: productData.images
            ? productData.images.map((img: { uri: string }) => img.uri)
            : productData.baseImageUri
              ? [productData.baseImageUri]
              : [],
          // Product type & delivery fields
          product_type: productData.productType || 'physical',
          delivery_type: productData.deliveryType || null,
          delivery_address: productData.deliveryAddress || null,
          contact_phone: productData.phone || null,
          bank_account_details: productData.bankAccount || null,
          // Media & extras
          video_url: productData.video?.uri || productData.videoUrl || null,
          color: productData.color || null,
          available_sizes: (productData.sizes && productData.sizes.length > 0) ? productData.sizes : null,
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
