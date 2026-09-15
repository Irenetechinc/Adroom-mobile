import { supabase } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;

export interface VideoAssetResult {
  url: string;
  remaining: number;
}

export const VideoAssetService = {
  /**
   * Uploads an actual video file (local URI from expo-image-picker) to storage via the backend.
   * Returns the public URL that can be used for TikTok PULL_FROM_URL publishing.
   */
  async uploadVideoFile(uri: string, mimeType: string, fileName: string): Promise<string> {
    if (!BACKEND_URL) throw new Error('Backend URL is not configured.');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated.');

    const formData = new FormData();
    formData.append('video', {
      uri,
      type: mimeType || 'video/mp4',
      name: fileName || `video_${Date.now()}.mp4`,
    } as any);

    const response = await fetch(`${BACKEND_URL}/api/video/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? 'Video upload failed.');
    }

    return data.url as string;
  },

  /**
   * Generates an AI video asset for the given product.
   * Enforced server-side: Starter = blocked, Pro = 2/period, Pro+ = 4/period.
   * Throws a typed error with `code: 'PLAN_LIMIT_EXCEEDED'` if the plan doesn't allow it.
   */
  async generateVideoAsset(productName: string, prompt?: string): Promise<VideoAssetResult> {
    if (!BACKEND_URL) throw new Error('Backend URL is not configured.');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated.');

    const response = await fetch(`${BACKEND_URL}/api/creative/generate-video-asset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ productName, prompt }),
    });

    const data = await response.json();

    if (!response.ok) {
      const err: any = new Error(data.message ?? data.error ?? 'Video generation failed.');
      err.code = data.error;
      err.plan = data.plan;
      err.remaining = data.remaining;
      throw err;
    }

    return { url: data.url, remaining: data.remaining ?? 0 };
  },
};
