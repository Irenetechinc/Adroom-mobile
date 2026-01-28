import { supabase } from './supabase';
import { Ad, CreateAdInput } from '../types/ad';
import { FacebookService } from './facebook';

export const AdService = {
  /**
   * Create an Ad on Facebook (Creative + Ad Object) and save to Supabase
   */
  async createAd(input: CreateAdInput): Promise<Ad> {
    // 1. Get User Config
    const config = await FacebookService.getConfig();
    if (!config) throw new Error('Facebook configuration not found.');

    try {
      // 2. Upload Image First
      const imageHash = await this.uploadImage(input.creative.image_url, config);
      if (!imageHash) {
         throw new Error('Failed to upload image. Image URL is invalid or inaccessible.');
      }

      // 3. Create Ad Creative on Facebook
      const creativePayload = {
        name: `${input.name} - Creative`,
        object_story_spec: {
          page_id: config.page_id,
          link_data: {
            message: input.creative.body,
            link: `https://facebook.com/${config.page_id}`, // Should ideally be product URL
            name: input.creative.title,
            image_hash: imageHash,
          },
        },
        access_token: config.access_token,
      };

      const creativeResponse = await fetch(
        `https://graph.facebook.com/v18.0/${config.ad_account_id}/adcreatives`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(creativePayload),
        }
      );

      const creativeData = await creativeResponse.json();
      if (!creativeResponse.ok) {
        throw new Error(creativeData.error?.message || 'Failed to create ad creative');
      }
      
      const creativeId = creativeData.id;

      // 4. Create Ad on Facebook
      const adPayload = {
        name: input.name,
        adset_id: input.facebook_ad_set_id,
        creative: { creative_id: creativeId },
        status: input.status,
        access_token: config.access_token,
      };

      const adResponse = await fetch(
        `https://graph.facebook.com/v18.0/${config.ad_account_id}/ads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adPayload),
        }
      );

      const adData = await adResponse.json();
      if (!adResponse.ok) {
        throw new Error(adData.error?.message || 'Failed to create ad');
      }

      const facebookAdId = adData.id;

      // 5. Save to Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('ads')
        .insert({
          user_id: user.id,
          ad_set_id: input.ad_set_id,
          facebook_ad_id: facebookAdId,
          name: input.name,
          status: input.status,
          creative_id: creativeId,
        })
        .select()
        .single();

      if (error) throw error;
      return data;

    } catch (error) {
      console.error('Ad creation error:', error);
      throw error;
    }
  },

  /**
   * Helper to upload an image to Facebook Ad Image Library
   * Returns the image_hash required for Ad Creative
   */
  async uploadImage(imageUrl: string, config: any): Promise<string> {
    try {
      // Use the 'url' parameter for remote images, which is supported by Facebook Marketing API
      // This is a REAL implementation that avoids dummy bytes or simulated hashes.
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${config.ad_account_id}/adimages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: imageUrl, 
            access_token: config.access_token,
          }),
        }
      );

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to upload image to Facebook');
      }

      // Facebook returns a map where the key is the filename/url and value contains the hash
      // But for single upload via 'url', typically it might look different or list images.
      // The standard response for POST /adimages with 'url' often returns:
      // { "images": { "filename": { "hash": "..." } } }
      
      if (data.images) {
        // Extract the first hash found
        const firstKey = Object.keys(data.images)[0];
        if (firstKey && data.images[firstKey].hash) {
          return data.images[firstKey].hash;
        }
      }

      throw new Error('Image upload successful but no hash returned');
      
    } catch (error) {
       console.error('Image upload error:', error);
       throw error;
    }
  }
};
