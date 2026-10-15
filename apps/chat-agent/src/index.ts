import dotenv from 'dotenv';
import { createChatAgentApp } from './server';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5000', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8080';
const MEMBER_API_KEY = process.env.MEMBER_API_KEY || process.env.INITIAL_MEMBER_KEY || 'placeholder-member-key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const OPENAI_MODEL = process.env.OPENAI_MODEL;

const { app } = createChatAgentApp({
  port: PORT,
  gatewayUrl: GATEWAY_URL,
  memberApiKey: MEMBER_API_KEY,
  openaiApiKey: OPENAI_API_KEY,
  openaiBaseUrl: OPENAI_BASE_URL,
  openaiModel: OPENAI_MODEL,
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ChatAgent] AI Chat Agent server running on http://0.0.0.0:${PORT}`);
  console.log(`[ChatAgent] Gateway target: ${GATEWAY_URL}`);
  console.log(`[ChatAgent] LLM configured: ${Boolean(OPENAI_API_KEY)} (Model: ${OPENAI_MODEL || 'gpt-4o-mini'})`);
});
