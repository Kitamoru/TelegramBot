import fetch from 'node-fetch';

async function getWebhookInfo() {
  const botToken = process.env.BOT_TOKEN;
  
  if (!botToken) {
    console.error('BOT_TOKEN is required');
    process.exit(1);
  }
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const result = await response.json() as any;
    
    if (result.ok) {
      console.log('📡 Webhook information:');
      console.log(JSON.stringify(result.result, null, 2));
    } else {
      console.error('❌ Failed to get webhook info:', result);
    }
    
  } catch (error) {
    console.error('❌ Error getting webhook info:', error);
  }
}

getWebhookInfo();