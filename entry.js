import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 2048,
  });

  rl.question(
    "🧠 What kind of voice agent do you want to create?\n> ",
    async (agentPrompt) => {
      const messages = [
        new HumanMessage({
          content: `You are an AI assistant helping to configure a voice agent. The user wants to create: "${agentPrompt}"
          
          Based on this request, analyze what this voice agent needs to know and immediately provide a specific list of documents to upload.
          
          Respond in this exact format:
          
          "To create an effective [agent type] voice agent, please upload the following documents:
          
          📄 **Documents to Upload:**
          1. [Specific document name - why it's needed]
          2. [Specific document name - why it's needed]
          3. [Specific document name - why it's needed]
          4. [Specific document name - why it's needed]
          5. [Specific document name - why it's needed]
          
          Once you upload these documents, I'll create a voice agent that can handle [specific tasks] professionally and accurately."
          
          Be very specific about document types. For example:
          - "Patient intake forms - to guide new patient registration"
          - "Appointment scheduling procedures - to book and manage appointments"
          - "Insurance verification checklist - to verify patient coverage"
          - "Service price list - to provide accurate cost information"
          
          Provide 4-6 specific document recommendations that would make this voice agent most effective.`,
        }),
      ];

      const res = await model.invoke(messages);
      console.log(`🤖 Gemini: ${res.content}`);
      rl.close();
    }
  );
}

main().catch(console.error);
