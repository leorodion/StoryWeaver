
import { GoogleGenAI, Type, GenerateContentResponse, Modality, GenerateVideosOperation, VideoGenerationReferenceType } from "@google/genai";
import type { Part, VideoGenerationReferenceImage } from "@google/genai";
import { base64ToBytes, pcmToWavBlob } from "../utils/fileUtils";
import { parseErrorMessage } from "../utils/errorUtils";

// ... (Existing types remain unchanged)
export type Character = {
  id: number;
  name: string;
  imagePreview: string | null;
  originalImageBase64: string | null;
  originalImageMimeType: string | null;
  description: string | null;
  detectedImageStyle: string | null;
  isDescribing: boolean;
};

export type StoryboardSceneData = {
    id: number;
    imageDescription: string;
    script: string; 
    isDescriptionLocked?: boolean;
    isScriptLocked?: boolean;

    audioSrc?: string | null;
    isGeneratingAudio?: boolean;
    selectedVoice?: string;
    selectedExpression?: string;
};

export type Storybook = {
    title: string;
    characters: string[];
    storyNarrative: string;
    scenes: StoryboardSceneData[];
    narrativeAudioSrc?: string | null;
    isGeneratingNarrativeAudio?: boolean;
    selectedNarrativeVoice?: string;
    selectedNarrativeExpression?: string;
    selectedNarrativeAccent?: string;
};

export type StorybookParts = {
    storyNarrative: string;
    scenes: StoryboardSceneData[];
};

export type AudioOptions = {
    mode: 'upload';
    data: string; // base64
    mimeType: string;
    assignment?: { type: 'character'; characterName: string } | { type: 'background' };
} | {
    mode: 'tts';
    data: string; // script prompt
};

export type EditImageParams = {
  imageBase64: string;
  mimeType: string;
  editPrompt: string;
  aspectRatio: string;
  characterStyle: string;
  visualStyle: string;
  genre: string;
  characters: Character[];
  hasVisualMasks?: boolean;
  signal?: AbortSignal;
  imageModel?: string;
  overlayImage?: { base64: string; mimeType: string; };
  referenceImage?: { base64: string; mimeType: string; };
};

export const PREBUILT_VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir'];
export const VOICE_EXPRESSIONS = ['Storytelling', 'Loving', 'Newscast', 'Advertisement', 'Cheerful', 'Angry', 'Sad'];
export const ACCENT_OPTIONS = ['Global (Neutral)', 'Nigerian English'];

export const CAMERA_ANGLE_OPTIONS = [
    { key: 'close_up', name: 'Close Shot', description: 'Focuses tightly on a character\'s face.' },
    { key: 'medium', name: 'Medium Shot', description: 'Shows a character from the waist up.' },
    { key: 'full', name: 'Full Shot', description: 'Captures the entire character from head to toe.' },
    { key: 'wide', name: 'Wide Shot', description: 'Establishes the entire scene and location.' },
    { key: 'ots', name: 'Over-the-Shoulder', description: 'Looks over one character at another.' },
    { key: 'pov', name: 'Point of View (POV)', description: 'Shows the scene from a character\'s eyes.' },
    { key: 'high_angle', name: 'High-Angle', description: 'Looks down on the subject.' },
    { key: 'low_angle', name: 'Low-Angle', description: 'Looks up at the subject.' },
    { key: 'from_behind', name: 'From the Back', description: 'Frames the scene from behind the character.' },
];

const getAiClient = () => {
    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
      throw new Error("API_KEY environment variable not set");
    }
    return new GoogleGenAI({ apiKey: API_KEY });
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(apiCall: () => Promise<T>, onRetryMessage?: (msg: string) => void, signal?: AbortSignal): Promise<T> {
    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
        if (signal?.aborted) {
             throw new Error("Aborted");
        }
        try {
            return await apiCall();
        } catch (error) {
            if (signal?.aborted) {
                 throw new Error("Aborted");
            }
            attempt++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isRetryable = 
                errorMessage.includes('503') || 
                errorMessage.toLowerCase().includes('overloaded') || 
                errorMessage.includes('429') ||
                errorMessage.includes('500') ||
                errorMessage.toLowerCase().includes('internal server error');

            if (isRetryable && attempt < maxRetries) {
                const delaySeconds = Math.pow(2, attempt) * 15; 
                const retryMsg = `Model is busy (Code: ${errorMessage.substring(0, 3)}). Retrying in ${delaySeconds}s... (Attempt ${attempt}/${maxRetries})`;
                if (onRetryMessage) {
                    onRetryMessage(retryMsg);
                } else {
                    console.log(retryMsg);
                }
                await delay(delaySeconds * 1000);
            } else {
                throw error;
            }
        }
    }
    throw new Error("API call failed after multiple retries.");
}


