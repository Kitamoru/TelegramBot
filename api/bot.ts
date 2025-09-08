import { VercelRequest, VercelResponse } from '@vercel/node';
// import { webhookCallback } from 'telegraf';
import bot from '../src/bot';

// Validate webhook (basic security)
function validateRequest(req: VercelRequest): boolean {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.warn('WEBHOOK_SECRET not set');
    return true; // Allow if no secret is set
  }
  
  const providedSecret = req.headers['x-webhook-secret'] as string;
  return providedSecret === webhookSecret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Validate request
    if (!validateRequest(req)) {
      console.error('Invalid webhook request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log('Processing webhook request');
    
    // Handle the webhook directly
    await bot.handleUpdate(req.body);
    return res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}