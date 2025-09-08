import fetch from 'node-fetch';

async function checkWebhook() {
  const botToken = process.env.BOT_TOKEN;
  
  if (!botToken) {
    console.error('BOT_TOKEN is required');
    process.exit(1);
  }
  
  console.log('🔍 Checking webhook status...');
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const result = await response.json() as any;
    
    if (result.ok) {
      console.log('✅ Webhook info:');
      console.log('URL:', result.result.url || 'Not set');
      console.log('Has custom certificate:', result.result.has_custom_certificate);
      console.log('Pending update count:', result.result.pending_update_count);
      console.log('Max connections:', result.result.max_connections);
      
      if (result.result.last_error_date) {
        console.log('❌ Last error:', new Date(result.result.last_error_date * 1000));
        console.log('Error message:', result.result.last_error_message);
      }
    } else {
      console.error('❌ Failed to get webhook info:', result);
    }
    
  } catch (error) {
    console.error('❌ Error checking webhook:', error);
  }
}

checkWebhook();