import { VercelRequest, VercelResponse } from '@vercel/node';
import bot from '../src/bot';

function validateRequest(req: VercelRequest): boolean {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.warn('WEBHOOK_SECRET not set');
    return true;
  }
  
  const providedSecret = req.headers['x-webhook-secret'] as string;
  return providedSecret === webhookSecret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Handle GET requests (for Telegram webhook verification)
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Telegram bot is running!',
        env_set: !!process.env.BOT_TOKEN // Optional: check if token is set
      });
    }

    // Only allow POST requests for updates
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    if (!validateRequest(req)) {
      console.error('Invalid webhook request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log('Processing webhook request');
    await bot.handleUpdate(req.body, res);
    return res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
