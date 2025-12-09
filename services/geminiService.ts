
import { GoogleGenAI, Type, GenerateContentResponse, Modality, Part, GenerateVideosOperation } from "@google/genai";
import { base64ToBytes, pcmToWavBlob } from "../utils/fileUtils";
import { parseErrorMessage } from "../utils/errorUtils";

// Add Character type to be used in App.tsx
export type Character = {
  id: number;
  name: string;
  imagePreview: string | null;
  originalImageBase64: string | null; // New field for the original base64 image data
  originalImageMimeType: string | null; // New field for the original image MIME type
  description: string | null;
  detectedImageStyle: string | null; // New field for the style of the uploaded image
  isDescribing: boolean;
};

export type StoryboardSceneData = {
    id: number;
    imageDescription: string;
    narration: string;
    isDescriptionLocked?: boolean;
    isNarrationLocked?: boolean;

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
  imageStyle: string;
  genre: string;
  characters: Character[];
  hasVisualMasks?: boolean;
  signal?: AbortSignal;
  imageModel?: string;
  overlayImage?: { base64: string; mimeType: string; };
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
                const delaySeconds = Math.pow(2, attempt) * 15; // 30s, 60s
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
    isCameraAngleFor?: number; // Index of the parent scene
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
        case 'Afro-toon':
            return `A vibrant 2D cartoon style inspired by Nigerian art. Characters are drawn with expressive faces and normal human proportions. They wear colorful traditional Nigerian attire like agbada, kaftans, or gele. The art uses bold, clean outlines and a simple, flat color palette, creating a lively and humorous feel. This is NOT a realistic or 3D style.`;
        case 'Realistic Photo':
            return `A hyper-realistic, cinematic photograph. 8k resolution, high fidelity, realistic skin textures, natural lighting, and true-to-life proportions. Shot on a professional 35mm camera. NOT a drawing, NOT a painting, NOT a 3D render, NOT anime.`;
        case '3D Render':
            return `A high-quality 3D render, similar to modern animated feature films (Pixar/Disney style). Smooth textures, volumetric lighting, ambient occlusion, slightly stylized but three-dimensional character proportions.`;
        case 'Anime':
            return `Japanese Anime style. Cel-shaded, vibrant colors, expressive eyes, dynamic composition. 2D animation aesthetic.`;
        case 'Illustration':
            return `A modern digital illustration. Clean lines, artistic shading, detailed but stylized.`;
        case 'Oil Painting':
            return `Classic oil painting style. Visible brush strokes, rich textures, painterly lighting, canvas texture.`;
        case 'Pixel Art':
            return `Retro pixel art style. Low-res, blocky pixels, limited color palette, 8-bit or 16-bit video game aesthetic.`;
        case '2D Flat':
            return `Flat 2D design. Minimalist, solid colors, no gradients, clean geometric shapes, corporate art style.`;
        case 'Video Game':
            return `Modern video game graphics (Unreal Engine 5 style). High detail, dynamic lighting, glossy textures, cinematic game composition.`;
        case 'Watercolor':
            return `Watercolor painting style. Soft edges, bleed effects, paper texture, pastel and washed-out colors, artistic and dreamy.`;
        case 'Cyberpunk':
            return `Cyberpunk aesthetic. Neon lights, high contrast, futuristic technology, gritty urban environment, purple and blue color palette.`;
        default:
             // If it's a custom string or generic, try to embellish slightly if it looks like a simple name, otherwise return as is.
            return `In the style of ${style}.`;
    }
}

export async function generateCharacterDescription(imageBase64: string, mimeType: string, signal?: AbortSignal): Promise<{ description: string; detectedStyle: string }> {
    const ai = getAiClient();
    const imagePart = { inlineData: { data: imageBase64, mimeType }};
    const prompt = `Analyze the person in the image. Generate a concise, single-line, comma-separated list of descriptive tags for an AI image generator to ensure high-fidelity recreation. Also, identify the primary visual art style of the character in the image from the following options: "Afro-toon", "Illustration", "3D Render", "Realistic Photo", "Oil Painting", "Pixel Art", "2D Flat", "Anime", "Clip Art", "Video Game", "Pastel Sketch", "Dark Fantasy", "Cyberpunk", "Steampunk", "Watercolor", "Art Nouveau". If the style doesn't fit exactly, choose the closest or provide a brief custom description.

    **CRITICAL RULES:**
    1.  **Format:** Return a JSON object with two keys: "description" (string) and "detectedStyle" (string).
    2.  **Description Content:** Include gender, estimated age, ethnicity, face shape, eye color/shape, hair color/style, skin tone, and any highly distinctive features (e.g., beard, glasses, specific clothing if iconic). This should be a compact "character token" suitable for embedding.
    3.  **Detected Style Content:** Choose one style from the provided list, or describe it concisely if not on the list.

    **Example Output:**
    {
        "description": "woman, early 30s, West African, round face, dark brown eyes, long black braids, dark brown skin, wearing gold hoop earrings",
        "detectedStyle": "Realistic Photo"
    }`;


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
    if (typeof text !== 'string') {
        console.error("generateCharacterDescription received no text in response:", JSON.stringify(response, null, 2));
        throw new Error("Failed to get a valid text response from the AI. The prompt may have been blocked or the model returned an empty result.");
    }

    try {
        const parsed = JSON.parse(text);
        return { description: parsed.description.trim(), detectedStyle: parsed.detectedStyle.trim() };
    } catch (e) {
        console.error("Failed to parse JSON response from character description:", text, e);
        throw new Error("Failed to get a valid JSON response from the AI for character description.");
    }
}