export type StoryboardScene = {
    src: string | null;
    prompt: string;
    error?: string | null;
    isCameraAngleFor?: number; 
    angleName?: string;
};

export type GenerationResult = {
    storyboard: StoryboardScene[];
}

export const CAMERA_MOVEMENT_PROMPTS: { [key: string]: string } = {
    'Static Hold': 'The camera remains completely static, holding a fixed shot on the scene.',
    'Drone Rise Tilt-Up': 'The camera starts low and ascends smoothly while tilting upward, creating an epic aerial reveal of the scene.',
    'Dolly Back (Pull-Out)': 'The camera starts relatively close to the subject and then moves straight backward (dolly out), smoothly revealing more of the surrounding environment.',
    'Pan Left': 'The camera moves smoothly and horizontally from right to left across the scene.',
    'Pan Right': 'The camera moves smoothly and horizontally from left to right across the scene.',
    'Orbit Around Subject': 'The camera smoothly circles around the main subject of the scene, keeping them in focus.',
    'Crane Down': 'The camera moves vertically downward, as if on a crane, offering a descending perspective of the scene.',
    'Crane Up': 'The camera moves vertically upward, as if on a crane, for a powerful lift or establishing shot.',
    'Tracking Shot (Follow)': 'The camera follows the subject\'s motion smoothly, keeping them at a consistent position in the frame.',
    'Zoom In (Focus In)': 'The camera lens smoothly zooms in, gradually tightening the focus on the main subject or a specific detail.',
    'Zoom Out (Reveal)': 'The camera lens smoothly zooms out, gradually widening the view to reveal more of the setting or context.',
};

function getStyleInstructions(style: string): string {
    switch (style) {
        case 'Afro-toon': // Kept for legacy fallback, but mainly handled via characterStyle now
            return `A vibrant 2D cartoon style inspired by Nigerian art. Characters are drawn with expressive faces and normal human proportions. They wear colorful traditional Nigerian attire. The art uses bold, clean outlines and a simple, flat color palette.`;
        case 'Realistic Photo':
            return `A hyper-realistic, cinematic photograph. 8k resolution, high fidelity, realistic skin textures, natural lighting, and true-to-life proportions. Shot on a professional 35mm camera.`;
        case '3D Render':
            return `A high-quality 3D render, similar to modern animated feature films (Pixar/Disney style). Smooth textures, volumetric lighting, ambient occlusion.`;
        case 'Anime':
            return `Japanese Anime style. Cel-shaded, vibrant colors, expressive eyes, dynamic composition.`;
        case 'Illustration':
            return `A modern digital illustration. Clean lines, artistic shading, detailed but stylized.`;
        case 'Oil Painting':
            return `Classic oil painting style. Visible brush strokes, rich textures, painterly lighting.`;
        case 'Pixel Art':
            return `Retro pixel art style. Low-res, blocky pixels, limited color palette.`;
        case '2D Flat':
            return `Flat 2D design. Minimalist, solid colors, no gradients, clean geometric shapes.`;
        case 'Video Game':
            return `Modern video game graphics (Unreal Engine 5 style). High detail, dynamic lighting, glossy textures.`;
        case 'Watercolor':
            return `Watercolor painting style. Soft edges, bleed effects, paper texture, pastel colors.`;
        case 'Cyberpunk':
            return `Cyberpunk aesthetic. Neon lights, high contrast, futuristic technology, gritty urban environment.`;
        default:
            return `In the style of ${style}.`;
    }
}

