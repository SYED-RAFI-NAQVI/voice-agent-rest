// server.js
import express from "express";
import cors from "cors";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { GoogleGenAI, Modality } from "@google/genai";
import mic from "mic";
import Speaker from "speaker";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// --- Configuration ---
const MIC_SAMPLE_RATE = 16000;
const MIC_CHANNELS = 1;
const MIC_BIT_WIDTH = 16;
const SPEAKER_SAMPLE_RATE = 24000;
const SPEAKER_CHANNELS = 1;
const SPEAKER_BIT_WIDTH = 16;

// Global storage (use database in production)
let agentSessions = new Map();

// API Routes

// 1. Get document recommendations
app.post("/api/agent-recommendations", async (req, res) => {
  try {
    const { agentType } = req.body;

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY,
      maxOutputTokens: 2048,
    });

    const messages = [
      new HumanMessage({
        content: `You are an AI assistant helping to configure a voice agent. The user wants to create: "${agentType}"
        
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
        
        Be very specific about document types and provide 4-6 specific document recommendations.`,
      }),
    ];

    const response = await model.invoke(messages);

    res.json({
      success: true,
      recommendations: response.content,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Store documents
app.post("/api/documents", (req, res) => {
  try {
    const { sessionId, documents } = req.body;

    if (!agentSessions.has(sessionId)) {
      agentSessions.set(sessionId, {
        agentType: "",
        documents: [],
      });
    }

    const session = agentSessions.get(sessionId);
    session.documents = documents;

    res.json({
      success: true,
      message: "Documents stored successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Update agent type
app.post("/api/agent-type", (req, res) => {
  try {
    const { sessionId, agentType } = req.body;

    if (!agentSessions.has(sessionId)) {
      agentSessions.set(sessionId, {
        agentType: "",
        documents: [],
      });
    }

    const session = agentSessions.get(sessionId);
    session.agentType = agentType;

    res.json({
      success: true,
      message: "Agent type updated",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Get session data
app.get("/api/session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = agentSessions.get(sessionId);

    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: "Session not found" });
    }

    res.json({
      success: true,
      session,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voice session management
let activeVoiceSessions = new Map();

// Universal System Instruction Generator
function generateSystemInstruction(sessionData) {
  // Extract document content and organize it
  const documentContent = sessionData.documents
    .map(
      (doc) => `
=== DOCUMENT: ${doc.name} ===
${doc.content}
============================
`
    )
    .join("\n");

  return `# VOICE AGENT ASSISTANT

## ROLE & IDENTITY
You are a professional ${sessionData.agentType} voice assistant. You represent this organization with expertise, professionalism, and helpfulness. Your primary goal is to assist callers efficiently while maintaining a warm, professional demeanor.

## KNOWLEDGE BASE
You have access to comprehensive company information through ${sessionData.documents.length} uploaded documents. Always reference specific information from these documents when answering questions.

## DOCUMENT LIBRARY:
${documentContent}

## CONVERSATION GUIDELINES

### Communication Style:
- **Professional & Conversational**: Maintain business professionalism while being approachable and natural
- **Concise & Complete**: Provide thorough answers without unnecessary verbosity  
- **Reference-Based**: Always cite specific information from the documents when applicable
- **Proactive**: Anticipate needs and offer relevant additional assistance

### Response Framework:
1. **Acknowledge** the request clearly
2. **Reference specific information** from the uploaded documents 
3. **Provide complete, actionable answers**
4. **Offer additional relevant assistance**

### When Referencing Documents:
- Say "According to our [document name/policy/directory]..."
- Quote specific information like names, numbers, procedures
- Reference exact details like phone extensions, hours, policies
- Cross-reference multiple documents when relevant

### For Information You Don't Have:
- "I don't have that specific information in my current knowledge base"
- "Let me connect you with [relevant person/department] who can help with that"
- "I'd be happy to take your contact information so someone can follow up"

### For Complex Requests:
- Break down multi-step processes clearly
- Provide step-by-step guidance when needed
- Confirm understanding before proceeding
- Offer to walk through processes slowly

### Voice-Optimized Responses:
- Use natural speech patterns and pausing
- Spell out important information when needed
- Confirm understanding of complex details
- Ask clarifying questions when requests are unclear

## QUALITY STANDARDS
- **Accuracy First**: Only provide information you can verify from the documents
- **Source Attribution**: Reference specific documents or sections when providing information  
- **Professional Boundaries**: Know when to escalate or transfer calls
- **Follow-up Excellence**: Always ask if there's anything else you can help with

Remember: You are the voice of this organization. Every interaction should leave callers feeling valued, informed, and satisfied with the service they received.`;
}

// WebSocket for voice communication
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("start-voice-session", async (data) => {
    try {
      const { sessionId } = data;
      const session = agentSessions.get(sessionId);

      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }

      // Create voice session
      const voiceSession = await createVoiceSession(session, socket);
      activeVoiceSessions.set(socket.id, voiceSession);

      socket.emit("voice-session-started");
    } catch (error) {
      console.error("Error starting voice session:", error);
      socket.emit("error", { message: error.message });
    }
  });

  socket.on("audio-data", (audioData) => {
    console.log(
      "📨 Received audio data:",
      audioData ? "Yes" : "No",
      audioData ? audioData.length : 0
    );

    const voiceSession = activeVoiceSessions.get(socket.id);
    if (
      voiceSession &&
      voiceSession.isConnected &&
      !voiceSession.isAIResponding
    ) {
      try {
        console.log("🎤 Sending audio to Gemini...");
        voiceSession.session.sendRealtimeInput({
          audio: {
            data: audioData,
            mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}`,
          },
        });
      } catch (error) {
        console.error("❌ Error sending audio:", error);
        socket.emit("error", { message: "Error processing audio" });
      }
    } else {
      console.log("⚠️ Voice session not ready:", {
        hasSession: !!voiceSession,
        isConnected: voiceSession?.isConnected,
        isAIResponding: voiceSession?.isAIResponding,
      });
    }
  });

  socket.on("stop-voice-session", () => {
    const voiceSession = activeVoiceSessions.get(socket.id);
    if (voiceSession) {
      try {
        if (voiceSession.session && voiceSession.isConnected) {
          voiceSession.session.sendRealtimeInput({ audioStreamEnd: true });
          voiceSession.session.close();
        }
      } catch (error) {
        console.error("Error stopping voice session:", error);
      }
      activeVoiceSessions.delete(socket.id);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    const voiceSession = activeVoiceSessions.get(socket.id);
    if (voiceSession) {
      try {
        if (voiceSession.session && voiceSession.isConnected) {
          voiceSession.session.close();
        }
      } catch (error) {
        console.error("Error cleaning up voice session:", error);
      }
      activeVoiceSessions.delete(socket.id);
    }
  });
});

// Create voice session with enhanced system instruction
async function createVoiceSession(sessionData, socket) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let isAIResponding = false;
  let isConnected = false;

  // Generate comprehensive system instruction with actual document content
  const systemInstruction = generateSystemInstruction(sessionData);

  console.log("🧠 System Instruction Generated:", {
    agentType: sessionData.agentType,
    documentCount: sessionData.documents.length,
    instructionLength: systemInstruction.length,
  });

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
        console.log("Voice session connected for", socket.id);
        socket.emit("voice-connected");
      },
      onmessage: (message) => {
        if (message.serverContent?.modelTurn?.parts) {
          if (!isAIResponding) {
            isAIResponding = true;
            socket.emit("ai-speaking-start");
          }

          message.serverContent.modelTurn.parts.forEach((part) => {
            if (part.inlineData?.data) {
              const audioData = part.inlineData.data;
              console.log("🎵 Audio chunk details:", {
                base64Length: audioData.length,
                mimeType: part.inlineData.mimeType || "unknown",
                binarySize: atob(audioData).length,
              });

              // Send audio data to frontend
              socket.emit("audio-response", {
                audioData: audioData,
                mimeType: part.inlineData.mimeType || "audio/pcm",
              });
            }
          });
        } else if (message.serverContent?.turnComplete) {
          if (isAIResponding) {
            isAIResponding = false;
            socket.emit("ai-speaking-end");
          }
        } else if (message.usageMetadata) {
          socket.emit("token-usage", {
            totalTokens: message.usageMetadata.totalTokenCount,
          });
        }
      },
      onerror: (err) => {
        console.error("Voice session error:", err);
        socket.emit("voice-error", { message: err.message });
      },
      onclose: (event) => {
        isConnected = false;
        console.log(
          "Voice session closed:",
          event?.reason || "No reason given"
        );
        socket.emit("voice-disconnected");
      },
    },
  });

  // Return object with direct access to the variables
  return {
    session,
    get isConnected() {
      return isConnected;
    },
    get isAIResponding() {
      return isAIResponding;
    },
  };
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket ready for voice connections`);
});