export async function generateCharacterVisual(
    character: Character,
    uiSelectedStyle: string,
    signal?: AbortSignal
): Promise<{ src: string | null; error: string | null }> {
    
    // Path 1: User has uploaded an image and wants a consistent, full-body version.
    if (character.originalImageBase64 && character.originalImageMimeType) {
        
        // Determine the target style based on user's special rules.
        let targetStyle = character.detectedImageStyle || uiSelectedStyle; // Default to detected style or fall back to UI selection.
        if (character.detectedImageStyle === 'Realistic Photo') {
            targetStyle = 'Illustration'; // Per user request to convert "human" to illustration.
        }

        const editPrompt = `Using the provided image as a perfect reference, generate a full-body view of the exact same character, '${character.name}'. The character's face, features, clothing, hairstyle, and colors must be perfectly preserved to be exactly the same as the reference. Place the character in a standing pose on a plain, solid white background. Do not add any shadows or other elements. The final image must be in the style of '${targetStyle}'.`;

        return editImage({
            imageBase64: character.originalImageBase64,
            mimeType: character.originalImageMimeType,
            editPrompt: editPrompt,
            aspectRatio: '3:4',
            imageStyle: targetStyle,
            genre: 'General',
            characters: [character], // Provide itself for context
            hasVisualMasks: false,
            signal: signal,
            imageModel: 'gemini-2.5-flash-image', // Use NanoBanana as requested
        });

    } 
    // Path 2: User has only provided a text description.
    else if (character.description) {
        const prompt = `Character sheet for a character named '${character.name}'. Full-body view from head to toe, centered, standing pose. ${character.description}. The background must be completely plain, solid white. No shadows, no other objects, no gradients.`;
        
        // Use generateSingleImage to create from text.
        return generateSingleImage(
            prompt,
            '3:4',
            uiSelectedStyle, // Use the style selected in the UI for text-based generation.
            'General', 
            [character],
            [character],
            'gemini-2.5-flash-image', // Use NanoBanana as requested.
            null,
            null,
            signal
        );
    }
    // Path 3: Not enough information to generate.
    else {
        return { src: null, error: "Cannot generate visual without an original image or a description." };
    }
}

export async function describeImageForConsistency(imageBase64: string, signal?: AbortSignal): Promise<string> {
    const ai = getAiClient();
    const imagePart = { inlineData: { data: imageBase64, mimeType: 'image/png' }};
    const prompt = `You are an expert scene analyst for an AI image generator. Your task is to generate a very concise, comma-separated list of descriptive tags for the provided image.

**CRITICAL RULES:**
1.  **Format:** A single line of comma-separated tags. **DO NOT** use sentences, paragraphs, or labels (e.g., "Character:", "Setting:").
2.  **Content:** Focus only on the most essential visual elements needed for recreation:
    *   **Subject:** Main character(s) and their core features (e.g., 'boy with red shirt').
    *   **Setting:** The immediate environment (e.g., 'in a classroom', 'at a desk').
    *   **Atmosphere:** Key lighting and mood (e.g., 'sunny day', 'dim lighting').
3.  **Brevity:** The entire output should be as short as possible while preserving the scene's essence. Aim for keywords over full descriptions.
4.  **Goal:** Create a compact "scene token" that can be directly embedded into a larger prompt.

**Example:** boy with blue shirt, sitting at a wooden desk, classroom, bright daylight, simple cartoon style.`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [imagePart, { text: prompt }]}
    }), undefined, signal);

    return response.text.trim();
}


async function transcribeAudio(audioBase64: string, mimeType: string, signal?: AbortSignal): Promise<string> {
    const ai = getAiClient();
    const audioPart = { inlineData: { data: audioBase64, mimeType: mimeType } };
    const prompt = `Transcribe the audio recording. Provide only the text of the speech. If there is no speech, return an empty string.`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [audioPart, { text: prompt }] },
    }), undefined, signal);

    return response.text.trim();
}

export async function generatePromptFromAudio(audioBase64: string, mimeType: string, signal?: AbortSignal): Promise<string> {
    return await transcribeAudio(audioBase64, mimeType, signal);
}


async function generatePromptsFromBase(
  basePrompt: string,
  sceneCount: number,
  genre: string,
  characters: Character[],
  signal?: AbortSignal
): Promise<string[]> {
    const ai = getAiClient();
    const genreInstruction = genre && genre.toLowerCase() !== 'general' 
        ? `**Genre:** The story must be in the **${genre}** genre.` 
        : '';
    
    let characterInstruction = '';
    if (characters.length > 0) {
        const characterDetails = characters
            .filter(c => c.name && c.description)
            .map(c => `  - ${c.name}: ${c.description}`)
            .join('\n');
        characterInstruction = `**Available Characters (CRITICAL INSTRUCTION):**
You have access to a list of pre-defined characters. If the user's "Core Idea" mentions any of these characters by name, you MUST incorporate them into the story.
When you describe these characters in the scene prompts, you MUST adhere strictly to their visual descriptions provided below.
If a character is NOT mentioned by name in the "Core Idea", DO NOT include them in the story.

**Character Details:**
${characterDetails}

**Implicit Characters:** If the user's "Core Idea" mentions other character names not listed above, you should also include them in the story. Generate a consistent appearance for them.`;
    }

    const racialInstruction = `For cultural context and consistency, please ensure all human characters in the story and scene descriptions are of Black African descent.`;

    const prompt = `You are a creative assistant generating prompts for an image AI. Your primary goal is to create safe, clear, and visually descriptive scenes.

    **Task:** Based on the user's core idea, create ${sceneCount} sequential scene descriptions.

    ${racialInstruction}

    **Core Idea:** "${basePrompt}"
    ${genreInstruction}
    ${characterInstruction}

    **CRITICAL SAFETY & CLARITY RULES:**
    1.  **Language:** Use simple, direct, and unambiguous language. Describe only what should be physically visible in the image.
    2.  **Prohibited Content:** STRICTLY AVOID any mention, hint, or description of violence, weapons, conflict, aggression, political themes, social commentary, or any sensitive topics that could be misinterpreted by a safety filter.
    3.  **Focus:** Concentrate on positive or neutral actions, settings, and character interactions.
    4.  **Goal:** The final prompts must be 100% safe-for-work and family-friendly.

    The output must be a JSON object containing an array of these safe, visual prompts.`;
    
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    prompts: {
                        type: Type.ARRAY,
                        description: `An array of ${sceneCount} unique and descriptive image prompts that form a coherent story, following all safety rules.`,
                        items: {
                            type: Type.STRING,
                            description: 'A simple, safe, and detailed visual description for a single story scene.'
                        }
                    }
                },
                required: ['prompts']
            }
        }
    }), undefined, signal);
    
    try {
        const jsonStr = response.text.trim();
        const parsed = JSON.parse(jsonStr);

        if (!parsed.prompts || !Array.isArray(parsed.prompts) || parsed.prompts.length === 0) {
            throw new Error("AI failed to return a valid array of prompts.");
        }
        
        return parsed.prompts;
    } catch (e) {
        console.error("Failed to parse prompts JSON from AI:", response.text, e);
        throw new Error("The AI returned a response that was not valid JSON. Please try again.");
    }
}

