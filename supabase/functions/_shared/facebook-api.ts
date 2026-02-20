
export const FacebookAdsApi = {
  baseUrl: 'https://graph.facebook.com/v19.0',

  async getCampaignInsights(accessToken: string, adAccountId: string, campaignId?: string) {
    // specific campaign or account level
    const level = campaignId ? 'campaign' : 'account';
    const filtering = campaignId ? `&filtering=[{field:"campaign.id",operator:"EQUAL",value:"${campaignId}"}]` : '';
    
    const url = `${this.baseUrl}/${adAccountId}/insights?fields=spend,impressions,clicks,cpc,cpm,cpp,ctr,actions,action_values,roas&date_preset=today&level=${level}${filtering}&access_token=${accessToken}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`FB API Error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    return data.data?.[0] || null; // Insights returns an array
  },

  async postContent(accessToken: string, pageId: string, message: string, imageUrl?: string) {
      const endpoint = imageUrl ? 'photos' : 'feed';
      const url = `${this.baseUrl}/${pageId}/${endpoint}`;
      
      const body: any = {
          access_token: accessToken,
          message: message,
      };
      
      if (imageUrl) body.url = imageUrl;

      const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
      });

      if (!response.ok) {
          const error = await response.json();
          throw new Error(`FB Post Error: ${error.error?.message}`);
      }

      return await response.json();
  },

  async updateCampaign(accessToken: string, campaignId: string, updates: any) {
      const url = `${this.baseUrl}/${campaignId}`;
      
      const body: any = {
          access_token: accessToken,
          ...updates
      };

      const response = await fetch(url, {
          method: 'POST', // FB Graph API uses POST for updates
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
      });

      if (!response.ok) {
          const error = await response.json();
          throw new Error(`FB Update Error: ${error.error?.message}`);
      }

      return await response.json();
  }
};
