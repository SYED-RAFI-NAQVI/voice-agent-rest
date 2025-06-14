import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { GoogleGenAI, Modality } from "@google/genai";
import mic from "mic";
import Speaker from "speaker";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

// --- Configuration ---
const MIC_SAMPLE_RATE = 16000;
const MIC_CHANNELS = 1;
const MIC_BIT_WIDTH = 16;
const SPEAKER_SAMPLE_RATE = 24000;
const SPEAKER_CHANNELS = 1;
const SPEAKER_BIT_WIDTH = 16;

// Global context storage
let agentContext = {
  agentType: "",
  documents: [],
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Function to collect documents from user
async function collectDocuments() {
  return new Promise((resolve) => {
    console.log("\n📄 Now please provide the documents as text:");
    console.log("Enter each document content. Type 'DONE' when finished.\n");

    let docCount = 1;

    function getNextDocument() {
      rl.question(
        `Document ${docCount} (or 'DONE' to finish):\n> `,
        (input) => {
          if (input.trim().toUpperCase() === "DONE") {
            resolve();
            return;
          }

          rl.question(`Name for this document: `, (name) => {
            agentContext.documents.push({
              name: name || `Document ${docCount}`,
              content: input,
            });

            console.log(`✅ Added: ${name || `Document ${docCount}`}\n`);
            docCount++;
            getNextDocument();
          });
        }
      );
    }

    getNextDocument();
  });
}

// Function to run the live voice chat with context
async function runLiveVoiceWithContext() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Please create a .env file and add it."
    );
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // State management for the conversation
  let isAIResponding = false;
  let isConnected = false;

  // --- Speaker Setup ---
  const speaker = new Speaker({
    channels: SPEAKER_CHANNELS,
    bitDepth: SPEAKER_BIT_WIDTH,
    sampleRate: SPEAKER_SAMPLE_RATE,
  });

  speaker.on("error", (err) => console.error("🔊 Speaker error:", err));
  speaker.on("open", () => console.log("🔊 Speaker is ready."));

  // --- Microphone Setup ---
  const micInstance = mic({
    rate: String(MIC_SAMPLE_RATE),
    channels: String(MIC_CHANNELS),
    bitwidth: String(MIC_BIT_WIDTH),
    encoding: "signed-integer",
    device: "default",
  });

  const micStream = micInstance.getAudioStream();

  // Build system instruction with context
  let systemInstruction = `You are a ${
    agentContext.agentType
  } voice assistant. Your responses should be conversational, yet concise.

You have access to the following documents and information:
${agentContext.documents
  .map(
    (doc) => `
${doc.name}:
${doc.content}
`
  )
  .join("\n")}

Use this information to provide accurate, helpful responses. Always refer to the specific information in your documents when relevant.`;

  // --- AI Session Setup ---
  const session = await ai.live.connect({
    model: "gemini-2.5-flash-preview-native-audio-dialog",
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: systemInstruction,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    },
    callbacks: {
      onopen: () => {
        isConnected = true;
        console.log("🚀 Session connected.");
        micInstance.start();
        console.log("🎤 Microphone started. Listening...");
      },
      onmessage: (message) => {
        if (message.serverContent?.modelTurn?.parts) {
          if (!isAIResponding) {
            isAIResponding = true;
            console.log("🤖 AI Speaking, microphone paused...");
            micInstance.pause();
          }

          message.serverContent.modelTurn.parts.forEach((part) => {
            if (part.inlineData?.data) {
              const audioBuffer = Buffer.from(part.inlineData.data, "base64");
              speaker.write(audioBuffer);
            }
          });
        } else if (message.serverContent?.turnComplete) {
          if (isAIResponding) {
            isAIResponding = false;
            console.log("✅ AI turn complete. Resuming microphone...");
            micInstance.resume();
            console.log("🎤 Listening...");
          }
        } else if (message.usageMetadata) {
          console.log(
            `📊 Token usage: ${message.usageMetadata.totalTokenCount}`
          );
        }
      },
      onerror: (err) => {
        console.error("❌ Session error:", err);
        cleanupAndExit();
      },
      onclose: (event) => {
        isConnected = false;
        console.log("🔒 Session closed:", event?.reason || "No reason given");
      },
    },
  });

  // --- Microphone Data Handling ---
  micStream.on("data", (chunk) => {
    if (isConnected && !isAIResponding) {
      try {
        session.sendRealtimeInput({
          audio: {
            data: chunk.toString("base64"),
            mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}`,
          },
        });
      } catch (error) {
        console.error("❌ Error sending audio:", error);
      }
    }
  });

  micStream.on("error", (err) => console.error("🎤 Microphone error:", err));

  // --- Cleanup Logic ---
  function cleanupAndExit() {
    console.log("\n🧹 Cleaning up and exiting...");

    try {
      if (micInstance) micInstance.stop();
    } catch (e) {
      console.error("Error stopping mic:", e);
    }

    try {
      if (speaker && !speaker.destroyed) speaker.end();
    } catch (e) {
      console.error("Error closing speaker:", e);
    }

    if (session && isConnected) {
      try {
        session.close();
      } catch (e) {
        console.error("Error closing session:", e);
      }
    }
    isConnected = false;
    process.exit(0);
  }

  // Gracefully handle Ctrl+C
  process.on("SIGINT", async () => {
    if (session && isConnected) {
      await session.sendRealtimeInput({ audioStreamEnd: true });
    }
    cleanupAndExit();
  });
}

async function main() {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 2048,
  });

  rl.question(
    "🧠 What kind of voice agent do you want to create?\n> ",
    async (agentPrompt) => {
      agentContext.agentType = agentPrompt;

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
      console.log(`🤖 ${res.content}`);

      // Collect documents
      await collectDocuments();

      console.log(
        `\n🎙️ Starting your ${agentContext.agentType} voice agent with uploaded context...`
      );
      console.log(
        "The agent now has access to your documents and can provide specific information!"
      );
      console.log("Press Ctrl+C to exit.\n");

      // Close the readline interface before starting voice
      rl.close();

      // Start the voice agent with context
      await runLiveVoiceWithContext();
    }
  );
}

main().catch((error) => {
  console.error("💥 Failed to start application:", error);
  process.exit(1);
});
