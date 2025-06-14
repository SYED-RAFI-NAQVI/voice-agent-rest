// ===============================================================================================

import { GoogleGenAI, Modality } from "@google/genai";
import mic from "mic";
import Speaker from "speaker";
import dotenv from "dotenv";

// Load environment variables from a .env file
dotenv.config();

// --- Configuration ---
// Audio configuration for the microphone
const MIC_SAMPLE_RATE = 16000;
const MIC_CHANNELS = 1;
const MIC_BIT_WIDTH = 16;
// Audio configuration for the speaker. 24000 is the native rate for Gemini's Text-to-Speech.
const SPEAKER_SAMPLE_RATE = 24000;
const SPEAKER_CHANNELS = 1;
const SPEAKER_BIT_WIDTH = 16;

/**
 * Main function to run the live voice chat application.
 */
async function runLiveVoice() {
  // --- Initialization ---
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
  // The Speaker library will play the raw audio chunks received from the API
  const speaker = new Speaker({
    channels: SPEAKER_CHANNELS,
    bitDepth: SPEAKER_BIT_WIDTH,
    sampleRate: SPEAKER_SAMPLE_RATE,
  });

  speaker.on("error", (err) => console.error("🔊 Speaker error:", err));
  speaker.on("open", () => console.log("🔊 Speaker is ready."));

  // --- Microphone Setup ---
  // The 'mic' library captures audio from the default microphone
  const micInstance = mic({
    rate: String(MIC_SAMPLE_RATE),
    channels: String(MIC_CHANNELS),
    bitwidth: String(MIC_BIT_WIDTH),
    encoding: "signed-integer",
    device: "default",
  });

  const micStream = micInstance.getAudioStream();

  // --- AI Session Setup ---
  // Connect to the Gemini Live Content API
  const session = await ai.live.connect({
    // Using a flash model for faster, more conversational responses.
    // Update this to a model that supports native audio dialog if you have access.
    model: "gemini-2.5-flash-preview-native-audio-dialog",
    config: {
      // Tell the model to respond with audio
      responseModalities: [Modality.AUDIO],
      systemInstruction:
        "You are a helpful and friendly voice assistant. Your responses should be conversational, yet concise.",
      // Configure the voice for the AI's speech
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    },
    callbacks: {
      onopen: () => {
        isConnected = true;
        // Start the microphone after the connection is established
        console.log("🚀 Session connected.");
        micInstance.start();
        console.log("🎤 Microphone started. Listening...");
      },
      onmessage: (message) => {
        // We are receiving a message from the server
        if (message.serverContent?.modelTurn?.parts) {
          // This is an audio response from the AI
          if (!isAIResponding) {
            isAIResponding = true;
            console.log("🤖 AI Speaking, microphone paused...");
            micInstance.pause();
          }

          // Write each audio chunk to the speaker as it arrives
          message.serverContent.modelTurn.parts.forEach((part) => {
            if (part.inlineData?.data) {
              const audioBuffer = Buffer.from(part.inlineData.data, "base64");
              speaker.write(audioBuffer);
            }
          });
        } else if (message.serverContent?.turnComplete) {
          // The AI has finished its turn
          if (isAIResponding) {
            isAIResponding = false;
            console.log("✅ AI turn complete. Resuming microphone...");
            micInstance.resume();
            console.log("🎤 Listening...");
          }
        } else if (message.usageMetadata) {
          // Log token usage for monitoring
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
  // This event fires whenever the microphone records a chunk of audio
  micStream.on("data", (chunk) => {
    // If the connection is live and the AI is not talking, send the audio
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

    // Stop the microphone
    try {
      if (micInstance) micInstance.stop();
    } catch (e) {
      console.error("Error stopping mic:", e);
    }

    // Close the speaker
    try {
      if (speaker && !speaker.destroyed) speaker.end();
    } catch (e) {
      console.error("Error closing speaker:", e);
    }

    // Close the AI session
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
      // Let the session know the user audio stream is ending
      await session.sendRealtimeInput({ audioStreamEnd: true });
    }
    cleanupAndExit();
  });
}

// Run the application
runLiveVoice().catch((error) => {
  console.error("💥 Failed to start application:", error);
  process.exit(1);
});
