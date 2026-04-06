import { Request, Response, NextFunction } from 'express';
import { energyService, OPERATION_COST } from './energyService';
import { getSupabaseClient } from '../config/supabase';

/**
 * Middleware factory — wraps a route to check & deduct energy before allowing AI usage.
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

      const check = await energyService.checkEnergy(user.id, operation);

      if (!check.allowed) {
        const op = OPERATION_COST[operation] || OPERATION_COST['agent_task'];
        return res.status(402).json({
          error: 'INSUFFICIENT_ENERGY',
          message: `You need ${op.credits} energy credits for this action but only have ${check.balance.toFixed(2)}.`,
          balance: check.balance,
          required: check.required,
          deficit: check.deficit,
          subscription_status: check.subscription_status,
        });
      }

      // Attach user and energy info to request for handlers
      (req as any).energyUser = user;
      (req as any).energyOperation = operation;
      next();
    } catch (err: any) {
      console.error('[EnergyMiddleware] Error:', err.message);
      next(); // fail open — let the route handler deal with auth
    }
  };
}

/**
 * Deduct energy AFTER a successful AI call. Call this inside your route handler.
 */
export async function deductEnergyForUser(userId: string, operation: string, metadata?: any): Promise<void> {
  try {
    await energyService.deductEnergy(userId, operation, metadata);
  } catch (err: any) {
    // Log but don't break the response — the AI call already happened
    console.error(`[EnergyMiddleware] Deduction failed for ${operation}:`, err.message);
  }
}