function isCartoonStyle(style: string): boolean {
    const cartoonKeywords = ['cartoon', '2d flat', 'anime', 'pixel art', 'illustration', 'clip art', 'video game', 'pastel sketch'];
    return cartoonKeywords.some(keyword => style.toLowerCase().includes(keyword));
}

export async function generateSingleImage(
    prompt: string,
    aspectRatio: string,
    imageStyle: string, // User selected style from UI
    genre: string,
    charactersForPrompt: Character[], // Characters for prompt content (descriptions) - now full Character array
    allCharactersWithStyles: Character[], // Full character objects to access detectedImageStyle AND original image data
    imageModel: string,
    referenceImageSrc?: string | null,
    referenceDescriptionOverride?: string | null,
    signal?: AbortSignal
): Promise<{ src: string | null; error: string | null }> {
    const ai = getAiClient();
    try {
        let referenceDescription = '';
        if (referenceDescriptionOverride) {
            referenceDescription = referenceDescriptionOverride;
        } else if (referenceImageSrc) {
            referenceDescription = await describeImageForConsistency(referenceImageSrc, signal);
        }

        const charactersWithVisualRef = allCharactersWithStyles.filter(
            c => c.name && c.originalImageBase64 && c.originalImageMimeType && prompt.toLowerCase().includes(c.name.toLowerCase())
        );

        let forceNanoBanana = charactersWithVisualRef.length > 0;
        let characterIntegrityInstruction = '';
        const contentsParts: Part[] = [];

        if (charactersWithVisualRef.length > 0) {
            const characterNames = charactersWithVisualRef.map(c => `'${c.name}'`).join(', ');

            characterIntegrityInstruction = `You are an expert at high-fidelity character recreation. You have been given ${charactersWithVisualRef.length > 1 ? 'multiple' : 'a'} **Character Reference Image(s)**. Your task is to place this/these character(s) into a new scene.

**CRITICAL RULES:**
1.  **Absolute Character Integrity:** This is your highest priority. Each character in the output image MUST be a perfect visual match to their corresponding **Character Reference Image**. You MUST preserve their exact original design, appearance, clothing, and identity. Do NOT change their features or art style in any way.
2.  **Seamless Scene Integration:** Place these exact characters into the scene based on the main "SCENE" prompt. You must adjust the characters' poses, positions, and lighting to make them fit naturally within the new environment, but their core appearance and clothing MUST remain unchanged.
3.  **Identify Correctly:** The reference images provided correspond to the character(s): ${characterNames}. The order of images matches this list.
4.  **Final Style:** The final, composite image MUST be rendered in a '${imageStyle}' style.
---
`;
            
            charactersWithVisualRef.forEach(char => {
                contentsParts.push({
                    inlineData: {
                        data: char.originalImageBase64!,
                        mimeType: char.originalImageMimeType!
                    }
                });
            });
        }
        
        const charactersForTextBlock = allCharactersWithStyles.filter(
            c => c.name && c.description && prompt.toLowerCase().includes(c.name.toLowerCase()) && !charactersWithVisualRef.some(ci => ci.id === c.id)
        );

        let finalCharacterBlock = '';
        if (charactersForTextBlock.length > 0) {
            const characterDescriptions = charactersForTextBlock.map(c => `- **${c.name}**: ${c.description}`).join('\n');
            finalCharacterBlock = `---
**DEFINED CHARACTERS (CRITICAL & ABSOLUTE REQUIREMENT):**
The generated image features one or more characters. For any character whose name is listed below, it is absolutely essential that you generate a high-fidelity visual representation based on their provided description.

**GENDER & IDENTITY:** Pay extremely close attention to the specified gender. If the description says "woman", you MUST generate a woman. If it says "man", you MUST generate a man. This is a non-negotiable instruction. Any deviation from the specified gender is a complete failure.

**PHYSICAL FEATURES:** Adhere strictly to all other specified features like age, ethnicity, hair, and eye color.

**List of Defined Characters:**
${characterDescriptions}

**For any other characters mentioned in the SCENE prompt but not listed above, create a visually appropriate appearance for them.**
---
`;
        }
        
        // Use detailed style instructions
        const styleInstructions = getStyleInstructions(imageStyle);
        
        const genreInstruction = genre && genre.toLowerCase() !== 'general' ? genre : '';
        
        const visualReferencePreamble = referenceDescription
            ? `\n---
**VISUAL CONSISTENCY MANDATE:**
The entire scene (character, background, lighting, and atmosphere) must be visually consistent with the following detailed description. Recreate this scene exactly, but from the new perspective requested in the SCENE section.
**Reference Scene Description:**
${referenceDescription}
---
`
            : '';
        
        const racialMandate = `---
**Cultural Context:**
For consistency with the story's setting, please ensure that all human characters depicted are of Black African descent.
---
`;
        
        const isGenerateContentModel = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'].includes(imageModel) || forceNanoBanana;
        const isImagenFamily = imageModel === 'imagen-4.0-generate-001';
        const aspectRatioInstruction = isGenerateContentModel ? `\n**ASPECT RATIO (CRITICAL):** The image must be generated in a ${aspectRatio} aspect ratio.` : '';

        let baseTextPrompt = `${characterIntegrityInstruction}${racialMandate}${finalCharacterBlock}${visualReferencePreamble}\n**SCENE:** "${prompt}"\n**IMAGE_STYLE_GUIDE:** ${styleInstructions}${aspectRatioInstruction}`;
        if (genreInstruction) {
             baseTextPrompt += `\n**GENRE:** ${genreInstruction}`;
        }
        contentsParts.push({ text: baseTextPrompt });
        
        if (isGenerateContentModel) {
            const modelToUse = forceNanoBanana ? 'gemini-2.5-flash-image' : imageModel;
            const config: any = {};
            if (modelToUse === 'gemini-2.5-flash-image' || modelToUse === 'gemini-3-pro-image-preview') {
                 config.imageConfig = { aspectRatio: aspectRatio };
            }
            if (modelToUse === 'gemini-3-pro-image-preview') {
                config.tools = [{google_search: {}}];
            }


            const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                model: modelToUse,
                contents: { parts: contentsParts }, 
                config: config,
            }), undefined, signal);

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    return { src: part.inlineData.data, error: null };
                }
            }
            console.warn(`Image generation call was successful but returned no image. Full response:`, response);
            return { src: null, error: 'The model returned a success status but no image data. This may be due to a safety filter or an issue with the complexity of the prompt. Please try a different prompt.' };
        }

        if (isImagenFamily) {
            const textForImagen = contentsParts.map(part => (part as {text: string}).text || '').join('\n');
    
            const response: any = await withRetry(() => ai.models.generateImages({
                model: imageModel,
                prompt: textForImagen,
                config: {
                    numberOfImages: 1,
                    aspectRatio: aspectRatio,
                    outputMimeType: 'image/png',
                },
            }), undefined, signal);
    
            if (response && response.generatedImages && response.generatedImages.length > 0 && response.generatedImages[0].image?.imageBytes) {
                return { src: response.generatedImages[0].image.imageBytes, error: null };
            } else {
                console.warn(`Image call was successful but returned no image. Full response:`, response);
                return { src: null, error: 'The model returned a success status but no image data. This may be due to a safety filter or an issue with the complexity of the prompt. Please try a different prompt.' };
            }
        }
        
        // Fallback or error if no model matched
        return { src: null, error: `Unsupported image model selected: ${imageModel}` };
    } catch (error) {
        const parsedError = parseErrorMessage(error);
        // If aborted, we might want to return null error or specific error, but parseErrorMessage handles 'aborted' check
        if (signal?.aborted) {
             throw error; // Re-throw abort to stop upper loops
        }
        console.error(`Image could not be generated and will be skipped:`, parsedError);
        return { src: null, error: parsedError };
    }
}


