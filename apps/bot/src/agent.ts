import { AgentBuilder } from "@anvia/core";

import { model } from "./model.js";
import { checkStock, getCurrentTime, ragSearch } from "./tools.js";

export const agent = new AgentBuilder("soysu-chatbot", model)
  .instructions(
    "You are a friendly customer service agent for Soysu, an artisanal soy milk brand in Yogyakarta. " +
      "Answer concisely in the language the user uses. Use rag_search for product, storage, and delivery questions. " +
      "Use check_stock for real-time price and stock; never guess stock or prices.",
  )
  .tools([ragSearch, checkStock, getCurrentTime])
  .defaultMaxTurns(4)
  .build();
