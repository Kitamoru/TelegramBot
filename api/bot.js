"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const bot_1 = __importDefault(require("../src/bot"));
// Validate webhook (basic security)
function validateRequest(req) {
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.warn('WEBHOOK_SECRET not set');
        return true; // Allow if no secret is set
    }
    const providedSecret = req.headers['x-webhook-secret'];
    return providedSecret === webhookSecret;
}
async function handler(req, res) {
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
        await bot_1.default.handleUpdate(req.body);
        return res.status(200).json({ ok: true });
    }
    catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
//# sourceMappingURL=bot.js.map