// Helper to get specific movie style instructions
function getMovieStyleInstructions(movieStyle: string): string {
    switch (movieStyle) {
        case 'Nollywood':
            return `
            **CINEMATIC STYLE: NOLLYWOOD (NIGERIAN CINEMA)**
            - **Core Aesthetic:** Grounded, dramatic, and heavily character-driven. Less reliance on high-tech action/shooting; emphasis on social drama, status, and family dynamics.
            - **Visuals:** Settings must be authentically Nigerian (e.g., bustling Lagos streets, luxurious mansions with gold accents, or traditional village compounds).
            - **Attire:** Characters often wear traditional Nigerian attire (e.g., Agbada, Ankara, Gele, Lace, Buba) or distinct modern Nigerian fashion.
            - **Genre Adaptation:**
              - **Comedy:** Physical, loud, often based on social misunderstandings or village vs. city tropes.
              - **Romance:** High-stakes, often involving family approval or class difference.
              - **History:** Focus on pre-colonial kingdoms or independence era aesthetics.
            `;
        case 'Bollywood':
            return `
            **CINEMATIC STYLE: BOLLYWOOD (INDIAN CINEMA)**
            - **Core Aesthetic:** Grandiose, colorful, musical, and emotionally heightened. Larger than life.
            - **Visuals:** High saturation, vibrant colors, dramatic lighting, and elaborate set designs.
            - **Attire:** Characters often wear traditional Indian attire (e.g., Saris, Lehengas, Kurtas, Sherwanis) with elaborate jewelry, or flashy modern high-fashion.
            - **Key Element:** Song and Dance energy. Even non-musical scenes should feel choreographed and rhythmic.
            - **Genre Adaptation:**
              - **Comedy:** Slapstick mixed with witty dialogue and dramatic irony.
              - **Romance:** Poetic, destined, often involves wind-blown hair and intense eye contact.
              - **Action:** Physics-defying, stylized, and heroic.
            `;
        case 'Hollywood':
            return `
            **CINEMATIC STYLE: HOLLYWOOD (AMERICAN BLOCKBUSTER)**
            - **Core Aesthetic:** Polished, "serious", high-stakes, and action-oriented. High production value.
            - **Visuals:** Cinematic color grading (often teal/orange), dynamic camera movement, depth of field, lens flares.
            - **Action:** Emphasis on "shooting", gunplay, explosions, car chases, and physical combat. Fast pacing.
            - **Genre Adaptation:**
              - **Comedy:** Witty banter, situational humor, or satire.
              - **Romance:** Chemistry-driven, often with obstacles or "meet-cutes".
              - **History:** Epic scale, period-accurate costumes but with a modern cinematic sheen.
            `;
        case 'General':
        default:
            return `**CINEMATIC STYLE: GENERAL** - Focus on clear storytelling and universal visual appeal without specific regional constraints.`;
    }
}

// Helper to construct strict character mandates
function getCharacterConsistencyBible(characters: Character[]): string {
    if (characters.length === 0) return "";
    
    return `
    **VISUAL CONSISTENCY BIBLE (STRICT ENFORCEMENT REQUIRED)**
    You must adhere to these character descriptions exactly in every 'imageDescription'.
    
    ${characters.map(c => `
    --- CHARACTER: ${c.name.toUpperCase()} ---
    VISUALS: ${c.description || "No specific description."}
    MANDATE: Whenever ${c.name} appears, you MUST describe them wearing exactly the same clothes and having the same physical features defined above. Do not change their outfit unless the plot explicitly demands a costume change.
    `).join('\n')}
    `;
}

export async function generateCharacterDescription(imageBase64: string, mimeType: string, signal?: AbortSignal): Promise<{ description: string; detectedStyle: string }> {
    const ai = getAiClient();
    const imagePart = { inlineData: { data: imageBase64, mimeType }};
    const prompt = `Analyze the person in the image. Generate a concise, single-line, comma-separated list of descriptive tags for an AI image generator to ensure high-fidelity recreation. Also, identify the primary visual art style.

    **CRITICAL RULES:**
    1.  **Format:** Return a JSON object with keys: "description" (string) and "detectedStyle" (string).
    2.  **Description:** Gender, age, ethnicity, face, eyes, hair, skin, distinctive features, AND EXACT CLOTHING DETAILS (color, type, accessories).
    `;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [imagePart, { text: prompt }]},
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    description: { type: Type.STRING },
                    detectedStyle: { type: Type.STRING }
                },
                required: ['description', 'detectedStyle']
            }
        }
    }), undefined, signal);

    const text = response.text;
    if (typeof text !== 'string' || text.trim() === '') throw new Error("No text response or empty response for character description.");

    try {
        const parsed = JSON.parse(text);
        return { description: parsed.description.trim(), detectedStyle: parsed.detectedStyle.trim() };
    } catch (e) {
        throw new Error("Failed to parse JSON response for character description.");
    }
}

