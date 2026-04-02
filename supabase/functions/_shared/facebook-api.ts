export const FacebookApi = {
  baseUrl: 'https://graph.facebook.com/v19.0',

  async postContent(accessToken: string, pageId: string, message: string, imageUrl?: string) {
    const endpoint = imageUrl ? 'photos' : 'feed';
    const url = `${this.baseUrl}/${pageId}/${endpoint}`;

    const body: any = {
      access_token: accessToken,
      message,
    };

    if (imageUrl) body.url = imageUrl;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`FB Post Error: ${error.error?.message}`);
    }

    return await response.json();
  },
};
