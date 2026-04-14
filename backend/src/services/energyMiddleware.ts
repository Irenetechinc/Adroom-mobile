import { Request, Response, NextFunction } from 'express';
import { energyService, OPERATION_COST } from './energyService';
import { creditManagementAgent } from './creditManagementAgent';
import { getSupabaseClient, getServiceSupabaseClient } from '../config/supabase';

const CREDIT_ALERT_THRESHOLDS = [10, 5, 0];

async function sendCreditPushAlert(userId: string, balance: number): Promise<void> {
  try {
    const svc = getServiceSupabaseClient();
    const { data: tokens } = await svc
      .from('device_push_tokens')
      .select('token')
      .eq('user_id', userId)
      .limit(3);

    if (!tokens || tokens.length === 0) return;

    let title: string;
    let body: string;

    if (balance <= 0) {
      title = '⚡ AdRoom Energy Exhausted';
      body = 'Your credits have run out. Your AI campaigns are now paused. Top up to resume.';
    } else if (balance <= 5) {
      title = '⚠️ Critical: Only ' + balance.toFixed(0) + ' credits left';
      body = 'Your AdRoom AI campaigns will pause very soon. Top up now to keep them running.';
    } else {
      title = '🔋 Low Energy Warning — ' + balance.toFixed(0) + ' credits left';
      body = 'Your AdRoom Energy is running low. Top up to ensure uninterrupted campaign execution.';
    }

    const messages = tokens.map((t: any) => ({
      to: t.token,
      title,
      body,
      data: { type: 'credit_alert', balance },
      sound: 'default',
      priority: balance <= 0 ? 'high' : 'normal',
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err: any) {
    console.error('[EnergyMiddleware] Credit alert push failed:', err.message);
  }
}

/**
 * Middleware factory — wraps a route to check & deduct energy before allowing AI usage.
 * Also runs CMA evaluation and attaches the routing decision to req.cmaResult
 * so handlers can pick the right model (economy vs premium).
 * Usage: app.post('/api/ai/generate-strategy', energyCheck('generate_strategy'), handler)
 */
export function energyCheck(operation: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = getSupabaseClient(req);
      const { data: { user }, error: authErr } = await supabase.auth.getUser();

      if (authErr || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // CMA pre-flight: checks tier, daily cap, cooldowns, and picks model
      const cma = await creditManagementAgent.evaluate(user.id, operation);

      if (cma.decision === 'deny_tier') {
        return res.status(403).json({ error: 'PLAN_REQUIRED', message: cma.reason });
      }
      if (cma.decision === 'deny_cap') {
        return res.status(429).json({ error: 'DAILY_CAP_REACHED', message: cma.reason });
      }
      if (cma.decision === 'deny_cooldown') {
        return res.status(429).json({ error: 'COOLDOWN_ACTIVE', message: cma.reason });
      }

      // Balance check using CMA-determined credit cost (may be cheaper than default)
      const check = await energyService.checkEnergy(user.id, operation);
      const effectiveCost = cma.credits;

      if (check.balance < effectiveCost) {
        const op = OPERATION_COST[operation] ?? OPERATION_COST['agent_task'];
        return res.status(402).json({
          error: 'INSUFFICIENT_ENERGY',
          message: `You need ${effectiveCost} energy credits for this action but only have ${check.balance.toFixed(2)}.`,
          balance: check.balance,
          required: effectiveCost,
          deficit: Math.max(0, effectiveCost - check.balance),
          subscription_status: check.subscription_status,
        });
      }

      // Attach user, operation, and CMA result to request for handlers
      (req as any).energyUser    = user;
      (req as any).energyOperation = operation;
      (req as any).cmaResult     = cma;
      next();
    } catch (err: any) {
      console.error('[EnergyMiddleware] Error:', err.message);
      next(); // fail open — let the route handler deal with auth
    }
  };
}

/**
 * Deduct energy AFTER a successful AI call, going through the CMA for routing.
 * Returns the CMA result (includes model used) so callers know which model ran.
 */
export async function deductEnergyForUser(userId: string, operation: string, metadata?: any): Promise<void> {
  try {
    await energyService.deductEnergyWithRouting(userId, operation, metadata);
  } catch (err: any) {
    // Log but don't break the response — the AI call already happened
    console.error(`[EnergyMiddleware] Deduction failed for ${operation}:`, err.message);
  }
}