export async function generateCharacterVisual(
    character: Character,
    uiSelectedStyle: string,
    signal?: AbortSignal
): Promise<{ src: string | null; error: string | null }> {
    if (character.originalImageBase64 && character.originalImageMimeType) {
        let targetStyle = character.detectedImageStyle || uiSelectedStyle; 
        if (character.detectedImageStyle === 'Realistic Photo') {
            targetStyle = 'Illustration'; 
        }

        const editPrompt = `Using the provided image as a perfect reference, generate a full-body view of the exact same character, '${character.name}'. The character's features, clothing, and colors must be perfectly preserved. Standing pose, plain white background. Style: '${targetStyle}'.`;

        return editImage({
            imageBase64: character.originalImageBase64,
            mimeType: character.originalImageMimeType,
            editPrompt: editPrompt,
            aspectRatio: '3:4',
            characterStyle: 'General', // Default for visual build
            visualStyle: targetStyle,
            genre: 'General',
            characters: [character],
            hasVisualMasks: false,
            signal: signal,
            imageModel: 'gemini-2.5-flash-image', 
        });

    } else if (character.description) {
        const prompt = `Character sheet for '${character.name}'. Full-body view, centered, standing pose. ${character.description}. Plain white background.`;
        // FIX: Pass the single `character` object inside an array to match the expected parameter type.
        return generateSingleImage(
            prompt, '3:4', 'General', uiSelectedStyle, 'General', [character], 'gemini-2.5-flash-image', null, null, signal
        );
    } else {
        return { src: null, error: "Cannot generate visual without an image or description." };
    }
}

export async function describeImageForConsistency(imageBase64: string, signal?: AbortSignal): Promise<string> {
    const ai = getAiClient();
    const imagePart = { inlineData: { data: imageBase64, mimeType: 'image/png' }};
    const prompt = `Generate a very concise, comma-separated list of descriptive tags for this scene (subject, setting, lighting).`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [imagePart, { text: prompt }]}
    }), undefined, signal);

    return response.text?.trim() || '';
}

export async function generatePromptFromAudio(audioBase64: string, mimeType: string, signal?: AbortSignal): Promise<string> {
    const ai = getAiClient();
    const audioPart = { inlineData: { data: audioBase64, mimeType: mimeType } };
    const prompt = `Transcribe the audio. Return only the text.`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash', // Use Flash for reliable multimodal audio transcription
        contents: { parts: [audioPart, { text: prompt }] },
    }), undefined, signal);

    return response.text?.trim() || '';
}

export async function generatePromptsFromBase(
  basePrompt: string,
  sceneCount: number,
  genre: string,
  characterStyle: string,
  characters: Character[],
  signal?: AbortSignal
): Promise<string[]> {
    const ai = getAiClient();
    const genreInstruction = genre && genre.toLowerCase() !== 'general' 
        ? `**Genre:** The story must be in the **${genre}** genre.` 
        : '';
    
    // Inject Character Consistency
    const characterConsistency = getCharacterConsistencyBible(characters);

    // CONDITIONAL PROMPT: Only add racial mandate if style is Afro-toon
    const racialInstruction = characterStyle === 'Afro-toon' 
        ? `For cultural context, ensure all human characters are of Black African descent.`
        : '';

    const prompt = `Create ${sceneCount} sequential, safe, visually descriptive scene prompts based on this idea: "${basePrompt}".
    ${racialInstruction}
    ${genreInstruction}
    ${characterConsistency}
    Output JSON object with property "prompts" (array of strings).`;
    
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    prompts: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['prompts']
            }
        }
    }), undefined, signal);
    
    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No JSON response from model.");
    const parsed = JSON.parse(jsonStr);
    return parsed.prompts;
}

export async function editImage(params: EditImageParams): Promise<{ src: string | null; error: string | null }> {
    const ai = getAiClient();
    try {
        const styleInstructions = getStyleInstructions(params.visualStyle);
        const mentionedCharacters = params.characters.filter(c => params.editPrompt.toLowerCase().includes(c.name.toLowerCase()));
        const consistencyText = mentionedCharacters.map(c => `MANDATORY APPEARANCE for ${c.name}: ${c.description || 'Standard appearance'}.`).join(' ');

        const parts: Part[] = [
             { inlineData: { data: params.imageBase64, mimeType: params.mimeType } },
        ];

         if (params.overlayImage) {
            parts.push({ inlineData: { data: params.overlayImage.base64, mimeType: params.overlayImage.mimeType } });
        }
        if (params.referenceImage) {
            parts.push({ inlineData: { data: params.referenceImage.base64, mimeType: params.referenceImage.mimeType } });
        }

        let promptText = `Edit this image. Instruction: ${params.editPrompt}. \nStyle: ${styleInstructions}.\n${consistencyText}`;
        if (params.hasVisualMasks && params.overlayImage) {
            promptText += " Use the provided mask image to constrain the edit.";
        }
        
        parts.push({ text: promptText });

        const modelToUse = params.imageModel || 'gemini-2.5-flash-image';
        const config: any = { imageConfig: { aspectRatio: params.aspectRatio } };

        const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
            model: modelToUse,
            contents: { parts: parts },
            config: config
        }), undefined, params.signal);

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { src: part.inlineData.data || null, error: null };
        }
        return { src: null, error: 'No image returned.' };
    } catch (error) {
        return { src: null, error: parseErrorMessage(error) };
    }
}

