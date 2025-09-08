import fetch from 'node-fetch';

async function setWebhook() {
  const botToken = process.env.BOT_TOKEN;
  const vercelUrl = process.env.VERCEL_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (!botToken) {
    console.error('BOT_TOKEN is required');
    process.exit(1);
  }
  
  if (!vercelUrl) {
    console.error('VERCEL_URL is required');
    process.exit(1);
  }
  
  const webhookUrl = `https://${vercelUrl}/api/bot`;
  
  console.log(`Setting webhook to: ${webhookUrl}`);
  
  try {
    const params = new URLSearchParams({
      url: webhookUrl,
      max_connections: '100',
      drop_pending_updates: 'true'
    });
    
    if (webhookSecret) {
      params.append('secret_token', webhookSecret);
    }
    
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params
    });
    
    const result = await response.json() as any;
    
    if (result.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('Webhook URL:', webhookUrl);
    } else {
      console.error('❌ Failed to set webhook:', result);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error setting webhook:', error);
    process.exit(1);
  }
}

setWebhook();