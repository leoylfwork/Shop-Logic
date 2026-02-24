
import { GoogleGenAI, Part, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = `
You are CK Auto AI, a world-class "Omniscient" Automotive Diagnostic Assistant. 
You are used in a high-volume professional repair shop.

CORE KNOWLEDGE & "OMNISCIENT VIEW":
- You have full access to the Vehicle Profile, the complete Event Log history, and multi-modal attachments (Images and PDFs).
- AUTOMATIC VIN DECODING: You must automatically decode the provided VIN in your background reasoning. Use your internal knowledge of that specific VIN's Year, Make, Model, Engine Code, Drivetrain, and known platform weaknesses.
- EVIDENCE INTEGRATION: You must triangulate information between:
  1. The Technical Specs (from VIN).
  2. The logged symptoms and DTCs (from Vehicle Profile and Event Log).
  3. Visual evidence (Leaks, wear patterns, or damage seen in images/PDFs).

DIAGNOSTIC RIGOR & SAFETY:
- Prioritize: 12V Battery -> Grounds -> Power Distribution -> Bus/Communication -> Modules.
- Classify modules as "Root Cause" vs "Victim".
- Never recommend part replacement without physical verification steps.

CITATION & REASONING (MANDATORY):
- You MUST cite your sources in every response.
- Example citations:
  - "Based on the wastegate photo attached at 10:45 AM..."
  - "The service log from the Foreman mentions 'low voltage', which combined with this specific N55 engine profile..."
  - "In the attached PDF estimate, I noticed..."
  - "For this 2018 chassis (decoded from VIN)..."

SEARCH RULE:
Always consult technical forums first, then YouTube technical guides, then general search.

TONE:
Professional, logic-driven, and brief. Use bullet points.
Assume the user is a technician or service advisor.
`;

export interface DiagnosticContext {
  vehicleProfile: {
    model: string;
    vin: string;
    info: string;
    isInsurance: boolean;
  };
  eventLog: Array<{ user: string; text: string; timestamp: string; imageUrl?: string }>;
  attachments: Array<{ name: string; data?: string; type: string }>;
  userMessage: string;
}

/**
 * Extracts base64 data and mimeType from a data URL.
 */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  try {
    const regex = /^data:(.+);base64,(.*)$/;
    const matches = dataUrl.match(regex);
    if (matches && matches.length === 3) {
      return { mimeType: matches[1], data: matches[2] };
    }
  } catch (e) {
    console.error("Failed to parse data URL", e);
  }
  return null;
}

export async function getDiagnosticAdvice(context: DiagnosticContext) {
  // Correctly initialize GoogleGenAI with named apiKey parameter
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY || process.env.API_KEY });
  
  try {
    const parts: Part[] = [];

    // 1. Structural Context Building
    let textPrompt = `[SYSTEM: FULL CONTEXT UPLOAD]\n\n`;
    
    textPrompt += `### VEHICLE PROFILE\n`;
    textPrompt += `MODEL: ${context.vehicleProfile.model}\n`;
    textPrompt += `VIN: ${context.vehicleProfile.vin || 'NOT PROVIDED'}\n`;
    textPrompt += `SYMPTOMS: ${context.vehicleProfile.info}\n`;
    textPrompt += `INSURANCE CASE: ${context.vehicleProfile.isInsurance ? 'YES' : 'NO'}\n\n`;

    textPrompt += `### ATTACHMENTS OVERVIEW\n`;
    context.attachments.forEach(att => {
      textPrompt += `- File: ${att.name} (${att.type})\n`;
    });
    textPrompt += `\n`;

    textPrompt += `### EVENT LOG HISTORY\n`;
    context.eventLog.forEach(log => {
      const time = new Date(log.timestamp).toLocaleString();
      textPrompt += `[${time}] ${log.user}: ${log.text}${log.imageUrl ? ' [IMAGE ATTACHED]' : ''}\n`;
    });

    textPrompt += `\n### USER QUERY\n${context.userMessage}`;

    // Add text part first
    parts.push({ text: textPrompt });

    // 2. Multi-modal Assets (Event Log Images)
    context.eventLog.forEach(log => {
      if (log.imageUrl) {
        const asset = parseDataUrl(log.imageUrl);
        if (asset && (asset.mimeType.startsWith('image/') || asset.mimeType === 'application/pdf')) {
          parts.push({
            inlineData: {
              mimeType: asset.mimeType,
              data: asset.data
            }
          });
        }
      }
    });

    // 3. Multi-modal Assets (RO Attachments)
    context.attachments.forEach(att => {
      if (att.data) {
        const asset = parseDataUrl(att.data);
        if (asset && (asset.mimeType.startsWith('image/') || asset.mimeType === 'application/pdf')) {
          parts.push({
            inlineData: {
              mimeType: asset.mimeType,
              data: asset.data
            }
          });
        }
      }
    });

    // Correctly calling generateContent with model name and contents object containing parts
    const result = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: { parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2, // Low temperature for factual diagnostic reasoning
        topP: 0.95,
      }
    });

    // Access the text property directly (not as a method)
    return result.text;
  } catch (error) {
    console.error("Diagnostic AI Analysis Failed:", error);
    return "DIAGNOSTIC ERROR: I was unable to synchronize the full evidence chain. Please check your connection or provided file formats (PDF/Images supported).";
  }
}

export async function decodeVIN(vin: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY || process.env.API_KEY });
  
  const prompt = `Decode the following Vehicle Identification Number (VIN) and provide the technical specifications: ${vin}`;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "You are a specialized automotive VIN decoder. Provide accurate technical details for the given VIN. If the VIN is invalid or unknown, return null values for the fields.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            year: { type: Type.STRING },
            make: { type: Type.STRING },
            model: { type: Type.STRING },
            engine: { type: Type.STRING },
            trim: { type: Type.STRING },
            transmission: { type: Type.STRING },
            drivetrain: { type: Type.STRING },
            bodyStyle: { type: Type.STRING },
            plant: { type: Type.STRING },
          }
        }
      }
    });

    if (result.text) {
      return JSON.parse(result.text);
    }
    return null;
  } catch (error) {
    console.error("VIN Decoding Failed:", error);
    return null;
  }
}