export async function generateSingleImage(
    prompt: string,
    aspectRatio: string,
    characterStyle: string, // 'Afro-toon' or 'General'
    visualStyle: string,    // '3D Render', 'Realistic', etc.
    genre: string,
    allCharactersWithStyles: Character[], 
    imageModel: string,
    referenceImageSrc?: string | null,
    referenceDescriptionOverride?: string | null,
    signal?: AbortSignal
): Promise<{ src: string | null; error: string | null }> {
    const ai = getAiClient();
    try {
        let referenceDescription = '';
        if (referenceDescriptionOverride) referenceDescription = referenceDescriptionOverride;
        else if (referenceImageSrc) referenceDescription = await describeImageForConsistency(referenceImageSrc, signal);

        const charactersWithVisualRef = allCharactersWithStyles.filter(
            c => c.name && c.originalImageBase64 && c.originalImageMimeType && prompt.toLowerCase().includes(c.name.toLowerCase())
        );

        let forceNanoBanana = charactersWithVisualRef.length > 0;
        const contentsParts: Part[] = [];

        // STRICT CONSISTENCY INJECTION FOR TEXT-TO-IMAGE
        // Even if we don't have a visual reference image (or if we do), we explicitely inject the description text.
        // This ensures "Same clothes" logic persists even if the visual reference is weak or missing.
        const mentionedCharacters = allCharactersWithStyles.filter(c => prompt.toLowerCase().includes(c.name.toLowerCase()));
        const consistencyText = mentionedCharacters.map(c => {
             return `MANDATORY APPEARANCE for ${c.name}: ${c.description || 'Standard appearance'}. Ensure they wear the same clothes described.`;
        }).join(' ');

        if (charactersWithVisualRef.length > 0) {
            const names = charactersWithVisualRef.map(c => c.name).join(', ');
            const integrity = `You are recreating specific characters (${names}). Preserve their exact appearance from the reference images. Place them in the new scene. Style: ${visualStyle}.`;
            contentsParts.push({ text: integrity });
            charactersWithVisualRef.forEach(char => {
                contentsParts.push({ inlineData: { data: char.originalImageBase64!, mimeType: char.originalImageMimeType! } });
            });
        }
        
        const genreInstruction = genre && genre.toLowerCase() !== 'general' 
            ? `**Genre:** The story must be in the **${genre}** genre.` 
            : '';
        const styleInstructions = getStyleInstructions(visualStyle);
        const visualReferencePreamble = referenceDescription ? `\nConsistency: Scene must match this: ${referenceDescription}` : '';
        
        // CONDITIONAL PROMPT
        const racialMandate = characterStyle === 'Afro-toon' 
            ? `\n**Cultural Context:** Ensure human characters are of Black African descent.`
            : '';
        
        const baseTextPrompt = `${racialMandate}${visualReferencePreamble}\n**SCENE:** "${prompt}"\n**STYLE:** ${styleInstructions}\n${consistencyText}\n${genreInstruction}`;
        contentsParts.push({ text: baseTextPrompt });
        
        const modelToUse = (forceNanoBanana && imageModel === 'gemini-2.5-flash-image') ? 'gemini-2.5-flash-image' : imageModel;
        
        if (modelToUse.includes('gemini')) {
             const config: any = { imageConfig: { aspectRatio: aspectRatio } };
             if (modelToUse === 'gemini-3-pro-image-preview') config.tools = [{google_search: {}}];

            const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                model: modelToUse,
                contents: { parts: contentsParts }, 
                config: config,
            }), undefined, signal);

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) return { src: part.inlineData.data || null, error: null };
            }
            return { src: null, error: 'No image returned.' };
        } else {
             // Imagen fallback (simplified)
             const textPrompt = contentsParts.map(p => (p as any).text).join(' ');
             const response: any = await withRetry(() => ai.models.generateImages({
                model: imageModel,
                prompt: textPrompt,
                config: { numberOfImages: 1, aspectRatio: aspectRatio, outputMimeType: 'image/png' },
            }), undefined, signal);
            if (response?.generatedImages?.[0]?.image?.imageBytes) return { src: response.generatedImages[0].image.imageBytes, error: null };
            return { src: null, error: 'No image returned.' };
        }
    } catch (error) {
        return { src: null, error: parseErrorMessage(error) };
    }
}