async function generateImagesFromPrompts(
  prompts: string[],
  aspectRatio: string,
  imageStyle: string,
  genre: string,
  charactersForPrompt: Character[], // For prompt content - now full Character array
  allCharactersWithStyles: Character[], // Full character objects to access detectedImageStyle
  imageModel: string,
  onProgress: (message: string) => void,
  signal?: AbortSignal
): Promise<StoryboardScene[]> {
    const scenes: StoryboardScene[] = [];
    
    for (let i = 0; i < prompts.length; i++) {
        if (signal?.aborted) throw new Error("Aborted");

        const remaining = prompts.length - i;
        const loadingMessage = remaining > 1 ? `Generating... ${remaining} remaining` : `Generating scene...`;
        onProgress(loadingMessage);
        
        const { src, error } = await generateSingleImage(prompts[i], aspectRatio, imageStyle, genre, charactersForPrompt, allCharactersWithStyles, imageModel, null, null, signal);
        scenes.push({ prompt: prompts[i], src, error });

        if (i < prompts.length - 1) {
            onProgress(`Pausing to avoid rate limits...`);
            await delay(15000);
        }
    }
  
  return scenes;
}


export async function generateImageSet(
  promptText: string,
  imageCount: number,
  aspectRatio: string,
  imageStyle: string,
  genre: string,
  charactersForPrompt: Character[], // Characters for prompt content - now full Character array
  allCharactersWithStyles: Character[], // Full characters array to pass to generateImagesFromPrompts
  imageModel: string,
  onProgress: (message: string) => void,
  signal?: AbortSignal
): Promise<GenerationResult> {
  
  try {
    // If only 1 scene is requested, use the prompt directly without expanding it.
    // This supports the "Generate this Scene" workflow from the Storybook.
    if (imageCount === 1) {
        const storyboard = await generateImagesFromPrompts([promptText], aspectRatio, imageStyle, genre, charactersForPrompt, allCharactersWithStyles, imageModel, onProgress, signal);
        return { storyboard };
    }

    // Otherwise, use the "creative expansion" logic to generate multiple scene prompts.
    onProgress("Breaking down the story into scenes...");
    const scenePrompts = await generatePromptsFromBase(promptText, imageCount, genre, charactersForPrompt, signal);
    const storyboard = await generateImagesFromPrompts(scenePrompts, aspectRatio, imageStyle, genre, charactersForPrompt, allCharactersWithStyles, imageModel, onProgress, signal);
    return { storyboard };
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(parseErrorMessage(error));
    }
    throw new Error("An unknown error occurred during image set generation.");
  }
}

