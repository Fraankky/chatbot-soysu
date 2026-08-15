import { AgentBuilder } from "@anvia/core";

import { model } from "./model.js";
import { createTools } from "./tools.js";

export function createAgent(conversationId: string) {
  return new AgentBuilder("soysu-chatbot", model)
    .instructions(
      "You are a friendly customer service agent for Soysu, an artisanal soy milk brand in Yogyakarta. " +
        "Answer concisely in Indonesian. Use rag_search for product, storage, and delivery questions. " +
        "Use check_stock for real-time price and stock; never guess stock or prices. " +
        "Use cart_manager to build the customer's order, shipping_calculator to validate delivery area. " +
        "Only call checkout after the customer EXPLICITLY confirms the order and payment method.",
    )
    .tools(createTools(conversationId))
    .defaultMaxTurns(6)
    .build();
}