export async function generateStructuredStory(
    prompt: string,
    title: string,
    characters: Character[], // CHANGED: Accepts full Character objects
    wantsDialogue: boolean,
    characterStyle: string,
    genre: string = 'General',
    movieStyle: string = 'Hollywood',
    signal?: AbortSignal
): Promise<StorybookParts> {
    const ai = getAiClient();
    
    // ENFORCE NIGERIAN PIDGIN/ACCENT IF AFRO-TOON
    const accentInstruction = characterStyle === 'Afro-toon' 
        ? "**IMPORTANT: Write all dialogue and narration in authentic Nigerian Pidgin English or Nigerian-accented English to match the African tone.**"
        : "";

    const dialogueInstruction = wantsDialogue ? "Include dialogue in the script where appropriate." : "Write a purely narrative script, no dialogue.";
    
    // GET MOVIE STYLE INSTRUCTIONS
    const movieStyleInstruction = getMovieStyleInstructions(movieStyle);

    // INJECT CONSISTENCY BIBLE
    const consistencyBible = getCharacterConsistencyBible(characters);
    const characterNames = characters.map(c => c.name).join(', ');

    const userPrompt = `Write a story based on: "${prompt}". Title: ${title}. Characters: ${characterNames}. 
    Genre: ${genre}.
    ${movieStyleInstruction}
    ${dialogueInstruction}
    ${accentInstruction}
    
    ${consistencyBible}

    **ENVIRONMENT CONSISTENCY RULE:**
    Establish a consistent location visual (setting, lighting, atmosphere) in the first scene and reuse those visual tags in subsequent scenes if the location hasn't changed.
    
    Structure the response as a JSON object with the following schema:
    {
      "storyNarrative": "Full story text...",
      "scenes": [
        {
          "imageDescription": "Visual description for image generation. MUST include the EXACT clothing and physical details from the Character Consistency Bible for any character present.",
          "script": "Combined narration and dialogue for this scene. Format dialogue as 'Character Name: Speech'."
        }
      ]
    }`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ text: userPrompt }],
        config: { responseMimeType: "application/json" }
    }), undefined, signal);

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No JSON response from model.");
    return JSON.parse(jsonStr);
}

export async function generateScenesFromNarrative(
    narrative: string,
    characters: Character[], // CHANGED: Accepts full Character objects
    wantsDialogue: boolean,
    characterStyle: string,
    movieStyle: string = 'General',
    signal?: AbortSignal
): Promise<StoryboardSceneData[]> {
    const ai = getAiClient();
    
    // ENFORCE NIGERIAN PIDGIN/ACCENT IF AFRO-TOON
    const accentInstruction = characterStyle === 'Afro-toon'
        ? "If dialogue is requested, ensure it uses authentic Nigerian Pidgin English."
        : "";

    const dialogueInstruction = wantsDialogue 
        ? "Enhance the story by adding dialogue where appropriate." 
        : "STRICT MODE: The user has provided their own story. Do NOT rewrite, summarize, or alter the narrative text in the 'script' field. You must use the provided text verbatim, splitting it into scenes if necessary. Your PRIMARY task is to generate the 'imageDescription' for visualization.";
    
    const movieStyleInstruction = getMovieStyleInstructions(movieStyle);

    // INJECT CONSISTENCY BIBLE
    const consistencyBible = getCharacterConsistencyBible(characters);
    const characterNames = characters.map(c => c.name).join(', ');

    const userPrompt = `Analyze the following story and break it into visual scenes. 
    Story: "${narrative}". 
    Characters: ${characterNames}. 
    ${movieStyleInstruction}
    ${dialogueInstruction}
    ${accentInstruction}
    
    ${consistencyBible}

    **ENVIRONMENT CONSISTENCY RULE:**
    Establish a consistent location visual (setting, lighting, atmosphere) in the first scene and reuse those visual tags in subsequent scenes if the location hasn't changed.

    Return JSON array of objects:
    [
      {
        "imageDescription": "Visual description of the scene. MUST include the EXACT clothing and physical details from the Character Consistency Bible for any character present.",
        "script": "The narrative text for this scene."
      }
    ]`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ text: userPrompt }],
        config: { responseMimeType: "application/json" }
    }), undefined, signal);

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No JSON response from model.");
    return JSON.parse(jsonStr);
}