async function analyzeEnvironmentForCameraPlacement(
    imageBase64: string,
    angles: string[],
    focusSubject: string,
    signal?: AbortSignal
): Promise<Record<string, string>> {
    const ai = getAiClient();
    const imagePart = { inlineData: { data: imageBase64, mimeType: 'image/png' } };

    const focusInstruction = focusSubject === 'General Scene'
        ? 'Your task is to determine the most natural camera positions to achieve specific views of the main subject.'
        : `Your task is to determine the most natural camera positions to achieve specific views where the camera is focused on the character named '${focusSubject}'. The framing should prioritize this character.`;

    const prompt = `You are a virtual cinematographer analyzing a scene to find the best camera placements. Analyze the provided image. ${focusInstruction}

    **Analysis Steps:**
    1.  **Identify Subject & Orientation:** Locate the main character(s) and note the direction they are facing. If a specific focus subject is named, prioritize them.
    2.  **Describe Environment:** Briefly map out the key objects and walls around the subject.
    3.  **Determine Placements:** Based on the environment, describe the most logical and physically possible camera placements to achieve the requested views: ${angles.join(', ')}. The camera cannot be placed inside solid objects.

    **CRITICAL RULE: Scene Integrity**
    When describing the new camera perspective, you MUST instruct the AI to ONLY move the camera. The position, orientation, and pose of ALL scene elements (characters, furniture, vehicles, buildings, environment, etc.) must remain absolutely unchanged. The scene must be identical, just viewed from a different angle.

    **Output Format:**
    Your response MUST be a valid JSON object. For each requested angle (e.g., "back"), create a key named '<angle>_view_prompt' (e.g., "back_view_prompt"). The value for each key must be a concise instruction for an image generation AI that strictly adheres to the "Scene Integrity" rule.`;

    const properties: { [key: string]: { type: Type, description: string } } = {};
    const required: string[] = [];
    angles.forEach(angle => {
        const key = `${angle}_view_prompt`;
        properties[key] = {
            type: Type.STRING,
            description: `The detailed prompt for generating the ${angle} view.`
        };
        required.push(key);
    });

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Using Pro for better spatial reasoning
        contents: { parts: [imagePart, { text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties,
                required,
            }
        }
    }), undefined, signal);

    try {
        const jsonStr = response.text.trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse camera placement analysis JSON:", response.text, e);
        throw new Error("AI failed to return a valid camera placement plan.");
    }
}

export async function generateCameraAnglesFromImage(
    referenceScene: StoryboardScene,
    generationInfo: {
      aspectRatio: string;
      imageStyle: string;
      genre: string;
      characters: Character[];
      imageModel: string;
    },
    angleNames: string[],
    focusSubject: string,
    onProgress: (message: string) => void,
    signal?: AbortSignal
  ): Promise<StoryboardScene[]> {
    if (!referenceScene.src) {
      throw new Error("Reference scene is missing image source.");
    }
  
    onProgress(`Extending original image...`);
    const outpaintPrompt = "Perform 'outpainting' on this image. Extend the image on all sides to reveal more of the surrounding environment. Fill in the new areas naturally, seamlessly blending with the existing content, style, and lighting. Do not alter any of the original pixels. The goal is to create a wider, more complete view of the scene.";

    const { src: extendedImageSrc, error: extensionError } = await editImage({
        imageBase64: referenceScene.src,
        mimeType: 'image/png',
        editPrompt: outpaintPrompt,
        ...generationInfo,
        signal,
        imageModel: 'gemini-2.5-flash-image',
    });

    if (extensionError || !extendedImageSrc) {
        console.error("Failed to extend image for camera angle generation:", extensionError);
        throw new Error(`Could not extend the base image: ${extensionError || 'Unknown error'}`);
    }

    onProgress(`Analyzing extended environment...`);
    let cameraPrompts: Record<string, string> = {};

    if (angleNames.length > 0) {
        cameraPrompts = await analyzeEnvironmentForCameraPlacement(extendedImageSrc, angleNames, focusSubject, signal);
    }

    const generatedScenes: StoryboardScene[] = [];

    for (let i = 0; i < angleNames.length; i++) {
        if (signal?.aborted) throw new Error("Aborted");
        const angle = angleNames[i];
        
        // Ensure angleDisplayName is available early for error handling
        const angleDisplayName = CAMERA_ANGLE_OPTIONS.find(opt => opt.key === angle)?.name || angle;

        const anglePromptKey = `${angle}_view_prompt`;
        const finalEditPrompt = cameraPrompts[anglePromptKey];

        if (!finalEditPrompt) {
            console.warn(`No camera prompt generated for angle: ${angle}`);
            generatedScenes.push({ 
                prompt: `Failed to generate prompt for ${angle} view`, 
                src: null, 
                error: `AI analysis did not provide a prompt for the ${angle} view.`,
                angleName: angleDisplayName // Ensure error scenes also carry the name
            });
            continue;
        }

        onProgress(`Generating '${angleDisplayName}'... (${i + 1}/${angleNames.length})`);
        
        const { src: newImageSrc, error: newError } = await editImage({
          imageBase64: extendedImageSrc, 
          mimeType: 'image/png',
          editPrompt: finalEditPrompt,
          ...generationInfo,
          signal,
          imageModel: 'gemini-2.5-flash-image',
        });

        generatedScenes.push({ prompt: finalEditPrompt, src: newImageSrc, error: newError, angleName: angleDisplayName });

        if (i < angleNames.length - 1) {
          onProgress(`Pausing before next angle...`);
          await delay(15000);
        }
    }
    return generatedScenes;
}

