// Development server for local testing
import bot from './bot';

console.log('🤖 Starting Telegram bot in development mode...');

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start bot in polling mode for development
bot.launch().then(() => {
  console.log('✅ Bot started successfully in polling mode');
  console.log('Bot username:', (bot as any).botInfo?.username);
}).catch((error) => {
  console.error('❌ Failed to start bot:', error);
  process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => {
  console.log('Received SIGINT, stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('Received SIGTERM, stopping bot...');
  bot.stop('SIGTERM');
});