export async function regenerateSceneVisual(
    script: string,
    characters: Character[],
    signal?: AbortSignal
): Promise<string> {
    const ai = getAiClient();
    // Use consistency bible here too if full chars provided
    const consistencyBible = getCharacterConsistencyBible(characters);
    const characterNames = characters.map(c => c.name).join(', ');

    const prompt = `Based on the following script line, generate a new, creative, detailed visual description for an AI image generator.
    Script: "${script}"
    Characters available: ${characterNames}
    
    ${consistencyBible}
    
    Output ONLY the visual description string (subject, setting, action, lighting, style keywords).`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ text: prompt }]
    }), undefined, signal);

    return response.text ? response.text.trim() : "";
}

export async function generateStorybookSpeech(text: string, voice: string, expression: string, accent?: string, signal?: AbortSignal): Promise<string | null> {
    const ai = getAiClient();
    // Inject stronger accent prompt if provided
    const prompt = `(${expression}${accent ? `, ${accent}` : ''}): ${text}`;
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice as any } } } },
    }), undefined, signal);
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
}

export async function generateVideoFromScene(
    scene: StoryboardScene,
    aspectRatio: string,
    scriptPrompt: string,
    audioOptions: AudioOptions | null,
    visualStyle: string,
    characterStyle: string, // New Parameter to detect Afro-toon
    videoModel: string,
    resolution: '720p' | '1080p',
    cameraMovement: string,
    onProgress: (message: string) => void,
    previousVideoObject: any,
    signal?: AbortSignal
): Promise<{ videoUrl: string | null; audioUrl: string | null; videoObject: any; audioBase64: string | null; }> {
    const ai = getAiClient();
    if (!scene.src) return { videoUrl: null, audioUrl: null, videoObject: null, audioBase64: null };

    let audioBase64: string | null = null;
    
    // DETERMINE ACCENT BASED ON STYLE
    const speechAccent = characterStyle === 'Afro-toon' ? 'Nigerian Accent, Pidgin English' : undefined;

    if (audioOptions && audioOptions.mode === 'tts') {
        audioBase64 = await generateStorybookSpeech(audioOptions.data, 'Kore', 'Storytelling', speechAccent, signal);
    } else if (audioOptions && audioOptions.mode === 'upload') {
        audioBase64 = audioOptions.data;
    } else if (scriptPrompt && !audioOptions) {
        // AUTO-GENERATE AUDIO FROM SCRIPT IF PRESENT AND NO AUDIO OPTIONS PROVIDED
        // This ensures the dialogue speaks in the video
        onProgress("Generating audio...");
        audioBase64 = await generateStorybookSpeech(scriptPrompt, 'Kore', 'Storytelling', speechAccent, signal);
    }
    
    // Prompt constr
    let finalPrompt = scriptPrompt || scene.prompt;
    if (CAMERA_MOVEMENT_PROMPTS[cameraMovement]) finalPrompt = `${CAMERA_MOVEMENT_PROMPTS[cameraMovement]} Scene: ${finalPrompt}`;
    
    const payload: any = { model: videoModel, prompt: finalPrompt, config: { numberOfVideos: 1, resolution, aspectRatio: aspectRatio as any } };
    if (previousVideoObject) payload.video = previousVideoObject;
    else payload.image = { imageBytes: scene.src, mimeType: 'image/png' };

    let op: GenerateVideosOperation = await withRetry(() => ai.models.generateVideos(payload), onProgress, signal);
    
    // Polling logic...
    while (!op.done) {
        if (signal?.aborted) throw new Error("Aborted");
        await delay(10000);
        op = await ai.operations.getVideosOperation({ operation: op });
        onProgress(`Processing... ${op.metadata?.progressPercentage || 0}%`);
    }
    
    const uri = op.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) throw new Error("No video returned.");
    
    // Fetch with API Key and robust error handling
    const fetchUrl = `${uri}&key=${process.env.API_KEY}`;
    
    // Initial fetch
    let resp = await fetch(fetchUrl);
    
    if (!resp.ok) {
        // Fallback: try fetching without key, just in case (sometimes pre-signed URLs don't need it)
        try {
             const fallbackResp = await fetch(uri);
             if (fallbackResp.ok) {
                 resp = fallbackResp;
             } else {
                 throw new Error(`Failed to download video: ${resp.status} ${resp.statusText}`);
             }
        } catch (e) {
             throw new Error(`Failed to download video: ${resp.status} ${resp.statusText}`);
        }
    }
    
    const blob = await resp.blob();
    
    if (blob.size < 1000) {
         throw new Error("Downloaded video file is empty or invalid (0 bytes). Please try regenerating.");
    }

    return { videoUrl: URL.createObjectURL(blob), audioUrl: audioBase64 ? URL.createObjectURL(pcmToWavBlob(base64ToBytes(audioBase64))) : null, videoObject: op.response?.generatedVideos?.[0]?.video, audioBase64 };
}