export async function editImage(params: EditImageParams): Promise<{ src: string | null; error: string | null }> {
    const { imageBase64, mimeType, editPrompt, aspectRatio, imageStyle, genre, characters, hasVisualMasks, signal, imageModel, overlayImage } = params;
    const ai = getAiClient();
    
    const styleInstructions = getStyleInstructions(imageStyle);

    try {
        const contentsParts: Part[] = [];

        const imageToEditPart = { inlineData: { data: imageBase64, mimeType } };
        contentsParts.push(imageToEditPart);

        if (overlayImage) {
            const overlayImagePart = { inlineData: { data: overlayImage.base64, mimeType: overlayImage.mimeType } };
            contentsParts.push(overlayImagePart);
        }

        const charactersWithVisualRef = characters.filter(
             c => c.originalImageBase64 && c.originalImageMimeType && editPrompt.toLowerCase().includes(c.name.toLowerCase())
        );

        let finalPromptText = "";

        if (overlayImage) {
            finalPromptText = `You are an expert AI image composition editor. You have been given two images: a main "SCENE" image and an "OBJECT" image to composite into it.
            
**COMPOSITION INSTRUCTIONS (CRITICAL):**
1.  **Place Object:** Seamlessly integrate the "OBJECT" image into the "SCENE" image based on the "USER PROMPT" below.
2.  **Blend Naturally:** You MUST adjust the lighting, perspective, scale, and style of the "OBJECT" image to make it look like it was originally part of the "SCENE" image.
3.  **Scene Integrity:** Do NOT change the "SCENE" image except where the "OBJECT" image is placed.
4.  **Masking:** If GREEN MASK areas are present in the "SCENE" image, you MUST place the "OBJECT" image within those green areas.
5.  **Cleanup:** The final output image MUST NOT contain any red or green overlay colors.

**USER PROMPT:** "${editPrompt}"
`;
        } else if (hasVisualMasks) {
            finalPromptText = `You are an expert AI image editor. The provided image contains semi-transparent colored masks indicating specific edit operations.
            
**VISUAL EDITING INSTRUCTIONS (CRITICAL):**
1.  **RED MASK AREAS:** Areas highlighted in RED must be REMOVED/ERASED. Fill these areas naturally with the surrounding background or scene elements (inpainting).
2.  **GREEN MASK AREAS:** Areas highlighted in GREEN are target areas for content generation. Apply the "USER PROMPT" below to these specific areas.
3.  **CLEANUP:** The final output image MUST NOT contain any red or green overlay colors. It must look like a natural, finished image.

**USER PROMPT:** "${editPrompt}"
`;
        } else {
            finalPromptText = `You are an expert AI image editor. Your task is to modify the provided image based on the user's instructions.
**EDIT INSTRUCTION:** "${editPrompt}"
`;
        }

        if (charactersWithVisualRef.length > 0) {
            charactersWithVisualRef.forEach(c => {
                 contentsParts.push({ inlineData: { data: c.originalImageBase64!, mimeType: c.originalImageMimeType! } });
            });
            
            finalPromptText += `
**CHARACTER CONSISTENCY RULES:**
1.  **Enforce Character Consistency:** The character(s) mentioned in the prompt (${charactersWithVisualRef.map(c => c.name).join(', ')}) MUST be visually matched to the provided **Character Reference Image(s)**. Preserve their exact appearance, clothing, and identity. This is your highest priority.
2.  **Maintain Style & Scene:** Preserve the overall art style, lighting, and background elements of the original "Scene Image" unless the edit instruction specifically asks to change them. The final style must be: "${styleInstructions}".
3.  **Maintain Aspect Ratio:** The output image must have the same aspect ratio: ${aspectRatio}.
`;
            if (hasVisualMasks || overlayImage) {
                finalPromptText += `
4.  **CHARACTER/OBJECT PLACEMENT (GREEN MASK):** If "GREEN MASK AREAS" are present, you MUST generate the character(s) or composite the "OBJECT" image INSIDE the green masked area. Ensure it is scaled and positioned correctly to fit within that specific masked region.
`;
            }

        } else {
             finalPromptText += `
**CRITICAL RULES:**
1.  **Preserve Identity:** You MUST preserve the core identity, features, and style of the original image and any characters within it. Only apply the specific change requested.
2.  **Maintain Style:** The edited image's art style must perfectly match the original. The style is: "${styleInstructions}".
3.  **Maintain Aspect Ratio:** The output image must have the same aspect ratio as the input: ${aspectRatio}.
`;
        }

        const racialMandate = `---
**Cultural Context:**
For consistency, please ensure that any human characters depicted are of Black African descent.
---
`;
        
        const otherCharacters = characters.filter(c => !charactersWithVisualRef.some(ref => ref.id === c.id) && c.name && c.description);
        const otherCharacterBlock = otherCharacters.length > 0 ? `---
**OTHER CHARACTERS:**
The edited image must also maintain the appearance of these other characters based on their text descriptions if they appear in the scene:
${otherCharacters.map(c => `- **${c.name}**: ${c.description}`).join('\n')}
---
` : '';

        finalPromptText += `\n${racialMandate}\n${otherCharacterBlock}`;
        contentsParts.push({ text: finalPromptText });

        const modelToUse = 'gemini-2.5-flash-image';

        const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
            model: modelToUse,
            contents: { parts: contentsParts },
            config: {
                imageConfig: { aspectRatio: aspectRatio },
            },
        }), undefined, signal);

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return { src: part.inlineData.data, error: null };
            }
        }
        
        return { src: null, error: 'The model did not return an edited image. The edit may have been rejected by a safety filter.' };

    } catch (error) {
        const parsedError = parseErrorMessage(error);
        if (signal?.aborted) throw error;
        console.error(`Image could not be edited:`, parsedError);
        return { src: null, error: parsedError };
    }
}


