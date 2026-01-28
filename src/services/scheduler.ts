import { FacebookService } from './facebook';
import { ContentModerationService } from './moderation';
import { IntegrityService } from './integrity';
import { AutonomousService } from './autonomous';
import { CreativeService } from './creative';
import { useAgentStore } from '../store/agentStore';

export const SchedulerService = {
  /**
   * Check if a daily post is needed and execute.
   * Amends the strategy if "Daily Posting" is required but not present.
   */
  async checkAndExecuteDailyPost(pageId: string, strategyContext: any): Promise<void> {
    const config = await FacebookService.getConfig();
    if (!config) return;

    // 1. Get Active Strategy from Store
    const { activeStrategy, updateActiveStrategy } = useAgentStore.getState();
    
    // Safety: Must have an approved strategy to start
    if (!activeStrategy) {
       console.log('[Scheduler] No active strategy found. Waiting for user approval.');
       return;
    }

    let strategyToUse = activeStrategy;

    // 2. Check Alignment: Does strategy include "Daily Post"?
    if (!strategyToUse.actions.includes('Daily Post')) {
       console.log('[Scheduler] Strategy missing Daily Post action. Initiating autonomous amendment...');
       strategyToUse = await AutonomousService.amendStrategy(activeStrategy, 'ADD_DAILY_POST');
       updateActiveStrategy(strategyToUse);
       console.log('[Scheduler] Strategy amended and updated.');
    }

    // 3. Check last post time
    const feedResponse = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/feed?limit=1&access_token=${config.access_token}`
    );
    const feedData = await feedResponse.json();
    
    let shouldPost = true;
    if (feedData.data && feedData.data.length > 0) {
      const lastPostTime = new Date(feedData.data[0].created_time).getTime();
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      if (lastPostTime > oneDayAgo) {
        shouldPost = false;
        console.log('[Scheduler] Daily post already exists for today.');
      }
    }

    if (shouldPost) {
      await this.createDailyContent(pageId, config.access_token, strategyContext, strategyToUse);
    }
  },

  async createDailyContent(pageId: string, accessToken: string, context: any, strategy: any): Promise<void> {
    // 1. Generate Content Aligned with Strategy using Real AI
    const productName = context.productName || 'our brand';
    const tone = strategy.brandVoice || 'Professional';
    
    // Use Real Creative Service (OpenAI) -> This now calls IntegrityService internally too
    const copy = await CreativeService.generateCopy(productName, tone, 'AWARENESS');
    
    const content = `${copy.body}\n\n#${productName.replace(/\s/g, '')} #${tone} #DailyUpdate`;
    
    // 2. INTEGRITY & MODERATION CHECK (Double Layer)
    // First, check for placeholders/spelling in the assembled content
    const integrity = await IntegrityService.validateAndFixContent(content);
    if (!integrity.isValid) {
      console.warn('Daily post blocked by Integrity Service:', integrity.issues);
      return;
    }

    const finalContent = integrity.cleanedText || content;

    // Second, check for Policy/Moderation (Safety)
    const moderation = await ContentModerationService.analyzeContent(finalContent);
    if (!moderation.isSafe) {
      console.warn('Daily post blocked by Moderation Service:', moderation.issues);
      return;
    }

    // 3. Post to Page
    try {
      await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/feed`,
        {
          method: 'POST',
          body: JSON.stringify({ 
            message: finalContent,
            access_token: accessToken 
          }),
          headers: { 'Content-Type': 'application/json' }
        }
      );
      console.log('Daily autonomous post published aligned with strategy.');
      
      // 4. Log this action via AutonomousService
      await AutonomousService.executeOrganicStrategy(strategy);

    } catch (error) {
      console.error('Daily post failed:', error);
    }
  }
};