export async function generateVideoFromImages(
    animationMode: 'start' | 'startEnd' | 'reference',
    images: ({ base64: string; mimeType: string } | null)[],
    prompt: string,
    videoModel: string,
    aspectRatio: string,
    resolution: '720p' | '1080p',
    onProgress: (message: string) => void,
    signal?: AbortSignal
): Promise<{ videoUrl: string | null; videoObject: any; }> {
    const ai = getAiClient();
    const payload: any = { model: videoModel, prompt, config: { numberOfVideos: 1, resolution, aspectRatio: aspectRatio as any } };

    if (animationMode === 'start') payload.image = { imageBytes: images[0]!.base64, mimeType: images[0]!.mimeType };
    if (animationMode === 'startEnd') {
        payload.image = { imageBytes: images[0]!.base64, mimeType: images[0]!.mimeType };
        payload.config.lastFrame = { imageBytes: images[1]!.base64, mimeType: images[1]!.mimeType };
    }
    if (animationMode === 'reference') {
        payload.model = 'veo-3.1-generate-preview';
        payload.config.resolution = '720p'; // Forced
        payload.config.referenceImages = images.filter(i=>i).map(i => ({ image: { imageBytes: i!.base64, mimeType: i!.mimeType }, referenceType: VideoGenerationReferenceType.ASSET }));
    }

    let op: GenerateVideosOperation = await withRetry(() => ai.models.generateVideos(payload), onProgress, signal);
    while (!op.done) {
        if (signal?.aborted) throw new Error("Aborted");
        await delay(10000);
        op = await ai.operations.getVideosOperation({ operation: op });
        onProgress(`Processing... ${op.metadata?.progressPercentage || 0}%`);
    }
    const uri = op.response?.generatedVideos?.[0]?.video?.uri;
    
    // Fetch with API Key
    const fetchUrl = `${uri}&key=${process.env.API_KEY}`;
    const resp = await fetch(fetchUrl);
    
    if (!resp.ok) {
        throw new Error(`Failed to download video: ${resp.status}`);
    }
    
    const blob = await resp.blob();
    return { videoUrl: URL.createObjectURL(blob), videoObject: op.response?.generatedVideos?.[0]?.video };
}

export async function generateCameraAnglesFromImage(
    referenceScene: StoryboardScene,
    generationInfo: { aspectRatio: string; characterStyle: string; visualStyle: string; genre: string; characters: Character[]; imageModel: string; },
    angleNames: string[],
    focusSubject: string,
    onProgress: (message: string) => void,
    signal?: AbortSignal
  ): Promise<StoryboardScene[]> {
    // 1. Outpaint
    const { src: extSrc } = await editImage({
        imageBase64: referenceScene.src!, mimeType: 'image/png', editPrompt: "Outpaint environment.", aspectRatio: generationInfo.aspectRatio,
        characterStyle: generationInfo.characterStyle, visualStyle: generationInfo.visualStyle, genre: generationInfo.genre, characters: generationInfo.characters, signal, imageModel: 'gemini-2.5-flash-image'
    });
    // 2. Analyze (simplified call)
    // 3. Generate views
    const scenes: StoryboardScene[] = [];
    for (const angle of angleNames) {
        onProgress(`Generating ${angle}...`);
        const { src, error } = await editImage({
            imageBase64: extSrc!, mimeType: 'image/png', editPrompt: `Camera view: ${angle}. Subject: ${focusSubject}.`, aspectRatio: generationInfo.aspectRatio,
            characterStyle: generationInfo.characterStyle, visualStyle: generationInfo.visualStyle, genre: generationInfo.genre, characters: generationInfo.characters, signal, imageModel: 'gemini-2.5-flash-image'
        });
        scenes.push({ prompt: angle, src, error, angleName: angle });
    }
    return scenes;
}