async function generateSpeech(
    script: string,
    characters: Character[],
    imageStyle: string,
    signal?: AbortSignal
): Promise<string | null> {
    const ai = getAiClient();
    if (!script) return null;

    const knownCharacters = characters.filter(c => c.name).map(c => c.name);
    const allPossibleSpeakers = ['Narrator', ...knownCharacters];
    
    const speakerMatches = Array.from(script.matchAll(/^([\w\s]+):/gm));
    const detectedSpeakers = new Set<string>();

    speakerMatches.forEach(match => {
        const speakerName = match[1].trim();
        const foundSpeaker = allPossibleSpeakers.find(s => s.toLowerCase() === speakerName.toLowerCase());
        if (foundSpeaker) {
            detectedSpeakers.add(foundSpeaker);
        }
    });

    try {
        let ttsResponse: GenerateContentResponse;
        if (detectedSpeakers.size > 1) {
            const availableVoices = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir'];
            const speakerVoiceConfigs = Array.from(detectedSpeakers).map((name, index) => ({
                speaker: name,
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: availableVoices[index % availableVoices.length] as any }
                }
            }));

            const ttsPrompt = `TTS the following conversation:\n${script}`;
            
            ttsResponse = await withRetry(() => ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: ttsPrompt }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        multiSpeakerVoiceConfig: {
                            speakerVoiceConfigs: speakerVoiceConfigs,
                        },
                    },
                },
            }), undefined, signal);

        } else {
            // Single speaker or narrator
            const expression = isCartoonStyle(imageStyle) ? 'cheerful' : 'storytelling';
            const ttsPrompt = `(${expression}): ${script}`;

            ttsResponse = await withRetry(() => ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: ttsPrompt }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' }, // Default voice for single speaker
                        },
                    },
                },
            }), undefined, signal);
        }

        const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.[0];
        if (audioPart && audioPart.inlineData) {
            return audioPart.inlineData.data;
        }

        return null;

    } catch (error) {
        console.error("Error generating speech:", error);
        throw error;
    }
}

export async function generateVideoFromScene(
    scene: StoryboardScene,
    aspectRatio: string,
    script: string,
    characters: Character[],
    audioOptions: AudioOptions | null,
    imageStyle: string,
    videoModel: string,
    resolution: '720p' | '1080p',
    cameraMovement: string,
    onProgress: (message: string) => void,
    previousVideoObject: any | null = null,
    signal?: AbortSignal
): Promise<{ videoUrl: string | null; audioUrl: string | null; videoObject: any; audioBase64: string | null }> {
    if (!scene.src && !previousVideoObject) {
        throw new Error("Cannot generate video without a source image or a previous clip to extend.");
    }

    const ai = getAiClient();
    let audioBase64: string | null = null;
    if (audioOptions) {
        onProgress("Generating voiceover...");
        if (audioOptions.mode === 'tts') {
            audioBase64 = await generateSpeech(audioOptions.data, characters, imageStyle, signal);
        } else {
            audioBase64 = audioOptions.data;
        }
    }

    const movementPrompt = CAMERA_MOVEMENT_PROMPTS[cameraMovement] || 'The camera remains static.';
    const finalPrompt = script ? `${script}. ${movementPrompt}` : movementPrompt;

    onProgress("Sending video request to model...");

    const videoGenerationPayload: any = {
        model: videoModel,
        prompt: finalPrompt,
        config: {
            numberOfVideos: 1,
            resolution: resolution,
            aspectRatio: aspectRatio as '16:9' | '9:16',
        }
    };

    if (previousVideoObject) {
        videoGenerationPayload.video = previousVideoObject;
    } else if (scene.src) {
        videoGenerationPayload.image = {
            imageBytes: scene.src,
            mimeType: 'image/png'
        };
    }
    
    // FIX: Add GenerateVideosOperation type to the operation variable to fix property access errors.
    let operation: GenerateVideosOperation = await withRetry(() => ai.models.generateVideos(videoGenerationPayload), onProgress, signal);
    onProgress("Video generation in progress... (this may take several minutes)");

    while (!operation.done) {
        if (signal?.aborted) {
            throw new Error("Aborted");
        }
        await delay(10000); // Poll every 10 seconds
        try {
            operation = await ai.operations.getVideosOperation({ operation: operation });
            const progress = operation.metadata?.progressPercentage || 0;
            onProgress(`Processing video... ${progress.toFixed(0)}%`);
        } catch (e) {
            console.warn("Polling for video status failed, retrying...", e);
        }
    }

    onProgress("Finalizing video...");
    const API_KEY = process.env.API_KEY;

    if (operation.error) {
        throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
        throw new Error("Video generation succeeded but no video was returned. This may be due to a safety policy violation.");
    }
    
    const videoResponse = await fetch(`${downloadLink}&key=${API_KEY}`);
    if (!videoResponse.ok) {
        throw new Error("Failed to download the generated video.");
    }
    const videoBlob = await videoResponse.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    let audioUrl: string | null = null;
    if (audioBase64) {
        const audioBytes = base64ToBytes(audioBase64);
        const audioBlob = pcmToWavBlob(audioBytes);
        audioUrl = URL.createObjectURL(audioBlob);
    }
    
    return {
        videoUrl,
        audioUrl,
        videoObject: operation.response?.generatedVideos?.[0]?.video,
        audioBase64
    };
}

export async function generateStorybookSpeech(
    script: string,
    voice: string,
    expression: string,
    accent?: string,
    signal?: AbortSignal
): Promise<string | null> {
    const ai = getAiClient();
    if (!script) return null;

    const ttsPrompt = `(${expression}): ${script}`;
    const systemInstruction = accent ? `You are a voice actor. Speak in a ${accent} accent.` : 'You are a voice actor.';

    try {
        const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: ttsPrompt }] }],
            config: {
                systemInstruction,
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voice as any },
                    },
                },
            },
        }), undefined, signal);

        const audioPart = response.candidates?.[0]?.content?.parts?.[0];
        if (audioPart && audioPart.inlineData) {
            return audioPart.inlineData.data;
        }
        return null;
    } catch (error) {
        console.error("Error generating speech:", error);
        throw error;
    }
}

