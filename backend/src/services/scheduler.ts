import cron from 'node-cron';
import dotenv from 'dotenv';
import { PlatformIntelligenceEngine } from './ipeEngine';
import { SocialListeningEngine } from './socialListening';
import { EmotionalIntelligenceEngine } from './emotionalIntelligence';
import { GeoMonitoringEngine } from './geoMonitoring';
import { DecisionEngine } from './decisionEngine';
import { ScraperService } from './scraperService';
import { getServiceSupabaseClient } from '../config/supabase';

dotenv.config();

const SCHED_IPE_CRON = process.env.SCHED_IPE_CRON || '*/15 * * * *';
const SCHED_SOCIAL_CRON = process.env.SCHED_SOCIAL_CRON || '*/15 * * * *';
const SCHED_EMOTIONAL_CRON = process.env.SCHED_EMOTIONAL_CRON || '*/15 * * * *';
const SCHED_GEO_CRON = process.env.SCHED_GEO_CRON || '*/15 * * * *';
const SCHED_SCRAPE_CRON = process.env.SCHED_SCRAPE_CRON || '*/15 * * * *';

export class SchedulerService {
  private ipe: PlatformIntelligenceEngine;
  private social: SocialListeningEngine;
  private emotional: EmotionalIntelligenceEngine;
  private geo: GeoMonitoringEngine;
  private scraper: ScraperService;
  private decisionEngine: DecisionEngine;

  constructor() {
    this.ipe = new PlatformIntelligenceEngine();
    this.social = new SocialListeningEngine();
    this.emotional = new EmotionalIntelligenceEngine();
    this.geo = new GeoMonitoringEngine();
    this.scraper = new ScraperService();
    this.decisionEngine = new DecisionEngine();
  }

  start() {
    console.log('Starting AdRoom Intelligence Scheduler...');

    cron.schedule(SCHED_IPE_CRON, async () => {
      console.log('[Scheduler] Running Platform Intelligence...');
      const result = await this.ipe.runCycle();
      if (result && result.alerts && result.alerts.length > 0) {
          await this.notifyBrain('platform', result.alerts);
      }
    });

    cron.schedule(SCHED_SOCIAL_CRON, async () => {
      console.log('[Scheduler] Running Social Listening...');
      const result = await this.social.runCycle();
      if (result && result.alerts && result.alerts.length > 0) {
          await this.notifyBrain('social', result.alerts);
      }
      
      if (result && result.conversations && result.conversations.length > 0) {
          await this.runEmotionalCycle();
      }
    });

    cron.schedule(SCHED_EMOTIONAL_CRON, async () => {
       await this.runEmotionalCycle();
    });

    cron.schedule(SCHED_GEO_CRON, async () => {
      console.log('[Scheduler] Running GEO Monitoring...');
      const result = await this.geo.runCycle();
      if (result && result.alerts && result.alerts.length > 0) {
          await this.notifyBrain('geo', result.alerts);
      }
    });

    cron.schedule(SCHED_SCRAPE_CRON, async () => {
      console.log('[Scheduler] Running Website Auto-Update Scrape...');
      const supabase = getServiceSupabaseClient();
      const { data: products } = await supabase
        .from('product_memory')
        .select('website_url, user_id')
        .not('website_url', 'is', null);

      if (products) {
          for (const p of products) {
              if (p.website_url) await this.scraper.scrapeWebsite(p.website_url, p.user_id);
          }
      }
    });

    console.log('Scheduler started successfully.');
  }

  private async runEmotionalCycle() {
      console.log('[Scheduler] Triggering Emotional Analysis...');
      const result = await this.emotional.runCycle();
      if (result && result.alerts && result.alerts.length > 0) {
          await this.notifyBrain('emotional', result.alerts);
      }
  }

  private async notifyBrain(source: string, alerts: any[]) {
      console.log(`[ALERT] AI Brain received ${alerts.length} alerts from ${source}`);
      await this.decisionEngine.handleAlert(source, alerts);
  }
}
