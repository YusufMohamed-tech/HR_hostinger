import "server-only";
import OpenAI from "openai";

export const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export const CHAT_MODEL = "google/gemma-4-26b-a4b-it:free";