export async function generateStructuredStory(
    userPrompt: string,
    title: string,
    characters: string[],
    wantsDialogue: boolean,
    signal?: AbortSignal
): Promise<StorybookParts> {
    const ai = getAiClient();

    const dialogueInstruction = wantsDialogue
        ? "The story and scene narrations MUST include rich dialogue between characters."
        : "The story should be told from a third-person narrative perspective. Do not include direct dialogue quotes.";

    const characterInstruction = characters.length > 0
        ? `Incorporate the following characters into the story: ${characters.join(', ')}.`
        : '';
    
    const movementInstruction = `**CRITICAL RULE FOR NARRATION:** The 'narration' field should contain the portion of the story corresponding to the scene. It should be written as pure narrative, not a script. Do NOT include camera directions (e.g., 'pan left', 'zoom in'). The 'imageDescription' field should be a purely visual, static description of that moment.`;


    const prompt = `You are a creative writer tasked with generating a short story and breaking it down into a storyboard format.

**User's Story Idea:** "${userPrompt}"
**Title (if any):** "${title}"

**Instructions:**
1.  Write a complete, coherent story narrative based on the user's idea. The narrative should be engaging and well-structured, written as a pure story without any camera directions or cinematic terms.
2.  After writing the full narrative, break it down into a sequence of logical scenes. Think like a film director: each scene should represent a distinct moment or a continuous action in a single location. The scene breaks must create a clear and understandable flow for the visual story. A good scene can often be captured in a single, powerful image.
3.  For each scene, provide two components:
    *   **imageDescription:** A concise, purely visual description of the scene for an image generator. Describe the setting, characters, and their actions as a static snapshot.
    *   **narration:** The portion of the story narrative that corresponds to this visual scene.
4.  ${characterInstruction}
5.  ${dialogueInstruction}
6.  ${movementInstruction}
7.  **Cultural Context:** For consistency, please ensure all human characters in the story and scene descriptions are of Black African descent.

**Output Format:**
Return a valid JSON object with two keys:
1.  "storyNarrative": A string containing the full story.
2.  "scenes": An array of objects, where each object has "imageDescription" and "narration" string properties.
`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{ text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    storyNarrative: { type: Type.STRING },
                    scenes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                imageDescription: { type: Type.STRING },
                                narration: { type: Type.STRING }
                            },
                            required: ['imageDescription', 'narration']
                        }
                    }
                },
                required: ['storyNarrative', 'scenes']
            }
        }
    }), undefined, signal);

    try {
        const jsonStr = response.text.trim();
        const parsed = JSON.parse(jsonStr);
        if (!parsed.storyNarrative || !parsed.scenes || !Array.isArray(parsed.scenes)) {
            throw new Error("AI failed to return a valid structured story.");
        }
        // Add a random ID to each scene, as App.tsx expects it for keys
        parsed.scenes = parsed.scenes.map((scene: any) => ({ ...scene, id: Date.now() + Math.random() }));
        return parsed;
    } catch (e) {
        console.error("Failed to parse structured story JSON:", response.text, e);
        throw new Error("The AI returned an invalid format for the story.");
    }
}

export async function generateScenesFromNarrative(
    storyNarrative: string,
    characters: string[],
    wantsDialogue: boolean,
    signal?: AbortSignal
): Promise<Array<{ id: number; imageDescription: string; narration: string }>> {
    const ai = getAiClient();

    const dialogueInstruction = wantsDialogue
        ? "The narration for each scene MUST include dialogue if it is present in the original narrative."
        : "The narration for each scene should be purely descriptive, summarizing the action. Do NOT include direct dialogue quotes.";

    const characterInstruction = characters.length > 0
        ? `The story features these characters: ${characters.join(', ')}. Ensure they are central to the scenes.`
        : '';

    const movementInstruction = `**CRITICAL RULE FOR NARRATION vs. VISUALS:** The 'narration' field should be the exact text from the story that corresponds to the scene. The 'imageDescription' should be a purely visual, static description of that moment. Do not add camera directions (e.g., 'pan left', 'zoom in') to either field. Just describe what is happening.`;


    const prompt = `You are a storyboard artist's assistant. Your task is to analyze a story narrative and break it down into a sequence of distinct, visually representable scenes.

**Story Narrative:**
"${storyNarrative}"

**Instructions:**
1.  Read the entire narrative to understand the plot, characters, and pacing.
2.  Divide the narrative into logical scenes. Think like a film director: each scene should represent a single, static moment or a continuous action in one location. Ensure the scene breaks create a clear and understandable flow for the visual story. A good scene can be captured in a single, powerful image.
3.  For each scene, generate two components:
    *   **imageDescription:** A concise, purely visual description of the scene. This will be used to generate an image. It should describe the setting, characters' appearances, their positions, and key objects. It must be a static snapshot.
    *   **narration:** The corresponding text from the story for that scene. This will be used as a script for voice-over.
4.  ${dialogueInstruction}
5.  ${characterInstruction}
6.  ${movementInstruction}

**Output Format:**
Return a valid JSON object with a single key "scenes", which is an array of objects. Each object in the array must have two string keys: "imageDescription" and "narration".
`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{ text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    scenes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                imageDescription: { type: Type.STRING },
                                narration: { type: Type.STRING }
                            },
                            required: ['imageDescription', 'narration']
                        }
                    }
                },
                required: ['scenes']
            }
        }
    }), undefined, signal);

    try {
        const jsonStr = response.text.trim();
        const parsed = JSON.parse(jsonStr);
        if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
            throw new Error("AI failed to return a valid array of scenes.");
        }
         // Add a random ID to each scene, as App.tsx expects it for keys
        parsed.scenes = parsed.scenes.map((scene: any) => ({ ...scene, id: Date.now() + Math.random() }));
        return parsed.scenes;
    } catch (e) {
        console.error("Failed to parse scenes from narrative JSON:", response.text, e);
        throw new Error("The AI returned an invalid format for scene breakdown.");
    }
}
