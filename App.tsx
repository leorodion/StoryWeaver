
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
// FIX: Added generateVideoFromScene and generateScenesFromNarrative to the import.
import { generateImageSet, generateVideoFromScene, StoryboardScene, generatePromptFromAudio, generateCharacterDescription, AudioOptions, generateSingleImage, Character, generateCameraAnglesFromImage, editImage, EditImageParams, CAMERA_MOVEMENT_PROMPTS, generateStructuredStory, Storybook, generateScenesFromNarrative, generateStorybookSpeech, PREBUILT_VOICES, VOICE_EXPRESSIONS, StorybookParts, ACCENT_OPTIONS, CAMERA_ANGLE_OPTIONS, generateCharacterVisual, describeImageForConsistency } from './services/geminiService';
import { fileToBase64, base64ToBytes, compressImageBase64, pcmToWavBlob } from './utils/fileUtils';
import { parseErrorMessage } from './utils/errorUtils';
import { SparklesIcon, LoaderIcon, DownloadIcon, VideoIcon, PlusCircleIcon, ChevronLeftIcon, ChevronRightIcon, UserPlusIcon, XCircleIcon, RefreshIcon, TrashIcon, XIcon, BookmarkIcon, HistoryIcon, UploadIcon, CameraIcon, UndoIcon, MusicalNoteIcon, BookOpenIcon, ClipboardIcon, CheckIcon, DocumentMagnifyingGlassIcon, SpeakerWaveIcon, ChevronDownIcon, LockClosedIcon, LockOpenIcon, ClapperboardIcon, SaveIcon, StopIcon, CreditCardIcon, ExclamationTriangleIcon, RedoIcon } from './components/Icons';

type AppStatus = {
  status: 'idle' | 'loading' | 'error';
  error: string | null;
};

type AppStoryboardScene = StoryboardScene & { 
    isGenerating?: boolean;
    isRegenerating?: boolean;
    isGeneratingAngles?: boolean;
    isEditing?: boolean;
    previousSrc?: string | null;
};

type GenerationItem = {
  id: number;
  prompt: string;
  imageSet: AppStoryboardScene[];
  videoStates: VideoState[];
  aspectRatio: string;
  imageStyle: string;
  genre: string;
  characters: Character[];
  imageModel: string;
};

type SavedItem = {
  id: string; // Unique ID, e.g., `${generationId}-${sceneIndex}`
  scene: StoryboardScene;
  videoState: VideoState;
  originalPrompt: string;
  aspectRatio: string;
  imageStyle: string;
  genre: string;
  characters: Character[];
  imageModel: string;
  expiresAt: number; // UTC timestamp
};

type UploadedItem = {
    id: string;
    generationItem: Omit<GenerationItem, 'id' | 'videoStates'> & { imageSet: AppStoryboardScene[] };
    videoStates: VideoState[];
    mimeType: string;
    detectedCharacters: string[];
    addedCharacterIds?: number[];
};

type AudioAssignment = {
  file: File;
  transcription: string;
  detectedCharacters: Character[];
  assignment: { type: 'character'; characterId: number } | { type: 'background' } | null;
};

type DailyCounts = {
    images: number;
    videos: number;
    lastReset: string; // e.g., "Mon Sep 23 2024"
};

type CreditSettings = {
    creditBalance: number; // Always in USD
    currency: 'USD' | 'SEK';
};

type VideoClip = {
  videoUrl: string | null;
  audioUrl: string | null;
  videoObject: any;
  audioBase64: string | null;
};

type VideoState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  clips: VideoClip[];
  currentClipIndex: number;
  error: string | null;
  loadingMessage: string;
  showScriptInput: boolean;
  scriptPrompt: string;
  voiceoverMode: 'tts' | 'upload';
  voiceoverFile: File | null;
  speaker: string; // Tracks the detected or selected speaker for UI highlighting
  cameraMovement: string;
  isCameraMovementOpen?: boolean;
};

type ConfirmationModalState = {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
};

type GenerationModalState = {
    isOpen: boolean;
    type: 'image' | 'video';
    target: { generationId: number; sceneIndex: number; extend: boolean };
    model: string;
    onConfirm: (model: string) => void;
};

// COST ESTIMATION CONSTANTS (based on public pricing, may become outdated)
const COST_MAP: { [key: string]: number } = {
    'gemini-2.5-flash-image': 0.0025,
    'gemini-3-pro-image-preview': 0.005,
    'imagen-4.0-generate-001': 0.02,
    'veo-3.1-fast-generate-preview': 0.12, // estimate per clip
    'veo-3.1-generate-preview': 0.25, // estimate per clip
};

const CURRENCY_INFO = {
    USD: { symbol: '$', rate: 1 },
    SEK: { symbol: 'kr', rate: 10.5 }
};

// Use AI Studio's synchronized storage if available, with a fallback to local storage.
// This enables saved items to be accessed across different devices.
const saveItems = async (items: SavedItem[]) => {
  const saveData = async (dataToSave: SavedItem[]) => {
    const data = JSON.stringify(dataToSave);
    const storage = (window as any).aistudio?.storage;
    if (storage && typeof storage.setItem === 'function') {
      await storage.setItem('creativeSuiteSavedItems', data);
    } else {
      try {
          localStorage.setItem('creativeSuiteSavedItems', data);
      } catch (e) {
          throw e;
      }
    }
  };

  let currentItems = [...items];
  // Attempt to save, and if a quota error occurs, remove the oldest item and retry.
  while (currentItems.length > 0) {
    try {
      await saveData(currentItems);
      return; // Success
    } catch (error: any) {
      if (error.name === 'QuotaExceededError' || (error.message && error.message.toLowerCase().includes('quota'))) {
        console.warn('Quota exceeded. Removing the oldest saved item and retrying.');
        currentItems.pop(); // Remove the oldest item (last in array because new items are prepended)
      } else {
        console.error('Failed to save items:', error);
        throw error; // Rethrow other errors
      }
    }
  }
};

const loadItems = async (): Promise<SavedItem[]> => {
  try {
    const storage = (window as any).aistudio?.storage;
    let data;
    if (storage && typeof storage.getItem === 'function') {
      data = await storage.getItem('creativeSuiteSavedItems');
    } else {
      data = localStorage.getItem('creativeSuiteSavedItems');
    }

    if (data) {
      const items: SavedItem[] = JSON.parse(data);
      const now = Date.now();
      // Filter out expired items
      const validItems = items.filter(item => item.expiresAt > now);
      if (validItems.length < items.length) {
        // If some items expired, re-save the valid ones.
        await saveItems(validItems);
      }
      return validItems;
    }
  } catch (error) {
    console.error('Failed to load saved items:', error);
  }
  return [];
};

const saveDailyCounts = async (counts: DailyCounts) => {
    try {
      const data = JSON.stringify(counts);
      const storage = (window as any).aistudio?.storage;
      if (storage && typeof storage.setItem === 'function') {
        await storage.setItem('creativeSuiteDailyCounts', data);
      } else {
        localStorage.setItem('creativeSuiteDailyCounts', data);
      }
    } catch (error) {
      console.error('Failed to save daily counts:', error);
    }
};
  
const loadDailyCounts = async (): Promise<DailyCounts | null> => {
    try {
        const storage = (window as any).aistudio?.storage;
        let data;
        if (storage && typeof storage.getItem === 'function') {
            data = await storage.getItem('creativeSuiteDailyCounts');
        } else {
            data = localStorage.getItem('creativeSuiteDailyCounts');
        }
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Failed to load daily counts:', error);
        return null;
    }
};

const saveCreditSettings = async (settings: CreditSettings) => {
    try {
        const data = JSON.stringify(settings);
        const storage = (window as any).aistudio?.storage;
        if (storage && typeof storage.setItem === 'function') {
            await storage.setItem('creativeSuiteCreditSettings', data);
        } else {
            localStorage.setItem('creativeSuiteCreditSettings', data);
        }
    } catch (error) {
      console.error('Failed to save credit settings:', error);
    }
};

const loadCreditSettings = async (): Promise<CreditSettings | null> => {
    try {
        const storage = (window as any).aistudio?.storage;
        let data;
        if (storage && typeof storage.getItem === 'function') {
            data = await storage.getItem('creativeSuiteCreditSettings');
        } else {
            data = localStorage.getItem('creativeSuiteCreditSettings');
        }
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Failed to load credit settings:', error);
        return null;
    }
};

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const App: React.FC = () => {
    // Refs for textareas to manage cursor position
    const promptTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const scriptTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const editPromptTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const storybookTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const storybookAiPromptTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const storybookScenesContainerRef = useRef<HTMLDivElement>(null);
    const storybookEndRef = useRef<HTMLDivElement>(null);
    const overlayImageInputRef = useRef<HTMLInputElement>(null);
    const creditAdderRef = useRef<HTMLDivElement>(null);

    const [prompt, setPrompt] = useState<string>('');
    const [imageCount, setImageCount] = useState<number>(1);
    const [aspectRatio, setAspectRatio] = useState<string>('16:9');
    const [imageStyle, setImageStyle] = useState<string>('Afro-toon');
    const [imageModel, setImageModel] = useState<string>('gemini-2.5-flash-image');
    const [videoModel, setVideoModel] = useState<string>('veo-3.1-fast-generate-preview');
    const [genre, setGenre] = useState<string>('General');
    const [appStatus, setAppStatus] = useState<AppStatus>({ status: 'idle', error: null });
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [generationHistory, setGenerationHistory] = useState<GenerationItem[]>([]);
    const [activeHistoryIndex, setActiveHistoryIndex] = useState<number>(-1);
    const [videoStates, setVideoStates] = useState<VideoState[]>([]);
    const [activeVideoIndex, setActiveVideoIndex] = useState<number>(-1);
    
    const [characters, setCharacters] = useState<Character[]>([]);
    const [nextCharId, setNextCharId] = useState(1);
    const characterFileInputRef = useRef<HTMLInputElement>(null);
    const uploadCharacterFileInputRef = useRef<HTMLInputElement>(null);
    const [uploadingCharId, setUploadingCharId] = useState<number | null>(null);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    
    // Updated editingScene state type to include editHistory
    const [editingScene, setEditingScene] = useState<(AppStoryboardScene & { 
        generationId: number; 
        sceneIndex: number; 
        editPrompt: string;
        overlayImage: { base64: string; mimeType: string; } | null;
        editHistory: string[];
        editHistoryIndex: number;
    }) | null>(null);

    const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
    const [historyFilter, setHistoryFilter] = useState<'all' | 'saved'>('all');
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [showStorybookPanel, setShowStorybookPanel] = useState(false);
    const [storybookContent, setStorybookContent] = useState<Storybook>({
        title: '',
        characters: [],
        storyNarrative: '',
        scenes: [],
        narrativeAudioSrc: null,
        isGeneratingNarrativeAudio: false,
        selectedNarrativeVoice: 'Kore',
        selectedNarrativeExpression: 'Storytelling',
        selectedNarrativeAccent: 'Nigerian English',
    });
    const [storybookAiPrompt, setStorybookAiPrompt] = useState('');
    const [wantsDialogue, setWantsDialogue] = useState(false);
    const [wantsDialogueForAnalysis, setWantsDialogueForAnalysis] = useState(false);
    const [isStorybookLoading, setIsStorybookLoading] = useState(false);
    const [isStorybookAnalyzing, setIsStorybookAnalyzing] = useState(false);
    const [storybookError, setStorybookError] = useState<{ message: string; type: 'error' | 'warning' } | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [isAiStoryHelpMode, setIsAiStoryHelpMode] = useState(false);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'success'>('idle');
    
    const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>([]);
    const uploadFileInputRef = useRef<HTMLInputElement>(null);

    const [audioAssignments, setAudioAssignments] = useState<AudioAssignment[]>([]);
    const audioFileInputRef = useRef<HTMLInputElement>(null);
    const [isProcessingAudio, setIsProcessingAudio] = useState(false);
    const [dailyCounts, setDailyCounts] = useState<DailyCounts>({ images: 0, videos: 0, lastReset: new Date().toDateString() });

    const [creditSettings, setCreditSettings] = useState<CreditSettings>({ creditBalance: 0, currency: 'USD' });
    const [creditToAdd, setCreditToAdd] = useState<number>(50);
    const [isCreditAdderOpen, setIsCreditAdderOpen] = useState(false);

    const prevCharactersRef = useRef<Character[]>(characters);
    
    const [isAngleModalOpen, setIsAngleModalOpen] = useState(false);
    const [angleSelectionTarget, setAngleSelectionTarget] = useState<{ generationId: number; sceneIndex: number } | null>(null);
    const [selectedAngle, setSelectedAngle] = useState<string | null>(null);
    const [focusSubject, setFocusSubject] = useState<string>('General Scene');
    const [charactersForAngleModal, setCharactersForAngleModal] = useState<Character[]>([]);
    const initialUploadFileInputRef = useRef<HTMLInputElement>(null);

    // Canvas drawing states for editing
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawingMode, setDrawingMode] = useState<'none' | 'add' | 'remove'>('none');
    const [hasDrawn, setHasDrawn] = useState(false);
    const isDrawingRef = useRef(false);
    const lastPosRef = useRef<{ x: number; y: number } | null>(null);
    const currentPathRef = useRef<Array<{ x: number; y: number }>>([]);

    const [confirmationModal, setConfirmationModal] = useState<ConfirmationModalState>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {},
        onCancel: () => {},
    });

    const [generationModalState, setGenerationModalState] = useState<GenerationModalState>({
        isOpen: false,
        type: 'image',
        target: { generationId: 0, sceneIndex: 0, extend: false },
        model: '',
        onConfirm: () => {},
    });

    const isGenerationDisabled = creditSettings.creditBalance <= 0;
    
    const handleApiKeyError = (error: unknown) => {
        const parsedError = parseErrorMessage(error);
        if (parsedError.includes("API Key error") || parsedError.includes("entity was not found") || parsedError.includes("Invalid API Key")) {
            setAppStatus({ status: 'error', error: parsedError });
            return true;
        }
        return false;
    };


    useEffect(() => {
        const fetchSavedItems = async () => {
          const loaded = await loadItems();
          setSavedItems(loaded);
        };
        fetchSavedItems();

        const initializeCounts = async () => {
            const loadedCounts = await loadDailyCounts();
            const today = new Date().toDateString();

            if (loadedCounts && loadedCounts.lastReset === today) {
                setDailyCounts(loadedCounts);
            } else {
                const newCounts = { images: 0, videos: 0, lastReset: today };
                setDailyCounts(newCounts);
                await saveDailyCounts(newCounts);
            }
        };
        initializeCounts();

        const initializeCredit = async () => {
            const loadedCredit = await loadCreditSettings();
            if (loadedCredit) {
                setCreditSettings(loadedCredit);
            } else {
                const defaultSettings: CreditSettings = { creditBalance: 0, currency: 'USD' };
                setCreditSettings(defaultSettings);
                await saveCreditSettings(defaultSettings);
            }
        };
        initializeCredit();


        // Load characters from local storage
        try {
            const savedCharacters = localStorage.getItem('storyWeaverCharacters');
            if (savedCharacters) {
                const loadedCharacters = JSON.parse(savedCharacters);
                if (Array.isArray(loadedCharacters) && loadedCharacters.every(c => typeof c.id === 'number')) {
                    // Rehydrate imagePreview since we optimize it out during save to prevent duplication
                    const hydratedCharacters = loadedCharacters.map((c: any) => ({
                        ...c,
                        imagePreview: c.imagePreview || (c.originalImageBase64 ? `data:${c.originalImageMimeType || 'image/png'};base64,${c.originalImageBase64}` : null)
                    }));
                    setCharacters(hydratedCharacters);
                    if (hydratedCharacters.length > 0) {
                        const validIds = hydratedCharacters.map((c: any) => c.id);
                        if (validIds.length > 0) {
                            const maxId = Math.max(...validIds);
                            setNextCharId(maxId + 1);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Failed to load characters from local storage:", error);
            localStorage.removeItem('storyWeaverCharacters');
        }

        // Load generation history from local storage
        const savedHistory = localStorage.getItem('storyWeaverHistory');
        if (savedHistory) {
            try {
                const parsedHistory = JSON.parse(savedHistory);
                if (Array.isArray(parsedHistory)) {
                    setGenerationHistory(parsedHistory);
                    if (parsedHistory.length > 0) {
                        setActiveHistoryIndex(parsedHistory.length - 1);
                    }
                }
            } catch (e) {
                console.warn("Could not parse generation history from localStorage.");
                localStorage.removeItem('storyWeaverHistory');
            }
        }

        // Load storybook content from local storage
        const savedStorybook = localStorage.getItem('storybookContent');
        if (savedStorybook) {
            try {
                let parsed = JSON.parse(savedStorybook);
                if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.scenes)) {
                    // Backwards compatibility for old string-based characters
                    if (typeof parsed.characters === 'string') {
                        parsed.characters = parsed.characters.split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                    // Add new TTS properties if they don't exist
                    const defaults = {
                        narrativeAudioSrc: null,
                        isGeneratingNarrativeAudio: false,
                        selectedNarrativeVoice: 'Kore',
                        selectedNarrativeExpression: 'Storytelling',
                        selectedNarrativeAccent: 'Nigerian English',
                    };
                    // Ensure scenes have default audio properties as well to prevent crashes
                    parsed.scenes = parsed.scenes.map((s: any) => ({
                        ...s,
                        id: s.id || Date.now() + Math.random(),
                        audioSrc: null, // Clear src on load, they are session-based
                        isGeneratingAudio: false,
                        selectedVoice: s.selectedVoice || 'Kore',
                        selectedExpression: s.selectedExpression || 'Storytelling',
                        isDescriptionLocked: s.isDescriptionLocked !== undefined ? s.isDescriptionLocked : true,
                        isNarrationLocked: s.isNarrationLocked !== undefined ? s.isNarrationLocked : true,
                    }));
                    setStorybookContent({ ...defaults, ...parsed });
                }
            } catch (e) {
                console.warn("Could not parse storybook from localStorage.");
                localStorage.removeItem('storybookContent');
            }
        }
    }, []);

    // Click outside handler for credit pop-up
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (creditAdderRef.current && !creditAdderRef.current.contains(event.target as Node)) {
                setIsCreditAdderOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);


    // Save characters to local storage whenever they change
    useEffect(() => {
        try {
            if (characters.length > 0) {
                // Optimization: Exclude imagePreview from storage as it duplicates originalImageBase64
                // This significantly reduces localStorage usage and helps prevent QuotaExceededError
                const charactersToSave = characters.map(char => {
                    const { imagePreview, ...rest } = char;
                    return rest;
                });
                localStorage.setItem('storyWeaverCharacters', JSON.stringify(charactersToSave));
            } else {
                if(localStorage.getItem('storyWeaverCharacters')) {
                    localStorage.removeItem('storyWeaverCharacters');
                }
            }
        } catch (error: any) {
            console.error("Failed to save characters to local storage:", error);
            if (error.name === 'QuotaExceededError' || 
                (error.message && error.message.toLowerCase().includes('quota'))) {
                setAppStatus({ status: 'error', error: "Local storage is full. Unable to save your characters." });
            }
        }
    }, [characters]);

    // Save generation history to local storage with robust Quota handling
    useEffect(() => {
        const saveHistory = () => {
            try {
                if (generationHistory.length > 0) {
                    localStorage.setItem('storyWeaverHistory', JSON.stringify(generationHistory));
                } else {
                    localStorage.removeItem('storyWeaverHistory');
                }
            } catch (error: any) {
                // Handle quota exceeded specifically
                if (error.name === 'QuotaExceededError' || 
                    (error.message && error.message.toLowerCase().includes('quota'))) {
                    
                    console.warn("Quota exceeded while saving history. Truncating history.");
                    
                    // Try to save a smaller portion of the history
                    let reducedHistory = [...generationHistory];
                    
                    // Aggressively trim to just the last 5 items if full
                    if (reducedHistory.length > 5) {
                         reducedHistory = reducedHistory.slice(-5);
                    } else {
                         // If still failing with 5, trim one by one
                         reducedHistory.shift();
                    }

                    while (reducedHistory.length > 0) {
                         try {
                             localStorage.setItem('storyWeaverHistory', JSON.stringify(reducedHistory));
                             console.log("Saved truncated history.");
                             return; // Success
                         } catch (e) {
                             reducedHistory.shift(); // Still too big, remove oldest
                         }
                    }
                    
                    // If even 1 item is too big, clear history from storage but keep state
                    console.warn("Single history item too large for storage. Clearing storage.");
                    localStorage.removeItem('storyWeaverHistory');
                } else {
                    console.error("Failed to save generation history:", error);
                }
            }
        };
        
        // Debounce save slightly to avoid rapid fire IO
        const timer = setTimeout(saveHistory, 1000);
        return () => clearTimeout(timer);
    }, [generationHistory]);
    
    // Update ref for character changes
    useEffect(() => {
        prevCharactersRef.current = JSON.parse(JSON.stringify(characters));
    }, [characters]);

    // Save storybook content to local storage whenever it changes
    useEffect(() => {
        const handler = setTimeout(() => {
            if (storybookContent.title || storybookContent.characters.length > 0 || storybookContent.storyNarrative || storybookContent.scenes.length > 0) {
                // We don't save the audio src as it's a temporary blob URL
                const { narrativeAudioSrc, ...contentToSave } = storybookContent;
                contentToSave.scenes = contentToSave.scenes.map(({ audioSrc, ...scene }) => scene);
                try {
                    localStorage.setItem('storybookContent', JSON.stringify(contentToSave));
                } catch (e) {
                    console.error("Failed to save storybook content (Quota?):", e);
                }
            } else {
                if (localStorage.getItem('storybookContent')) {
                    localStorage.removeItem('storybookContent');
                }
            }
        }, 500);

        return () => {
            clearTimeout(handler);
        };
    }, [storybookContent]);

    useEffect(() => {
        if (storybookContent.scenes.length > 0 && storybookEndRef.current) {
            storybookEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [storybookContent.scenes.length]);

    // Canvas Logic for Editing
    useEffect(() => {
        if (editingScene && editingScene.src && canvasRef.current) {
             const img = new Image();
             img.src = `data:image/png;base64,${editingScene.src}`;
             img.onload = () => {
                 if (canvasRef.current) {
                     // Set canvas internal resolution to match image natural size
                     canvasRef.current.width = img.naturalWidth;
                     canvasRef.current.height = img.naturalHeight;
                     // Clear any previous drawing when opening a new scene
                     const ctx = canvasRef.current.getContext('2d');
                     if (ctx) ctx.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
                     setHasDrawn(false);
                 }
             }
        }
    }, [editingScene]);

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }
        
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (drawingMode === 'none' || !canvasRef.current) return;
        isDrawingRef.current = true;
        const coords = getCoordinates(e, canvasRef.current);
        lastPosRef.current = coords;
        currentPathRef.current = [coords]; // Start a new path
        
        // Prevent scrolling on touch
        if ('touches' in e) e.preventDefault();
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingRef.current || !canvasRef.current || !lastPosRef.current) return;
        if ('touches' in e) e.preventDefault();
        
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        
        const coords = getCoordinates(e, canvasRef.current);
        currentPathRef.current.push(coords); // Add point to path
        
        ctx.beginPath();
        ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
        ctx.lineTo(coords.x, coords.y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 20; // Use fixed brush size
        
        if (drawingMode === 'add') {
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)'; // Green for Add
            ctx.globalCompositeOperation = 'source-over';
        } else if (drawingMode === 'remove') {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'; // Red for Remove
            ctx.globalCompositeOperation = 'source-over';
        } 
        
        ctx.stroke();
        lastPosRef.current = coords;
        setHasDrawn(true);
    };

    const stopDrawing = () => {
        if (!isDrawingRef.current || !canvasRef.current) return;
        isDrawingRef.current = false;
        lastPosRef.current = null;
    
        // Lasso fill logic
        const path = currentPathRef.current;
        if (path.length > 10) { // Require a minimum path length for a loop
            const startPoint = path[0];
            const endPoint = path[path.length - 1];
            const dx = endPoint.x - startPoint.x;
            const dy = endPoint.y - startPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
    
            // If end is close to start, it's a closed loop
            if (distance < 40) { // Threshold in pixels
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                    if (drawingMode === 'add') {
                        ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
                    } else if (drawingMode === 'remove') {
                        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    }
    
                    ctx.beginPath();
                    ctx.moveTo(startPoint.x, startPoint.y);
                    for (let i = 1; i < path.length; i++) {
                        ctx.lineTo(path[i].x, path[i].y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    setHasDrawn(true);
                }
            }
        }
        currentPathRef.current = []; // Clear path for next drawing action
    };
    
    const clearCanvas = () => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            setHasDrawn(false);
        }
    };

    const startOperation = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;
        return controller.signal;
    };

    const handleStopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            
            // Reset UI loading states, ensure global error is NULL to suppress banner
            setAppStatus({ status: 'idle', error: null });
            setStatusMessage('');
            setIsStorybookLoading(false);
            setIsStorybookAnalyzing(false);
            setIsProcessingAudio(false);
            
            // If editing, cancel specific loading state
            if (editingScene?.isRegenerating) {
                setEditingScene(prev => prev ? { ...prev, isRegenerating: false, error: 'Stopped.' } : null);
            }
            
            // Reset video states that are loading to error/stopped
            setGenerationHistory(prev => prev.map(item => ({
                ...item,
                videoStates: item.videoStates.map(vs => vs.status === 'loading' ? { ...vs, status: 'error', error: 'Stopped.' } : vs),
                imageSet: item.imageSet.map(img => (img.isGenerating || img.isRegenerating || img.isGeneratingAngles) ? { ...img, isGenerating: false, isRegenerating: false, isGeneratingAngles: false, error: 'Stopped.' } : img)
            })));
        }
    };

    const currentGenerationItem = useMemo(() => {
        if (activeHistoryIndex >= 0 && activeHistoryIndex < generationHistory.length) {
            return generationHistory[activeHistoryIndex];
        }
        return null;
    }, [activeHistoryIndex, generationHistory]);

    const incrementCount = useCallback(async (type: 'images' | 'videos', amount: number, modelKey: string) => {
        // Daily usage counts
        setDailyCounts(currentCounts => {
            const today = new Date().toDateString();
            let updatedCounts: DailyCounts;

            if (currentCounts.lastReset !== today) {
                updatedCounts = {
                    images: type === 'images' ? amount : 0,
                    videos: type === 'videos' ? amount : 0,
                    lastReset: today,
                };
            } else {
                updatedCounts = {
                    ...currentCounts,
                    [type]: currentCounts[type] + amount,
                };
            }
            saveDailyCounts(updatedCounts);
            return updatedCounts;
        });

        // Deduct from credit balance
        setCreditSettings(current => {
            const costPerUnit = COST_MAP[modelKey] || 0;
            const costToDeduct = amount * costPerUnit; // Cost is always in USD
            const newBalance = current.creditBalance - costToDeduct;

            const updatedSettings: CreditSettings = {
                ...current,
                creditBalance: newBalance,
            };
            saveCreditSettings(updatedSettings);
            return updatedSettings;
        });
    }, []);
    
    const handleAddCredit = () => {
        setCreditSettings(current => {
            const creditInUSD = creditToAdd / CURRENCY_INFO[current.currency].rate;
            const newBalance = current.creditBalance + creditInUSD;
            const updatedSettings = { ...current, creditBalance: newBalance };
            saveCreditSettings(updatedSettings);
            return updatedSettings;
        });
        setCreditToAdd(50); // Reset input field to default
        setIsCreditAdderOpen(false); // Close pop-up after adding
    };

    const handleResetCredit = () => {
        setConfirmationModal({
            isOpen: true,
            title: 'Reset Credit Balance',
            message: 'Are you sure you want to reset your tracked credit balance to zero? This action cannot be undone.',
            onConfirm: () => {
                setCreditSettings(current => {
                    const updatedSettings = { ...current, creditBalance: 0 };
                    saveCreditSettings(updatedSettings);
                    return updatedSettings;
                });
                setConfirmationModal({ ...confirmationModal, isOpen: false });
                setIsCreditAdderOpen(false); // Also close the adder pop-up
            },
            onCancel: () => {
                setConfirmationModal({ ...confirmationModal, isOpen: false });
            },
        });
    };

    const handleAskAiForStory = async () => {
        if (!storybookAiPrompt.trim() || isStorybookLoading) return;
        setIsStorybookLoading(true);
        setAppStatus({ status: 'idle', error: null });
        const signal = startOperation();
        try {
            const newStoryParts = await generateStructuredStory(
                storybookAiPrompt,
                storybookContent.title,
                storybookContent.characters,
                wantsDialogue,
                signal
            );
            const scenesWithDefaults = newStoryParts.scenes.map(scene => ({
                ...scene,
                id: scene.id || Date.now() + Math.random(),
                isDescriptionLocked: true,
                isNarrationLocked: true,
                audioSrc: null,
                isGeneratingAudio: false,
                selectedVoice: 'Kore',
                selectedExpression: 'Storytelling',
            }));
            setStorybookContent(prev => ({
                ...prev,
                storyNarrative: newStoryParts.storyNarrative,
                scenes: scenesWithDefaults
            }));
            setIsAiStoryHelpMode(false);
        } catch (error) {
            if (handleApiKeyError(error)) {
                setIsStorybookLoading(false);
                return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                return;
            };
            setAppStatus({ status: 'error', error: `Failed to get story idea: ${parsedError}` });
        } finally {
            setIsStorybookLoading(false);
            abortControllerRef.current = null;
        }
    };
    
    const handleSyncCharacters = () => {
        const characterNames = characters.map(c => c.name).filter(Boolean);
        setStorybookContent(prev => ({ ...prev, characters: characterNames }));
    
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 1500);
    };

    const handleImportNarrativeToVideo = (generationId: number, sceneIndex: number) => {
        const storyScene = storybookContent.scenes[sceneIndex];
        if (storyScene && storyScene.narration) {
            handleScriptChange(generationId, sceneIndex, storyScene.narration);
        } else {
             setStatusMessage("No matching storybook scene found for this index.");
             setTimeout(() => setStatusMessage(""), 2000);
        }
    };

    const handleAnalyzeStory = async () => {
        if (!storybookContent.storyNarrative.trim() || isStorybookLoading || isStorybookAnalyzing) return;
        setIsStorybookAnalyzing(true);
        setAppStatus({ status: 'idle', error: null });
        const signal = startOperation();
        try {
            const newScenes = await generateScenesFromNarrative(
                storybookContent.storyNarrative,
                storybookContent.characters,
                wantsDialogueForAnalysis,
                signal
            );
            const scenesWithDefaults = newScenes.map(scene => ({
                ...scene,
                id: scene.id || Date.now() + Math.random(),
                isDescriptionLocked: true,
                isNarrationLocked: true,
                audioSrc: null,
                isGeneratingAudio: false,
                selectedVoice: 'Kore',
                selectedExpression: 'Storytelling',
            }));
            setStorybookContent(current => ({
                ...current,
                scenes: scenesWithDefaults
            }));
        } catch (error) {
            if (handleApiKeyError(error)) {
                setIsStorybookAnalyzing(false);
                return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                return;
            }
            setAppStatus({ status: 'error', error: `Failed to analyze story: ${parsedError}` });
        } finally {
            setIsStorybookAnalyzing(false);
            abortControllerRef.current = null;
        }
    };
    
    const handleClearStorybook = () => {
        setConfirmationModal({
            isOpen: true,
            title: 'Clear Storybook',
            message: 'Are you sure you want to clear the entire storybook? This action cannot be undone.',
            onConfirm: () => {
                if (storybookContent.narrativeAudioSrc && storybookContent.narrativeAudioSrc.startsWith('blob:')) {
                    URL.revokeObjectURL(storybookContent.narrativeAudioSrc);
                }
                storybookContent.scenes.forEach(scene => {
                    if (scene.audioSrc && scene.audioSrc.startsWith('blob:')) {
                        URL.revokeObjectURL(scene.audioSrc);
                    }
                });

                const freshState: Storybook = {
                    title: '',
                    characters: [],
                    storyNarrative: '',
                    scenes: [],
                    narrativeAudioSrc: null,
                    isGeneratingNarrativeAudio: false,
                    selectedNarrativeVoice: 'Kore',
                    selectedNarrativeExpression: 'Storytelling',
                    selectedNarrativeAccent: 'Nigerian English',
                };
                setStorybookContent(freshState);
                setStorybookAiPrompt('');
                setIsAiStoryHelpMode(false);
                setConfirmationModal({ ...confirmationModal, isOpen: false });
            },
            onCancel: () => {
                setConfirmationModal({ ...confirmationModal, isOpen: false });
            },
        });
    };

    const handleCreateStoryboardFromScript = useCallback(() => {
        setStorybookError(null);
        if (storybookContent.scenes.length === 0) {
            setStorybookError({ message: 'Your storybook has no scenes to generate.', type: 'warning' });
            return;
        }
    
        const performCreation = async () => {
            setAppStatus({ status: 'loading', error: null });
            setStatusMessage('Preparing storyboard...');
            setShowStorybookPanel(false);
    
            const scriptCharacters = storybookContent.characters || [];
            const allSceneText = storybookContent.scenes.map(s => s.imageDescription).join(' ').toLowerCase();
            const relevantCharacters = characters.filter(c => 
                (c.name && scriptCharacters.some(sc => sc.toLowerCase() === c.name.toLowerCase())) ||
                (c.name && allSceneText.includes(c.name.toLowerCase()))
            );
    
            setImageCount(storybookContent.scenes.length);
    
            const initialVideoStates: VideoState[] = storybookContent.scenes.map(scene => {
                let detectedSpeaker = 'Narrator';
                const narration = scene.narration || '';
                const match = narration.match(/^([^\n:]+):/);
                if (match) {
                    const extractedName = match[1].trim();
                    const matchedChar = characters.find(c => c.name.toLowerCase() === extractedName.toLowerCase());
                    detectedSpeaker = matchedChar ? matchedChar.name : extractedName;
                }
    
                return {
                    status: 'idle', clips: [], currentClipIndex: -1, error: null, loadingMessage: '',
                    showScriptInput: false, scriptPrompt: narration, voiceoverMode: 'tts',
                    voiceoverFile: null, speaker: detectedSpeaker, cameraMovement: 'Static Hold',
                };
            });
    
            const newHistoryItem: GenerationItem = {
                id: Date.now(),
                prompt: storybookContent.title || 'From Storybook',
                imageSet: storybookContent.scenes.map(scene => ({
                    src: null, prompt: scene.imageDescription, error: null, isRegenerating: false, isGenerating: true,
                })),
                videoStates: initialVideoStates, aspectRatio, imageStyle, genre,
                characters: relevantCharacters, imageModel
            };
    
            setGenerationHistory(prev => [...prev, newHistoryItem]);
            setTimeout(() => { setActiveHistoryIndex(prev => prev + 1); setActiveVideoIndex(-1); }, 50);
            await new Promise(resolve => setTimeout(resolve, 200));
        
            const signal = startOperation();
    
            try {
                const generatedScenes: AppStoryboardScene[] = [];
                for (let i = 0; i < storybookContent.scenes.length; i++) {
                    if (signal.aborted) throw new Error('Aborted');
                    const scene = storybookContent.scenes[i];
                    
                    setStatusMessage(`Generating... ${storybookContent.scenes.length - i} remaining`);
        
                    const { src, error } = await generateSingleImage(
                        scene.imageDescription, aspectRatio, imageStyle, genre,
                        relevantCharacters, relevantCharacters, imageModel, null, null, signal
                    );
                    
                    generatedScenes.push({ prompt: scene.imageDescription, src, error, isGenerating: false });
        
                    setGenerationHistory(prev => prev.map(item => {
                        if (item.id === newHistoryItem.id) {
                            const updatedImageSet = [...item.imageSet];
                            updatedImageSet[i] = { ...updatedImageSet[i], src, error, isGenerating: false };
                            return { ...item, imageSet: updatedImageSet };
                        }
                        return item;
                    }));
        
                     if (i < storybookContent.scenes.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
                
                const successfulCount = generatedScenes.filter(s => s.src).length;
                if (successfulCount > 0) {
                    incrementCount('images', successfulCount, imageModel);
                }
                
                setAppStatus({ status: 'idle', error: null });
                setStatusMessage('');
        
            } catch (error) {
                if (handleApiKeyError(error)) {
                    setAppStatus({ status: 'idle', error: null });
                    setStatusMessage('');
                    return;
                }
                const parsedError = parseErrorMessage(error);
                if (parsedError === 'Aborted') {
                    setAppStatus({ status: 'error', error: "Generation stopped by user." });
                    setGenerationHistory(prev => prev.map(item => {
                        if (item.id === newHistoryItem.id) {
                            return { ...item, imageSet: item.imageSet.map(s => s.isGenerating ? {...s, isGenerating: false, error: 'Stopped.'} : s) }
                        }
                        return item;
                    }));
                    return;
                }
                setAppStatus({ status: 'error', error: `Failed to create storyboard: ${parsedError}` });
                setStatusMessage('');
                setGenerationHistory(prev => prev.map(item => {
                    if (item.id === newHistoryItem.id) {
                        return { ...item, imageSet: item.imageSet.map(s => s.isGenerating ? {...s, isGenerating: false, error: s.error || 'Failed'} : s) }
                    }
                    return item;
                }));
            } finally {
                abortControllerRef.current = null;
            }
        };
    
        setConfirmationModal({
            isOpen: true,
            title: 'Generate New Storyboard',
            message: 'This will replace your current storyboard with a new one generated from this script. Are you sure you want to continue?',
            onConfirm: () => {
                setConfirmationModal(prev => ({ ...prev, isOpen: false }));
                performCreation();
            },
            onCancel: () => {
                setConfirmationModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    }, [storybookContent, characters, aspectRatio, imageStyle, genre, imageModel, incrementCount]);
    
    const handleGenerateSceneFromStorybook = async (index: number, description: string) => {
        if (!description.trim()) {
            setAppStatus({ status: 'error', error: 'Cannot generate from an empty description.' });
            setTimeout(() => setAppStatus(prev => ({ ...prev, error: null })), 3000);
            return;
        }
    
        setShowStorybookPanel(false);
        setAppStatus({ status: 'loading', error: null });
        setStatusMessage('Generating scene from storybook...');
        setActiveVideoIndex(-1);
        const signal = startOperation();
    
        const relevantCharacters = characters.filter(c => c.name && description.toLowerCase().includes(c.name.toLowerCase()));
    
        // Always create a new, single-card storyboard.
        const newHistoryItem: GenerationItem = {
            id: Date.now(),
            prompt: `Scene ${index + 1}: ${description}`,
            imageSet: [{ src: null, prompt: description, error: null, isGenerating: true }],
            videoStates: [{
                status: 'idle',
                clips: [],
                currentClipIndex: -1,
                error: null,
                loadingMessage: '',
                showScriptInput: false,
                scriptPrompt: storybookContent.scenes[index]?.narration || '',
                voiceoverMode: 'tts',
                voiceoverFile: null,
                speaker: 'Narrator',
                cameraMovement: 'Static Hold',
            }],
            aspectRatio,
            imageStyle,
            genre,
            characters: relevantCharacters,
            imageModel
        };
    
        setGenerationHistory(prev => [...prev, newHistoryItem]);
        setTimeout(() => setActiveHistoryIndex(prev => prev + 1), 50);
    
        try {
            const { src, error } = await generateSingleImage(
                description, aspectRatio, imageStyle, genre,
                relevantCharacters, characters, imageModel,
                null, null, signal
            );
    
            setGenerationHistory(prev => prev.map(item => {
                if (item.id === newHistoryItem.id) {
                    return { ...item, imageSet: [{ src, prompt: description, error, isGenerating: false }] };
                }
                return item;
            }));
    
            if (src) {
                incrementCount('images', 1, imageModel);
                setZoomedImage(src);
            }
            setAppStatus({ status: 'idle', error: null });
            setStatusMessage('');
        } catch (error) {
            if (handleApiKeyError(error)) {
                setAppStatus({ status: 'idle', error: null });
                setStatusMessage('');
                return;
            }
            const parsedError = parseErrorMessage(error);
            setAppStatus({ status: 'error', error: parsedError });
            setGenerationHistory(prev => prev.map(item => {
                if (item.id === newHistoryItem.id) {
                    return { ...item, imageSet: [{ ...item.imageSet[0], error: parsedError, isGenerating: false }] };
                }
                return item;
            }));
        } finally {
            abortControllerRef.current = null;
        }
    };


    const handleStorybookChange = (field: keyof Omit<Storybook, 'scenes' | 'characters'>, value: string) => {
        setStorybookContent(prev => ({ ...prev, [field]: value }));
    };

    const handleSceneChange = (id: number, field: 'imageDescription' | 'narration', value: string) => {
        setStorybookContent(prev => {
            const newScenes = prev.scenes.map(scene => 
                scene.id === id ? { ...scene, [field]: value } : scene
            );
            return { ...prev, scenes: newScenes };
        });
    };

    const addStorybookScene = () => {
        if (storybookContent.scenes.length >= 10) return;
        setStorybookContent(prev => ({
            ...prev,
            scenes: [...prev.scenes, { 
                id: Date.now(), 
                imageDescription: '', 
                narration: '',
                isDescriptionLocked: true,
                isNarrationLocked: true,
                audioSrc: null,
                isGeneratingAudio: false,
                selectedVoice: 'Kore',
                selectedExpression: 'Storytelling',
            }]
        }));
    };

    const removeStorybookScene = (id: number) => {
        const sceneToRemove = storybookContent.scenes.find(s => s.id === id);
        if (sceneToRemove?.audioSrc && sceneToRemove.audioSrc.startsWith('blob:')) {
            URL.revokeObjectURL(sceneToRemove.audioSrc);
        }
        setStorybookContent(prev => ({
            ...prev,
            scenes: prev.scenes.filter(scene => scene.id !== id)
        }));
    };

    const handleSceneLockToggle = (id: number, field: 'description' | 'narration') => {
        setStorybookContent(prev => ({
            ...prev,
            scenes: prev.scenes.map(scene => {
                if (scene.id === id) {
                    if (field === 'description') {
                        return { ...scene, isDescriptionLocked: !scene.isDescriptionLocked };
                    }
                    if (field === 'narration') {
                        return { ...scene, isNarrationLocked: !scene.isNarrationLocked };
                    }
                }
                return scene;
            })
        }));
    };
    
    const handleCopyToClipboard = (text: string, id: string) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1500);
        }
    };

    const handleSceneAudioPropChange = (id: number, prop: 'selectedVoice' | 'selectedExpression', value: string) => {
        setStorybookContent(prev => ({
            ...prev,
            scenes: prev.scenes.map(scene =>
                scene.id === id ? { ...scene, [prop]: value } : scene
            ),
        }));
    };
    
    const handleGenerateNarrativeAudio = async () => {
        if (!storybookContent.storyNarrative?.trim()) return;
    
        setStorybookContent(prev => {
            if (prev.narrativeAudioSrc && prev.narrativeAudioSrc.startsWith('blob:')) {
                URL.revokeObjectURL(prev.narrativeAudioSrc);
            }
            return { ...prev, isGeneratingNarrativeAudio: true, narrativeAudioSrc: null };
        });
    
        const signal = startOperation();
        try {
            const audioBase64 = await generateStorybookSpeech(
                storybookContent.storyNarrative, 
                storybookContent.selectedNarrativeVoice || 'Kore',
                storybookContent.selectedNarrativeExpression || 'Storytelling',
                storybookContent.selectedNarrativeAccent || 'Nigerian English',
                signal
            );
            if (audioBase64) {
                const audioBytes = base64ToBytes(audioBase64);
                const audioBlob = pcmToWavBlob(audioBytes);
                const audioUrl = URL.createObjectURL(audioBlob);
                setStorybookContent(prev => ({ ...prev, narrativeAudioSrc: audioUrl }));
            } else {
                 throw new Error("The model did not return any audio data.");
            }
        } catch (error) {
            if (handleApiKeyError(error)) {
                 setStorybookContent(prev => ({ ...prev, isGeneratingNarrativeAudio: false }));
                 return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                return;
            }
            setAppStatus({ status: 'error', error: `Failed to generate audio: ${parsedError}` });
        } finally {
            setStorybookContent(prev => ({ ...prev, isGeneratingNarrativeAudio: false }));
            abortControllerRef.current = null;
        }
    };

    const handleGenerateStorybookAudio = async (id: number) => {
        const scene = storybookContent.scenes.find(s => s.id === id);
        if (!scene || !scene.narration?.trim()) return;

        setStorybookContent(prev => ({
            ...prev,
            scenes: prev.scenes.map(s => {
                if (s.id === id) {
                    if (s.audioSrc && s.audioSrc.startsWith('blob:')) {
                        URL.revokeObjectURL(s.audioSrc);
                    }
                    return { ...s, isGeneratingAudio: true, audioSrc: null };
                }
                return s;
            })
        }));

        try {
            const audioBase64 = await generateStorybookSpeech(
                scene.narration, 
                scene.selectedVoice || 'Kore',
                scene.selectedExpression || 'Storytelling'
            );
            if (audioBase64) {
                const audioBytes = base64ToBytes(audioBase64);
                const audioBlob = pcmToWavBlob(audioBytes);
                const audioUrl = URL.createObjectURL(audioBlob);
                setStorybookContent(prev => ({
                    ...prev,
                    scenes: prev.scenes.map(s => s.id === id ? { ...s, audioSrc: audioUrl } : s)
                }));
            } else {
                 throw new Error("The model did not return any audio data.");
            }
        } catch (error) {
            if (handleApiKeyError(error)) {
                 setStorybookContent(prev => ({
                    ...prev,
                    scenes: prev.scenes.map(s => s.id === id ? { ...s, isGeneratingAudio: false } : s)
                }));
                return;
            }
            setAppStatus({ status: 'error', error: `Failed to generate audio: ${parseErrorMessage(error)}` });
        } finally {
            setStorybookContent(prev => ({
                ...prev,
                scenes: prev.scenes.map(s => s.id === id ? { ...s, isGeneratingAudio: false } : s)
            }));
        }
    };

    const insertTextIntoTextarea = (
        textToInsert: string,
        ref: React.RefObject<HTMLTextAreaElement>,
        currentValue: string,
        setter: (newValue: string) => void
    ) => {
        const textarea = ref.current;
        if (!textarea) {
            setter(currentValue + textToInsert);
            return;
        }
    
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        const newValue = currentValue.substring(0, start) + textToInsert + currentValue.substring(end);
        setter(newValue);
    
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length;
        }, 0);
    };

    const handleCharacterNameFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        const currentName = e.target.value;
        // Check if the name matches the default pattern "Character " followed by digits
        if (/^Character \d+$/.test(currentName)) {
            e.target.select();
        }
    };

    const handleCharacterImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, charId: number) => {
        const file = e.target.files?.[0];
        if (!file) return;

        e.target.value = '';
        const signal = startOperation();

        try {
            setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: true } : c));
            const { base64, mimeType } = await compressImageBase64(
                await fileToBase64(file),
                file.type,
                1024,
                1024
            );

            const { description, detectedStyle } = await generateCharacterDescription(base64, mimeType, signal);

            setCharacters(prev => prev.map(c => c.id === charId ? {
                ...c,
                imagePreview: `data:${mimeType};base64,${base64}`,
                originalImageBase64: base64,
                originalImageMimeType: mimeType,
                description,
                detectedImageStyle: detectedStyle,
                isDescribing: false
            } : c));

        } catch (error) {
            if (handleApiKeyError(error)) {
                 setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: false } : c));
                 return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: false, description: "Analysis stopped." } : c));
                return;
            }
            console.error('Error processing character image:', error);
            setAppStatus({ status: 'error', error: `Failed to describe character: ${parsedError}` });
            setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: false } : c));
        } finally {
            abortControllerRef.current = null;
        }
    };

    const onFileUploadForChar = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (uploadingCharId !== null) {
            handleCharacterImageUpload(e, uploadingCharId);
            setUploadingCharId(null);
        }
    };

    const handleUploadNewCharacterImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
    
        e.target.value = '';
        const signal = startOperation();
    
        const newCharId = nextCharId;
        const newCharacter: Character = {
            id: newCharId,
            name: `Character ${newCharId}`,
            imagePreview: null,
            originalImageBase64: null,
            originalImageMimeType: null,
            description: null,
            detectedImageStyle: null,
            isDescribing: true,
        };
    
        setCharacters(prev => [...prev, newCharacter]);
        setNextCharId(prevId => prevId + 1);
    
        try {
            const { base64, mimeType } = await compressImageBase64(
                await fileToBase64(file),
                file.type,
                1024,
                1024
            );
    
            const { description, detectedStyle } = await generateCharacterDescription(base64, mimeType, signal);
    
            setCharacters(prev => prev.map(c => c.id === newCharId ? {
                ...c,
                imagePreview: `data:${mimeType};base64,${base64}`,
                originalImageBase64: base64,
                originalImageMimeType: mimeType,
                description,
                detectedImageStyle: detectedStyle,
                isDescribing: false
            } : c));
    
        } catch (error) {
            if (handleApiKeyError(error)) {
                setCharacters(prev => prev.map(c => c.id === newCharId ? { ...c, isDescribing: false, description: "Error" } : c));
                return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                setCharacters(prev => prev.map(c => c.id === newCharId ? { ...c, isDescribing: false, description: "Analysis stopped." } : c));
                return;
            }
            console.error('Error processing new character image:', error);
            setAppStatus({ status: 'error', error: `Failed to describe character: ${parsedError}` });
            setCharacters(prev => prev.map(c => c.id === newCharId ? { ...c, isDescribing: false, description: "Error processing image." } : c));
        } finally {
             abortControllerRef.current = null;
        }
    };

    const handleBuildCharacterVisual = async (charId: number) => {
        const character = characters.find(c => c.id === charId);
        if (!character || (!character.description?.trim() && !character.originalImageBase64) || !character.name.trim()) {
            setAppStatus({ status: 'error', error: "Character needs a name and either a description or an uploaded image to be built." });
            setTimeout(() => setAppStatus({ status: 'idle', error: null }), 3000);
            return;
        }
    
        setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: true } : c));
        const signal = startOperation();
    
        try {
            const { src, error } = await generateCharacterVisual(
                character,
                imageStyle,
                signal
            );
    
            if (src) {
                setCharacters(prev => prev.map(c => c.id === charId ? {
                    ...c,
                    imagePreview: `data:image/png;base64,${src}`,
                    originalImageBase64: src,
                    originalImageMimeType: 'image/png',
                    isDescribing: false
                } : c));
                incrementCount('images', 1, 'gemini-2.5-flash-image');
                setZoomedImage(src);
            } else {
                throw new Error(error || "Failed to generate character visual");
            }
    
        } catch (error) {
             if (handleApiKeyError(error)) {
                 setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: false } : c));
                 return;
             }
             const parsedError = parseErrorMessage(error);
             setAppStatus({ status: 'error', error: `Character build failed: ${parsedError}` });
             setCharacters(prev => prev.map(c => c.id === charId ? { ...c, isDescribing: false } : c));
        } finally {
            abortControllerRef.current = null;
        }
    };

    const updateCharacter = (id: number, updatedProps: Partial<Character>) => {
        setCharacters(chars => chars.map(c => c.id === id ? { ...c, ...updatedProps } : c));
    };

    const removeCharacter = (id: number) => {
        setCharacters(chars => chars.filter(c => c.id !== id));
    };

    const executeBatchGeneration = useCallback(async (modelToUse: string) => {
        setAppStatus({ status: 'loading', error: null });
        setStatusMessage('Starting generation...');
        setActiveVideoIndex(-1);
        const signal = startOperation();

        try {
            const newHistoryItem: GenerationItem = {
                id: Date.now(),
                prompt,
                imageSet: Array.from({ length: imageCount }, () => ({ src: null, prompt: 'Generating...', error: null, isRegenerating: false, isGenerating: true })),
                videoStates: [], 
                aspectRatio,
                imageStyle,
                genre,
                characters,
                imageModel: modelToUse
            };
            
            setGenerationHistory(prev => [...prev, newHistoryItem]);
            setActiveHistoryIndex(prev => prev + 1);

            const result = await generateImageSet(
                prompt,
                imageCount,
                aspectRatio,
                imageStyle,
                genre,
                characters,
                characters, 
                modelToUse,
                (message) => setStatusMessage(message),
                signal
            );
            
            const successfulCount = result.storyboard.filter(s => s.src).length;
            if (successfulCount > 0) {
                incrementCount('images', successfulCount, modelToUse);
            }

            setGenerationHistory(prev => prev.map(item =>
                item.id === newHistoryItem.id
                    ? {
                        ...item,
                        imageSet: result.storyboard.map(scene => ({...scene, isGenerating: false})),
                        videoStates: result.storyboard.map(scene => ({
                            status: 'idle',
                            clips: [],
                            currentClipIndex: -1,
                            error: null,
                            loadingMessage: '',
                            showScriptInput: false,
                            scriptPrompt: '',
                            voiceoverMode: 'tts',
                            voiceoverFile: null,
                            speaker: 'Narrator',
                            cameraMovement: 'Static Hold',
                        })),
                    }
                    : item
            ));

            setAppStatus({ status: 'idle', error: null });
            setStatusMessage('');

        } catch (error) {
            if (handleApiKeyError(error)) {
                 setAppStatus({ status: 'idle', error: null });
                 setStatusMessage('');
                 return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                const abortMessage = "Generation stopped. This could be due to cancellation or a mobile network interruption.";
                setAppStatus({ status: 'error', error: abortMessage });
                setStatusMessage('');
                setGenerationHistory(prev => prev.map(item => {
                    if (item.id === prev[prev.length - 1]?.id) {
                        return { ...item, imageSet: item.imageSet.map(s => s.isGenerating ? {...s, isGenerating: false, error: 'Stopped.'} : s) }
                    }
                    return item;
                }));
                return;
            }

            setAppStatus({ status: 'error', error: parsedError });
            setStatusMessage('');
             setGenerationHistory(prev => prev.map(item => {
                 if (item.id === prev[prev.length - 1]?.id) {
                     return {
                         ...item,
                         imageSet: item.imageSet.map(s => s.isGenerating ? {...s, isGenerating: false, error: parsedError} : s)
                     }
                 }
                 return item;
             }));
        } finally {
            abortControllerRef.current = null;
        }
    }, [prompt, imageCount, aspectRatio, imageStyle, genre, characters, incrementCount]);

    const handleGenerate = useCallback(() => {
        if (!prompt.trim() || appStatus.status === 'loading') {
            return;
        }
        
        setGenerationModalState({
            isOpen: true,
            type: 'image',
            target: { generationId: -1, sceneIndex: -1, extend: false },
            model: imageModel,
            onConfirm: (selectedModel: string) => {
                executeBatchGeneration(selectedModel);
            },
        });
    }, [prompt, appStatus.status, imageModel, executeBatchGeneration]);


    const handleRegenerateScene = useCallback(async (generationId: number, sceneIndex: number, modelToUse: string) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        if (!generationItem) return;

        const sceneToRegenerate = generationItem.imageSet[sceneIndex];
        const signal = startOperation();

        setGenerationHistory(prev =>
            prev.map(item =>
                item.id === generationId
                    ? {
                        ...item,
                        imageSet: item.imageSet.map((scene, index) =>
                            index === sceneIndex ? { ...scene, isRegenerating: true, error: null } : scene
                        ),
                    }
                    : item
            )
        );

        try {
            const { src, error } = await generateSingleImage(
                sceneToRegenerate.prompt,
                generationItem.aspectRatio,
                generationItem.imageStyle,
                generationItem.genre,
                generationItem.characters,
                generationItem.characters,
                modelToUse,
                null,
                null,
                signal
            );

            if (src) {
                incrementCount('images', 1, modelToUse);
                setZoomedImage(src);
            }

            setGenerationHistory(prev =>
                prev.map(item =>
                    item.id === generationId
                        ? {
                            ...item,
                            imageSet: item.imageSet.map((scene, index) =>
                                index === sceneIndex ? { ...scene, src, error, isRegenerating: false } : scene
                            ),
                        }
                        : item
                )
            );
        } catch (error) {
            if (handleApiKeyError(error)) {
                setGenerationHistory(prev =>
                    prev.map(item =>
                        item.id === generationId
                            ? {
                                ...item,
                                imageSet: item.imageSet.map((scene, index) =>
                                    index === sceneIndex ? { ...scene, isRegenerating: false } : scene
                                ),
                            }
                            : item
                    )
                );
                return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                setGenerationHistory(prev =>
                    prev.map(item =>
                        item.id === generationId
                            ? {
                                ...item,
                                imageSet: item.imageSet.map((scene, index) =>
                                    index === sceneIndex ? { ...scene, isRegenerating: false, error: 'Stopped.' } : scene
                                ),
                            }
                            : item
                    )
                );
                return;
            }

            setGenerationHistory(prev =>
                prev.map(item =>
                    item.id === generationId
                        ? {
                            ...item,
                            imageSet: item.imageSet.map((scene, index) =>
                                index === sceneIndex ? { ...scene, error: parsedError, isRegenerating: false } : scene
                            ),
                        }
                        : item
                )
            );
        } finally {
            abortControllerRef.current = null;
        }
    }, [generationHistory, incrementCount]);

    const handleRemoveAngleScene = (generationId: number, sceneIndex: number) => {
        setGenerationHistory(prev =>
            prev.map(item => {
                if (item.id === generationId) {
                    const sceneToRemove = item.imageSet[sceneIndex];
                    if (sceneToRemove.isCameraAngleFor === undefined) return item;
    
                    const newImageSet = item.imageSet.filter((_, i) => i !== sceneIndex);
                    const newVideoStates = item.videoStates.filter((_, i) => i !== sceneIndex);
                    
                    if (activeVideoIndex === sceneIndex) {
                        setActiveVideoIndex(-1);
                    } else if (activeVideoIndex > sceneIndex) {
                        setActiveVideoIndex(prevIndex => (prevIndex - 1));
                    }
    
                    return { ...item, imageSet: newImageSet, videoStates: newVideoStates };
                }
                return item;
            })
        );
    };

    const handleDeleteVideoClip = (generationId: number, sceneIndex: number) => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            
            const videoState = item.videoStates[sceneIndex];
            if (videoState.clips.length === 0) return item;

            const newClips = videoState.clips.slice(0, -1);
            // Determine new current index: if it was pointing to the last one (which we deleted), decrement.
            // If it was pointing to an earlier one, keep it, unless list becomes empty.
            let newIndex = videoState.currentClipIndex;
            if (newIndex >= newClips.length) {
                newIndex = newClips.length - 1;
            }

            const newVideoStates = [...item.videoStates];
            newVideoStates[sceneIndex] = { 
                ...videoState, 
                clips: newClips,
                currentClipIndex: newIndex
            };
            return { ...item, videoStates: newVideoStates };
        }));
    };
    
    const handleVideoClipNavigation = (generationId: number, sceneIndex: number, direction: 'prev' | 'next') => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            
            const videoState = item.videoStates[sceneIndex];
            let newIndex = videoState.currentClipIndex;
            
            if (direction === 'prev') {
                newIndex = Math.max(0, newIndex - 1);
            } else {
                newIndex = Math.min(videoState.clips.length - 1, newIndex + 1);
            }
            
            const newVideoStates = [...item.videoStates];
            newVideoStates[sceneIndex] = { ...videoState, currentClipIndex: newIndex };
            return { ...item, videoStates: newVideoStates };
        }));
    };

    const handleGenerateVideo = useCallback(async (generationId: number, sceneIndex: number, extendFromLastClip = false, modelToUse: string) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        if (!generationItem) return;
    
        const scene = generationItem.imageSet[sceneIndex];
        const videoState = generationItem.videoStates[sceneIndex];
        if (!scene || videoState.status === 'loading') return;
    
        let previousVideoObject: any = null;
        if (extendFromLastClip) {
            // Use the MOST RECENT clip to extend from
            const lastClip = videoState.clips[videoState.clips.length - 1];
            if (!lastClip?.videoObject) {
                const error = "Could not find a previous clip to extend.";
                setGenerationHistory(prev => prev.map(item => {
                    if (item.id !== generationId) return item;
                    const newVideoStates = [...item.videoStates];
                    newVideoStates[sceneIndex] = { ...newVideoStates[sceneIndex], status: 'error', error };
                    return { ...item, videoStates: newVideoStates };
                }));
                return;
            }
            previousVideoObject = lastClip.videoObject;
        }

        const updateVideoState = (newState: Partial<VideoState>) => {
            setGenerationHistory(prev => prev.map(item => {
                if (item.id !== generationId) return item;
                const newVideoStates = [...item.videoStates];
                newVideoStates[sceneIndex] = { ...newVideoStates[sceneIndex], ...newState };
                return { ...item, videoStates: newVideoStates };
            }));
        };
    
        updateVideoState({ status: 'loading', error: null, loadingMessage: extendFromLastClip ? "Initializing extension..." : "Initializing..." });
        const signal = startOperation();
    
        try {
            let audioOptions: AudioOptions | null = null;
            if (videoState.voiceoverMode === 'tts' && videoState.scriptPrompt) {
                audioOptions = { mode: 'tts', data: videoState.scriptPrompt };
            } else if (videoState.voiceoverMode === 'upload' && videoState.voiceoverFile) {
                const base64 = await fileToBase64(videoState.voiceoverFile);
                audioOptions = { mode: 'upload', data: base64, mimeType: videoState.voiceoverFile.type };
            }
    
            const { videoUrl, audioUrl, videoObject, audioBase64 } = await generateVideoFromScene(
                scene,
                generationItem.aspectRatio,
                videoState.scriptPrompt,
                generationItem.characters,
                audioOptions,
                generationItem.imageStyle,
                modelToUse,
                '720p',
                videoState.cameraMovement,
                (message) => updateVideoState({ loadingMessage: message }),
                previousVideoObject,
                signal
            );
            
            incrementCount('videos', 1, modelToUse);

            const newClip: VideoClip = { videoUrl, audioUrl, videoObject, audioBase64 };
            const currentClips = videoState.clips || [];

            updateVideoState({
                status: 'success',
                clips: [...currentClips, newClip],
                currentClipIndex: currentClips.length, // Auto-select the new clip
                loadingMessage: '',
            });
    
        } catch (error) {
            if (handleApiKeyError(error)) {
                updateVideoState({ status: 'error', error: parseErrorMessage(error) });
                return;
            };
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                updateVideoState({ status: 'error', error: 'Stopped.' });
                return;
            }
            console.error("Video generation failed:", error);
            
            // Provide specific user-friendly guidance for the "no video returned" safety error
            if (parsedError.includes("no video was returned")) {
                updateVideoState({ 
                    status: 'error', 
                    error: "Safety Block: The prompt or image triggered a safety filter. Try simplifying the text prompt or using a different image." 
                });
            } else {
                updateVideoState({ status: 'error', error: parsedError });
            }
        } finally {
            abortControllerRef.current = null;
        }
    }, [generationHistory, incrementCount]);

    const openConfirmationModal = (type: 'image' | 'video', generationId: number, sceneIndex: number, extend = false) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        if (!generationItem) return;
    
        const defaultModel = type === 'image' ? generationItem.imageModel : videoModel;
    
        setGenerationModalState({
            isOpen: true,
            type,
            target: { generationId, sceneIndex, extend },
            model: defaultModel,
            onConfirm: (selectedModel: string) => {
                if (type === 'image') {
                    handleRegenerateScene(generationId, sceneIndex, selectedModel);
                } else {
                    handleGenerateVideo(generationId, sceneIndex, extend, selectedModel);
                }
            },
        });
    };
    
    const handleHistoryNavigation = (index: number) => {
        if (index >= 0 && index < generationHistory.length) {
            setActiveHistoryIndex(index);
            setActiveVideoIndex(-1); 
        }
    };

    const handleRemoveHistoryItem = (id: number) => {
        setGenerationHistory(prev => {
            const newHistory = prev.filter(item => item.id !== id);
            if (activeHistoryIndex >= newHistory.length) {
                setActiveHistoryIndex(newHistory.length - 1);
            }
            return newHistory;
        });
    };
    
    const handleScriptChange = (generationId: number, sceneIndex: number, newScript: string) => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            
            let detectedSpeaker = 'Narrator';
            const match = newScript.match(/^([^\n:]+):/);
            if (match) {
                const extractedName = match[1].trim();
                const matchedChar = characters.find(c => c.name.toLowerCase() === extractedName.toLowerCase());
                if (matchedChar) {
                    detectedSpeaker = matchedChar.name; 
                } else {
                    detectedSpeaker = extractedName;
                }
            }

            const newVideoStates = [...item.videoStates];
            newVideoStates[sceneIndex] = { 
                ...newVideoStates[sceneIndex], 
                scriptPrompt: newScript,
                speaker: detectedSpeaker 
            };
            return { ...item, videoStates: newVideoStates };
        }));
    };

    const handleCameraMovementChange = (generationId: number, sceneIndex: number, movement: string) => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            const newVideoStates = [...item.videoStates];
            newVideoStates[sceneIndex] = { ...newVideoStates[sceneIndex], cameraMovement: movement, isCameraMovementOpen: false };
            return { ...item, videoStates: newVideoStates };
        }));
    };

    const toggleCameraMovement = (generationId: number, sceneIndex: number) => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            const newVideoStates = [...item.videoStates];
            const current = newVideoStates[sceneIndex].isCameraMovementOpen;
            newVideoStates[sceneIndex] = { ...newVideoStates[sceneIndex], isCameraMovementOpen: !current };
            return { ...item, videoStates: newVideoStates };
        }));
    };

    const handleVoiceoverModeChange = (generationId: number, sceneIndex: number, mode: 'tts' | 'upload') => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            const newVideoStates = [...item.videoStates];
            newVideoStates[sceneIndex] = { ...newVideoStates[sceneIndex], voiceoverMode: mode };
            return { ...item, videoStates: newVideoStates };
        }));
    };

    const handleVoiceoverFileChange = (generationId: number, sceneIndex: number, file: File | null) => {
        setGenerationHistory(prev => prev.map(item => {
            if (item.id !== generationId) return item;
            const newVideoStates = [...item.videoStates];
            newVideoStates[sceneIndex] = { ...newVideoStates[sceneIndex], voiceoverFile: file };
            return { ...item, videoStates: newVideoStates };
        }));
    };

    const openVideoCreator = (index: number) => {
        setActiveVideoIndex(index === activeVideoIndex ? -1 : index);
    };

    const openAngleSelectionModal = (generationId: number, sceneIndex: number) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        if (generationItem) {
            setCharactersForAngleModal(generationItem.characters || []);
        } else {
            setCharactersForAngleModal([]);
        }
    
        setAngleSelectionTarget({ generationId, sceneIndex });
        setSelectedAngle(null);
        setFocusSubject('General Scene');
        setIsAngleModalOpen(true);
    };
    
    const handleAngleSelection = (angleKey: string) => {
        setSelectedAngle(prev => (prev === angleKey ? null : angleKey));
    };

    const handleSyncCharactersForAngleModal = () => {
        setCharactersForAngleModal(characters);
    };

    const handleGenerateCameraAngles = useCallback(async () => {
        if (!angleSelectionTarget || !selectedAngle) {
            setIsAngleModalOpen(false);
            return;
        }
        const { generationId, sceneIndex } = angleSelectionTarget;
    
        const generationItem = generationHistory.find(item => item.id === generationId);
        if (!generationItem) return;
    
        setIsAngleModalOpen(false);
        const scene = generationItem.imageSet[sceneIndex];
    
        setGenerationHistory(prev => prev.map(item => {
            if (item.id === generationId) {
                return {
                    ...item,
                    imageSet: item.imageSet.map((s, i) => i === sceneIndex ? { ...s, isGeneratingAngles: true } : s)
                };
            }
            return item;
        }));
        
        setStatusMessage("Generating camera angles...");
        const signal = startOperation();
    
        try {
            const angleScenes = await generateCameraAnglesFromImage(
                scene,
                {
                    aspectRatio: generationItem.aspectRatio,
                    imageStyle: generationItem.imageStyle,
                    genre: generationItem.genre,
                    characters: generationItem.characters,
                    imageModel: 'gemini-2.5-flash-image', 
                },
                [selectedAngle],
                focusSubject,
                (message) => setStatusMessage(message),
                signal
            );
    
            const successfulCount = angleScenes.filter(s => s.src).length;
            if (successfulCount > 0) {
                incrementCount('images', successfulCount, 'gemini-2.5-flash-image');
            }
    
            setGenerationHistory(prev => prev.map(item => {
                if (item.id === generationId) {
                    const newImageSet = [...item.imageSet];
                    newImageSet[sceneIndex] = { ...newImageSet[sceneIndex], isGeneratingAngles: false };
                    
                    const scenesToInsert = angleScenes.map(s => ({ ...s, isCameraAngleFor: sceneIndex }));
                    newImageSet.splice(sceneIndex + 1, 0, ...scenesToInsert);
                    
                    const parentVideoState = item.videoStates[sceneIndex];

                    const newVideoStates = [...item.videoStates];
                    const videoStatesToInsert = angleScenes.map(() => ({
                        status: 'idle' as const, clips: [], currentClipIndex: -1, error: null, loadingMessage: '',
                        showScriptInput: false, 
                        // Inherit script and speaker settings from parent
                        scriptPrompt: parentVideoState.scriptPrompt, 
                        voiceoverMode: parentVideoState.voiceoverMode, // Inherit mode (TTS/Upload)
                        voiceoverFile: parentVideoState.voiceoverFile, 
                        speaker: parentVideoState.speaker, 
                        cameraMovement: 'Static Hold',
                    }));
                    newVideoStates.splice(sceneIndex + 1, 0, ...videoStatesToInsert);
    
                    return { ...item, imageSet: newImageSet, videoStates: newVideoStates };
                }
                return item;
            }));
        } catch (error) {
            if (handleApiKeyError(error)) {
                setGenerationHistory(prev => prev.map(item => {
                    if (item.id === generationId) {
                        return {
                            ...item,
                            imageSet: item.imageSet.map((s, i) => i === sceneIndex ? { ...s, isGeneratingAngles: false } : s)
                        };
                    }
                    return item;
                }));
                return;
            }
            const parsedError = parseErrorMessage(error);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                return;
            }
            setAppStatus({ status: 'error', error: `Failed to generate angles: ${parsedError}` });
        } finally {
            setGenerationHistory(prev => prev.map(item => {
                if (item.id === generationId) {
                    return {
                        ...item,
                        imageSet: item.imageSet.map((s, i) => i === sceneIndex ? { ...s, isGeneratingAngles: false } : s)
                    };
                }
                return item;
            }));
            setStatusMessage("");
            abortControllerRef.current = null;
            setAngleSelectionTarget(null);
            setSelectedAngle(null);
        }
    }, [generationHistory, incrementCount, angleSelectionTarget, selectedAngle, focusSubject]);
    
    const startEditing = (generationId: number, sceneIndex: number) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        const scene = generationItem?.imageSet[sceneIndex];
        if (scene && scene.src) {
            setEditingScene({
                ...scene,
                generationId,
                sceneIndex,
                editPrompt: '',
                overlayImage: null,
                isEditing: true,
                previousSrc: scene.src,
                editHistory: [scene.src],
                editHistoryIndex: 0
            });
            setGenerationHistory(prev => prev.map(item => {
                if (item.id === generationId) {
                    return { ...item, imageSet: item.imageSet.map((s, i) => i === sceneIndex ? { ...s, isEditing: true } : s) };
                }
                return item;
            }));
            setHasDrawn(false);
            setDrawingMode('none');
        }
    };

    const cancelEditing = () => {
        if (editingScene) {
            setGenerationHistory(prev => prev.map(item => {
                if (item.id === editingScene.generationId) {
                    return {
                        ...item,
                        imageSet: item.imageSet.map((s, i) =>
                            i === editingScene.sceneIndex
                                ? { ...s, isEditing: false, src: editingScene.previousSrc } // Revert to original on cancel
                                : s
                        )
                    };
                }
                return item;
            }));
            setEditingScene(null);
        }
    };

    const saveAndCloseEditing = () => {
        if (!editingScene) return;
        setGenerationHistory(prev => prev.map(item => {
            if (item.id === editingScene.generationId) {
                return {
                    ...item,
                    imageSet: item.imageSet.map((s, i) =>
                        i === editingScene.sceneIndex
                            // Save the current state of the image from the modal
                            ? { ...s, isEditing: false, src: editingScene.src, prompt: `(Edited) ${s.prompt}` }
                            : s
                    )
                };
            }
            return item;
        }));
        setEditingScene(null);
    };

    const handleUndoEdit = () => {
        setEditingScene(prev => {
            if (!prev || prev.editHistoryIndex <= 0) return prev;
            const newIndex = prev.editHistoryIndex - 1;
            const previousImage = prev.editHistory[newIndex];
            return {
                ...prev,
                src: previousImage,
                editHistoryIndex: newIndex,
                error: null
            };
        });
    };
    
    const handleRedoEdit = () => {
        setEditingScene(prev => {
            if (!prev || prev.editHistoryIndex >= prev.editHistory.length - 1) return prev;
            const newIndex = prev.editHistoryIndex + 1;
            const nextImage = prev.editHistory[newIndex];
            return {
                ...prev,
                src: nextImage,
                editHistoryIndex: newIndex,
                error: null
            };
        });
    };

    const handleOverlayImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editingScene) return;
        e.target.value = '';
    
        try {
            const base64 = await fileToBase64(file);
            setEditingScene(prev => prev ? {
                ...prev,
                overlayImage: { base64, mimeType: file.type }
            } : null);
        } catch (err) {
            console.error("Failed to load overlay image", err);
            setEditingScene(prev => prev ? { ...prev, error: "Failed to load overlay image." } : null);
        }
    };

    const generateEditVariation = async () => {
        if (!editingScene || !editingScene.src) return;
    
        const generationItem = generationHistory.find(item => item.id === editingScene.generationId);
        if (!generationItem) return;
    
        let imageToProcess = editingScene.src;
        let hasVisualMasks = false;
    
        if (hasDrawn && canvasRef.current) {
             const img = new Image();
             img.src = `data:image/png;base64,${editingScene.src}`;
             await img.decode();
             
             const offscreen = document.createElement('canvas');
             offscreen.width = img.naturalWidth;
             offscreen.height = img.naturalHeight;
             const ctx = offscreen.getContext('2d');
             
             if (ctx) {
                ctx.drawImage(img, 0, 0);
                ctx.drawImage(canvasRef.current, 0, 0);
                imageToProcess = offscreen.toDataURL('image/png').split(',')[1];
                hasVisualMasks = true;
             }
        }
        
        if (!editingScene.editPrompt.trim() && !hasVisualMasks && !editingScene.overlayImage) return;
    
        setEditingScene(prev => prev ? { ...prev, isRegenerating: true, error: null } : null);
        const signal = startOperation();
    
        try {
            const { src, error } = await editImage({
                imageBase64: imageToProcess,
                mimeType: 'image/png',
                editPrompt: editingScene.editPrompt,
                aspectRatio: generationItem.aspectRatio,
                imageStyle: generationItem.imageStyle,
                genre: generationItem.genre,
                characters: generationItem.characters,
                hasVisualMasks,
                overlayImage: editingScene.overlayImage,
                signal,
                imageModel: 'gemini-2.5-flash-image'
            });
    
            if (src && !error) {
                incrementCount('images', 1, 'gemini-2.5-flash-image');
                
                setEditingScene(prev => {
                    if (!prev) return null;
                    const newHistory = prev.editHistory.slice(0, prev.editHistoryIndex + 1);
                    newHistory.push(src);
                    return {
                        ...prev,
                        src,
                        isRegenerating: false,
                        editHistory: newHistory,
                        editHistoryIndex: newHistory.length - 1,
                        error: null,
                    };
                });
                clearCanvas();
    
            } else {
                setEditingScene(prev => prev ? { ...prev, isRegenerating: false, error } : null);
            }
    
        } catch (err) {
            if (handleApiKeyError(err)) {
                setEditingScene(prev => prev ? { ...prev, isRegenerating: false } : null);
                return;
            };
            const parsedError = parseErrorMessage(err);
            if (parsedError === 'Aborted') {
                setEditingScene(prev => prev ? { ...prev, isRegenerating: false, error: 'Stopped.' } : null);
                return;
            }
            setEditingScene(prev => prev ? { ...prev, isRegenerating: false, error: parsedError } : null);
        } finally {
            abortControllerRef.current = null;
        }
    };
    
    const saveScene = async (generationId: number, sceneIndex: number) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        if (!generationItem) return;
        
        const scene = generationItem.imageSet[sceneIndex];
        const videoState = generationItem.videoStates[sceneIndex];
        const id = `${generationId}-${sceneIndex}`;

        if (savedItems.some(item => item.id === id)) {
            // If already saved, unsave it
            unsaveScene(id);
            return;
        }

        const newItem: SavedItem = {
            id,
            scene,
            videoState,
            originalPrompt: generationItem.prompt,
            aspectRatio: generationItem.aspectRatio,
            imageStyle: generationItem.imageStyle,
            genre: generationItem.genre,
            characters: generationItem.characters,
            imageModel: generationItem.imageModel,
            expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) 
        };

        const newSavedItems = [newItem, ...savedItems];
        setSavedItems(newSavedItems);
        await saveItems(newSavedItems);
    };

    const unsaveScene = async (id: string) => {
        const newSavedItems = savedItems.filter(item => item.id !== id);
        setSavedItems(newSavedItems);
        await saveItems(newSavedItems);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
    
        const newItems: UploadedItem[] = [];
        const filesArray: File[] = Array.from(files);
        for (const file of filesArray) {
            try {
                const base64 = await fileToBase64(file);
                const scene: AppStoryboardScene = { src: base64, prompt: file.name };
                
                const generationItem: UploadedItem['generationItem'] = {
                    prompt: `Uploaded: ${file.name}`,
                    imageSet: [scene],
                    aspectRatio: '16:9', 
                    imageStyle: 'Afro-toon', 
                    genre: 'General',
                    characters: [], 
                    imageModel: 'gemini-2.5-flash-image', 
                };
    
                newItems.push({
                    id: `upload-${Date.now()}-${file.name}`,
                    generationItem,
                    videoStates: [{
                        status: 'idle' as const, clips: [], currentClipIndex: -1, error: null, loadingMessage: '',
                        showScriptInput: false, scriptPrompt: '', voiceoverMode: 'tts', voiceoverFile: null,
                        speaker: 'Narrator', cameraMovement: 'Static Hold'
                    }],
                    mimeType: file.type,
                    detectedCharacters: [],
                });
            } catch (err) {
                setAppStatus({ status: 'error', error: `Failed to load file: ${file.name}` });
            }
        }
    
        setUploadedItems(prev => [...prev, ...newItems]);
    };

    const addUploadedToStoryboard = (item: UploadedItem) => {
        const newGenerationItem: GenerationItem = {
            ...item.generationItem,
            id: Date.now(),
            videoStates: item.videoStates,
        };
        const newHistory = [...generationHistory, newGenerationItem];
        setGenerationHistory(newHistory);
        setActiveHistoryIndex(newHistory.length - 1);

        setUploadedItems(prev => prev.filter(up => up.id !== item.id));
    };

    const handleInitialImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
    
        e.target.value = ''; // Reset for next upload
    
        setAppStatus({ status: 'loading', error: null });
        setStatusMessage('Loading image...');
    
        try {
            const base64 = await fileToBase64(file);
            
            const getAspectRatio = (imgSrc: string): Promise<string> => {
                return new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => {
                        const ratio = img.width / img.height;
                        if (Math.abs(ratio - 16/9) < 0.1) resolve('16:9');
                        else if (Math.abs(ratio - 9/16) < 0.1) resolve('9:16');
                        else if (Math.abs(ratio - 4/3) < 0.1) resolve('4:3');
                        else if (Math.abs(ratio - 3/4) < 0.1) resolve('3:4');
                        else if (Math.abs(ratio - 1) < 0.1) resolve('1:1');
                        else resolve('16:9'); // Default if not a standard ratio
                    };
                    img.onerror = () => resolve('16:9'); // Default on error
                    img.src = imgSrc;
                });
            };
            
            const detectedAspectRatio = await getAspectRatio(`data:${file.type};base64,${base64}`);
    
            const newScene: AppStoryboardScene = {
                src: base64,
                prompt: `Uploaded: ${file.name}`,
                error: null,
                isGenerating: false,
                isRegenerating: false,
            };
    
            const newVideoState: VideoState = {
                status: 'idle',
                clips: [],
                currentClipIndex: -1,
                error: null,
                loadingMessage: '',
                showScriptInput: false,
                scriptPrompt: '',
                voiceoverMode: 'tts',
                voiceoverFile: null,
                speaker: 'Narrator',
                cameraMovement: 'Static Hold',
            };
    
            const newHistoryItem: GenerationItem = {
                id: Date.now(),
                prompt: `Uploaded: ${file.name}`,
                imageSet: [newScene],
                videoStates: [newVideoState],
                aspectRatio: detectedAspectRatio,
                imageStyle: 'Realistic Photo',
                genre: 'General',
                characters: [],
                imageModel: imageModel,
            };
            
            const newHistory = [...generationHistory, newHistoryItem];
            setGenerationHistory(newHistory);
            setActiveHistoryIndex(newHistory.length - 1);
            setAppStatus({ status: 'idle', error: null });
            setStatusMessage('');
    
        } catch (error) {
            const parsedError = parseErrorMessage(error);
            setAppStatus({ status: 'error', error: `Failed to load image: ${parsedError}` });
            setStatusMessage('');
        }
    };
    

    const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setIsProcessingAudio(true);
        setAppStatus({ status: 'idle', error: null });
        const signal = startOperation();

        try {
            const filesArray: File[] = Array.from(files);
            for (const file of filesArray) {
                const base64 = await fileToBase64(file);
                const transcription = await generatePromptFromAudio(base64, file.type, signal);
                
                const detected: Character[] = [];
                characters.forEach(char => {
                    if (transcription.toLowerCase().includes(char.name.toLowerCase())) {
                        detected.push(char);
                    }
                });

                const newAssignment: AudioAssignment = {
                    file,
                    transcription,
                    detectedCharacters: detected,
                    assignment: null,
                };
                setAudioAssignments(prev => [...prev, newAssignment]);
            }
        } catch (err) {
             if (handleApiKeyError(err)) {
                setIsProcessingAudio(false);
                return;
             }
             const parsedError = parseErrorMessage(err);
            if (parsedError === 'Aborted') {
                setAppStatus({ status: 'error', error: "Generation stopped. This could be due to cancellation or a mobile network interruption." });
                return;
            }
            setAppStatus({ status: 'error', error: `Failed to process audio: ${parsedError}` });
        } finally {
            setIsProcessingAudio(false);
            abortControllerRef.current = null;
        }
         e.target.value = '';
    };

    const updateAudioAssignment = (index: number, newAssignment: AudioAssignment['assignment']) => {
        setAudioAssignments(prev => {
            const newAssignments = [...prev];
            newAssignments[index].assignment = newAssignment;
            return newAssignments;
        });
    };

    const applyAudioAsPrompt = (transcription: string) => {
        setPrompt(prev => prev ? `${prev}\n${transcription}` : transcription);
    };
    
    const renderCharacterInserter = (
        target: 'prompt' | 'script' | 'edit',
        generationId?: number, 
        sceneIndex?: number 
    ) => {
        if (characters.length === 0) return null;
    
        const handleInsert = (name: string) => {
            const textToInsert = name + ' ';
    
            if (target === 'prompt') {
                insertTextIntoTextarea(textToInsert, promptTextAreaRef, prompt, setPrompt);
            } else if (target === 'edit' && editingScene) {
                const setter = (newValue: string) => setEditingScene({ ...editingScene, editPrompt: newValue });
                insertTextIntoTextarea(textToInsert, editPromptTextAreaRef, editingScene.editPrompt, setter);
                // Automatically switch to ADD mode when a character is inserted in edit view
                setDrawingMode('add');
            } else if (target === 'script' && generationId !== undefined && sceneIndex !== undefined) {
                const generationItem = generationHistory.find(item => item.id === generationId);
                const currentScript = generationItem?.videoStates[sceneIndex]?.scriptPrompt || '';
                const setter = (newValue: string) => handleScriptChange(generationId, sceneIndex, newValue);
                insertTextIntoTextarea(textToInsert, scriptTextAreaRef, currentScript, setter);
            }
        };
    
        return (
            <div className="flex flex-wrap items-center gap-2 mt-2">
                {characters.map(c => c.name ? (
                    <button
                        key={c.id}
                        onClick={() => handleInsert(c.name)}
                        className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-600 hover:border-indigo-500 hover:scale-110 transition-all shadow-sm"
                        title={target === 'edit' ? `Insert ${c.name} & Select Paint Tool` : `Insert ${c.name}`}
                        aria-label={`Insert ${c.name}`}
                    >
                        {c.imagePreview ? (
                            <img src={c.imagePreview} alt={c.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full bg-indigo-900 flex items-center justify-center text-[10px] text-white font-bold uppercase">
                                {c.name.substring(0, 2)}
                            </div>
                        )}
                    </button>
                ) : null)}
            </div>
        );
    };

    const handleStorybookCharacterInsert = (name: string) => {
        const textToInsert = name + ' ';
        if (isAiStoryHelpMode) {
            insertTextIntoTextarea(textToInsert, storybookAiPromptTextAreaRef, storybookAiPrompt, setStorybookAiPrompt);
        } else {
            const setter = (newValue: string) => handleStorybookChange('storyNarrative', newValue);
            insertTextIntoTextarea(textToInsert, storybookTextAreaRef, storybookContent.storyNarrative, setter);
        }
    };

    const handleSpeakerInsert = (speakerName: string, generationId: number, sceneIndex: number) => {
        const generationItem = generationHistory.find(item => item.id === generationId);
        const currentScript = generationItem?.videoStates[sceneIndex]?.scriptPrompt || '';
        const textarea = scriptTextAreaRef.current;
        
        let textToInsert = '';
        if (speakerName === 'Narrator') {
            // User request: "narrator is just the words" -> just ensure clean start or spacing
            textToInsert = '';
        } else {
            // User request: "Example speaker most be Name:"
            textToInsert = `${speakerName}: `;
        }
        
        // Add newline if not at start
        if (textarea && currentScript.length > 0 && textarea.selectionStart > 0 && currentScript[textarea.selectionStart - 1] !== '\n') {
            textToInsert = '\n' + textToInsert;
        }

        const setter = (newValue: string) => handleScriptChange(generationId, sceneIndex, newValue);
        insertTextIntoTextarea(textToInsert, scriptTextAreaRef, currentScript, setter);
    };


    const detectedCharactersInPrompt = useMemo(() => {
        if (!prompt) return [];
        const lowerCasePrompt = prompt.toLowerCase();
        return characters.filter(c => c.name && lowerCasePrompt.includes(c.name.toLowerCase()));
    }, [prompt, characters]);

    const filteredHistory = useMemo(() => {
        if (historyFilter === 'saved') {
            return generationHistory.filter(historyItem => {
                return savedItems.some(savedItem => savedItem.id.startsWith(`${historyItem.id}-`));
            }).sort((a, b) => b.id - a.id);
        }
        return [...generationHistory].sort((a, b) => b.id - a.id);
    }, [generationHistory, savedItems, historyFilter]);

    const selectedCurrencyInfo = CURRENCY_INFO[creditSettings.currency];
    const displayCredit = creditSettings.creditBalance * selectedCurrencyInfo.rate;
    
    const imageModelOptions = [
        { value: 'gemini-2.5-flash-image', label: 'Gemini Flash (Fast)' },
        { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro (High Quality)' },
        { value: 'imagen-4.0-generate-001', label: 'Imagen 4 (Legacy)' },
    ];
    
    const videoModelOptions = [
        { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 (Fast - Recommended)' },
        { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (High Quality)' },
    ];

    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans flex flex-col md:flex-row">
            <aside className="w-full md:w-96 bg-gray-800 p-4 space-y-6 overflow-y-auto shrink-0 border-r border-gray-700/50">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-indigo-400 tracking-tight">Story Weaver</h1>
                     <div className="flex items-center gap-3">
                        <div className="flex items-center gap-3 bg-gray-900/50 px-3 py-1.5 rounded-full border border-gray-700/50">
                            <div className="text-center">
                                <span className="text-[10px] text-gray-400 block leading-none">IMG</span>
                                <span className="text-xs font-bold text-white">{dailyCounts.images}</span>
                            </div>
                            <div className="w-px h-6 bg-gray-700"></div>
                            <div className="text-center">
                                <span className="text-[10px] text-gray-400 block leading-none">VID</span>
                                <span className="text-xs font-bold text-white">{dailyCounts.videos}</span>
                            </div>
                        </div>
                        <div className="relative" ref={creditAdderRef}>
                            <button 
                                onClick={() => setIsCreditAdderOpen(prev => !prev)}
                                className="flex items-center gap-2 bg-gray-900/50 px-3 py-1.5 rounded-full border border-gray-700/50 hover:border-indigo-500 transition-colors"
                                title="Click to add or view credit details"
                            >
                                <CreditCardIcon className={`w-4 h-4 ${displayCredit > 0 ? 'text-green-400' : 'text-yellow-400'}`} />
                                <div className="text-left">
                                     <span className="text-[10px] text-gray-400 block leading-none">CREDIT</span>
                                     <span className="text-xs font-bold text-white">{selectedCurrencyInfo.symbol}{displayCredit.toFixed(2)}</span>
                                </div>
                            </button>
                            {isCreditAdderOpen && (
                                <div className="absolute top-full right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 z-20 animate-in fade-in slide-in-from-top-2">
                                    <h3 className="text-sm font-bold text-gray-300 mb-3">Add Credit</h3>
                                    <div className="flex items-center gap-2 mb-3">
                                         <select
                                            value={creditSettings.currency}
                                            onChange={e => {
                                                const newCurrency = e.target.value as 'USD' | 'SEK';
                                                setCreditSettings(s => ({...s, currency: newCurrency}));
                                                saveCreditSettings({ ...creditSettings, currency: newCurrency });
                                            }}
                                            className="bg-gray-900 border border-gray-600 rounded p-2 text-xs focus:border-indigo-500 h-10"
                                        >
                                            <option value="USD">USD ($)</option>
                                            <option value="SEK">SEK (kr)</option>
                                        </select>
                                        <input
                                            type="number"
                                            value={creditToAdd}
                                            onChange={e => {
                                                const newAmount = Number(e.target.value);
                                                setCreditToAdd(isNaN(newAmount) || newAmount < 0 ? 0 : newAmount);
                                            }}
                                            className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded p-2 text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 h-10"
                                            placeholder="50"
                                        />
                                    </div>
                                    <button
                                        onClick={handleAddCredit}
                                        className="w-full px-3 py-2 bg-indigo-600 text-white font-bold rounded hover:bg-indigo-500 text-sm"
                                    >
                                        Add
                                    </button>
                                     <div className="my-2 border-t border-gray-700/50"></div>
                                     <button
                                         onClick={handleResetCredit}
                                         className="w-full px-3 py-1.5 bg-red-900/50 text-red-300 text-xs font-bold rounded hover:bg-red-800/80 transition-colors"
                                     >
                                         Reset Balance
                                     </button>
                                     <p className="text-[10px] text-gray-600 italic pt-2 text-center">
                                        Costs are estimates. See Google Cloud Console for official billing.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <button 
                    onClick={() => setShowStorybookPanel(true)} 
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-900/50 border border-indigo-500/30 text-indigo-200 font-bold rounded-lg hover:bg-indigo-900 hover:border-indigo-400 transition-all shadow-sm"
                >
                    <BookOpenIcon className="w-5 h-5" />
                    Open Storybook
                </button>

                <button 
                    onClick={() => { setShowHistoryPanel(true); setHistoryFilter('all'); }} 
                    className="w-full flex items-center justify-center gap-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                >
                    <HistoryIcon className="w-4 h-4" /> View History & Saved
                </button>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label htmlFor="prompt" className="text-sm font-bold text-gray-300">Your Story Idea</label>
                         <button 
                            onClick={() => audioFileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 hover:bg-gray-700 rounded text-[10px] font-bold text-indigo-300 border border-indigo-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isProcessingAudio || isGenerationDisabled}
                            title="Upload audio to generate story ideas"
                        >
                            {isProcessingAudio ? <LoaderIcon className="w-3 h-3 animate-spin" /> : <MusicalNoteIcon className="w-3 h-3" />}
                            {isProcessingAudio ? 'Transcribing...' : 'Audio Input'}
                        </button>
                         <input
                            type="file"
                            ref={audioFileInputRef}
                            className="hidden"
                            onChange={handleAudioFileUpload}
                            accept="audio/*"
                            multiple
                        />
                    </div>
                    <div className="relative">
                        <textarea
                            ref={promptTextAreaRef}
                            id="prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="A hero discovers a hidden power..."
                            className="w-full h-32 p-3 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-y placeholder-gray-600"
                            disabled={appStatus.status === 'loading'}
                        />
                         {detectedCharactersInPrompt.length > 0 && (
                            <div className="absolute bottom-2 right-2 flex items-center gap-2 pointer-events-none">
                                {detectedCharactersInPrompt.map(c => c.imagePreview ? (
                                    <img key={c.id} src={c.imagePreview} alt={c.name} className="w-6 h-6 rounded-full border-2 border-indigo-500 object-cover shadow-sm" />
                                ) : null)}
                            </div>
                        )}
                    </div>
                    
                    {audioAssignments.length > 0 && (
                        <div className="space-y-2 mt-2 bg-gray-900/50 p-2 rounded border border-gray-700/50">
                             <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Audio Transcriptions</p>
                                <button onClick={() => setAudioAssignments([])} className="text-[10px] text-gray-500 hover:text-gray-300">Clear All</button>
                             </div>
                             {audioAssignments.map((item, idx) => (
                                 <div key={idx} className="p-2 bg-gray-800 rounded border border-gray-700 flex flex-col gap-1">
                                     <div className="flex justify-between items-center">
                                         <span className="text-xs text-gray-300 font-medium truncate max-w-[150px]">{item.file.name}</span>
                                         <button onClick={() => setAudioAssignments(prev => prev.filter((_, i) => i !== idx))}><XIcon className="w-3 h-3 text-gray-500 hover:text-red-400" /></button>
                                     </div>
                                     <p className="text-[10px] text-gray-500 italic line-clamp-2">"{item.transcription}"</p>
                                     <button onClick={() => applyAudioAsPrompt(item.transcription)} className="self-start text-[10px] text-indigo-400 hover:text-white font-bold flex items-center gap-1 mt-1">
                                        <PlusCircleIcon className="w-3 h-3" /> Add to Story
                                     </button>
                                 </div>
                             ))}
                        </div>
                    )}

                    {renderCharacterInserter('prompt')}
                </div>

                {/* Characters Panel */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-gray-300">Build Characters</h2>
                         <div className="flex gap-2">
                             <button
                                onClick={() => uploadCharacterFileInputRef.current?.click()}
                                className="flex items-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 text-xs font-bold rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={isGenerationDisabled}
                            >
                                <UploadIcon className="w-3 h-3" /> Upload
                            </button>
                         </div>
                         <input
                            type="file"
                            ref={uploadCharacterFileInputRef}
                            className="hidden"
                            onChange={handleUploadNewCharacterImage}
                            accept="image/*"
                        />
                    </div>
                    
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {characters.map((char) => (
                            <div key={char.id} className="flex flex-col gap-2 p-2 bg-gray-900/50 border border-gray-700 rounded-md">
                                <div className="flex items-start gap-2">
                                    <div className="relative w-12 h-16 bg-gray-800 rounded overflow-hidden flex-shrink-0 border border-gray-600 group">
                                        {char.imagePreview ? (
                                            <img 
                                                src={char.imagePreview} 
                                                alt={char.name} 
                                                className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity" 
                                                onClick={() => setZoomedImage(char.imagePreview)}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-600"><UserPlusIcon className="w-5 h-5"/></div>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setUploadingCharId(char.id); characterFileInputRef.current?.click(); }}
                                            className="absolute bottom-0 right-0 p-1 bg-black/60 text-gray-300 hover:text-white rounded-tl hover:bg-black/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Upload Reference Image"
                                            disabled={isGenerationDisabled}
                                        >
                                            <UploadIcon className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <input
                                            type="text"
                                            value={char.name}
                                            onFocus={handleCharacterNameFocus}
                                            onChange={(e) => updateCharacter(char.id, { name: e.target.value })}
                                            className="w-full bg-transparent text-xs font-bold text-gray-200 focus:outline-none border-b border-transparent focus:border-indigo-500 mb-1"
                                            placeholder="Name"
                                        />
                                        <textarea
                                            value={char.description || ''}
                                            onChange={(e) => updateCharacter(char.id, { description: e.target.value })}
                                            className="w-full bg-transparent text-[10px] text-gray-400 focus:outline-none border border-transparent focus:border-gray-600 resize-none h-12 rounded"
                                            placeholder={char.isDescribing ? "Analyzing..." : "Description..."}
                                            disabled={char.isDescribing}
                                        />
                                    </div>
                                    <button onClick={() => removeCharacter(char.id)} className="text-gray-600 hover:text-red-500 self-start">
                                        <XIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                <button 
                                    onClick={() => handleBuildCharacterVisual(char.id)}
                                    disabled={char.isDescribing || (!char.description?.trim() && !char.originalImageBase64) || isGenerationDisabled}
                                    className={`w-full py-1.5 border rounded text-[10px] font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed
                                        ${char.imagePreview 
                                            ? 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600 hover:text-white' 
                                            : 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-600 hover:text-white'
                                        }`}
                                >
                                    {char.isDescribing ? <LoaderIcon className="w-3 h-3 animate-spin"/> : (char.imagePreview ? <RefreshIcon className="w-3 h-3" /> : <SparklesIcon className="w-3 h-3" />)}
                                    {char.imagePreview ? "Regenerate Visual" : "Build Character Visual"}
                                </button>
                            </div>
                        ))}
                        {characters.length === 0 && (
                            <p className="text-center text-xs text-gray-500 py-2 italic">No characters added yet.</p>
                        )}
                        <button onClick={() => {
                            const newId = nextCharId;
                            setCharacters([...characters, { id: newId, name: `Character ${newId}`, imagePreview: null, originalImageBase64: null, originalImageMimeType: null, description: '', detectedImageStyle: null, isDescribing: false }]);
                            setNextCharId(newId + 1);
                        }} className="w-full py-2 border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 rounded text-xs">
                            + Add Empty Character Slot
                        </button>
                    </div>
                    <input
                        type="file"
                        ref={characterFileInputRef}
                        className="hidden"
                        onChange={(e) => {
                            if (uploadingCharId !== null) {
                                handleCharacterImageUpload(e, uploadingCharId);
                                setUploadingCharId(null);
                            }
                        }}
                        accept="image/*"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Scenes</label>
                        <input
                            type="number"
                            value={imageCount}
                            onChange={(e) => setImageCount(parseInt(e.target.value, 10))}
                            className="w-full p-2 bg-gray-900 border border-gray-700 rounded focus:border-indigo-500"
                            min="1"
                            max="10"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ratio</label>
                        <select
                            value={aspectRatio}
                            onChange={(e) => setAspectRatio(e.target.value)}
                            className="w-full p-2 bg-gray-900 border border-gray-700 rounded focus:border-indigo-500"
                        >
                            <option>16:9</option>
                            <option>9:16</option>
                            <option>4:3</option>
                            <option>3:4</option>
                            <option>1:1</option>
                        </select>
                    </div>
                    <div className="space-y-1 col-span-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Style</label>
                        <select
                            value={imageStyle}
                            onChange={(e) => setImageStyle(e.target.value)}
                            className="w-full p-2 bg-gray-900 border border-gray-700 rounded focus:border-indigo-500"
                        >
                            <option>Afro-toon</option>
                            <option>Illustration</option>
                            <option>3D Render</option>
                            <option>Realistic Photo</option>
                            <option>Oil Painting</option>
                            <option>Pixel Art</option>
                            <option>2D Flat</option>
                            <option>Anime</option>
                            <option>Video Game</option>
                            <option>Watercolor</option>
                            <option>Cyberpunk</option>
                        </select>
                    </div>
                     <div className="space-y-1 col-span-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Image Model</label>
                        <select
                            value={imageModel}
                            onChange={(e) => setImageModel(e.target.value)}
                            className="w-full p-2 bg-gray-900 border border-gray-700 rounded focus:border-indigo-500"
                        >
                            <option value="gemini-2.5-flash-image">Gemini Flash (Fast)</option>
                            <option value="gemini-3-pro-image-preview">Nano Banana Pro (High Quality)</option>
                            <option value="imagen-4.0-generate-001">Imagen 4 (Legacy)</option>
                        </select>
                    </div>
                     <div className="space-y-1 col-span-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Video Model</label>
                        <select
                            value={videoModel}
                            onChange={(e) => setVideoModel(e.target.value)}
                            className="w-full p-2 bg-gray-900 border border-gray-700 rounded focus:border-indigo-500"
                        >
                            <option value="veo-3.1-fast-generate-preview">Veo 3.1 (Fast - Recommended)</option>
                            <option value="veo-3.1-generate-preview">Veo 3.1 (High Quality)</option>
                        </select>
                    </div>
                    <div className="space-y-1 col-span-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Genre</label>
                        <select
                            value={genre}
                            onChange={(e) => setGenre(e.target.value)}
                            className="w-full p-2 bg-gray-900 border border-gray-700 rounded focus:border-indigo-500"
                        >
                            <option>General</option>
                            <option>Sci-Fi</option>
                            <option>Fantasy</option>
                            <option>Horror</option>
                            <option>Comedy</option>
                            <option>Romance</option>
                            <option>Mystery</option>
                        </select>
                    </div>
                </div>
                
                {appStatus.status === 'loading' ? (
                    <button
                        onClick={handleStopGeneration}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500 transition-all shadow-md"
                    >
                         <StopIcon className="w-5 h-5" />
                        <span>Stop Generating</span>
                    </button>
                ) : (
                    <button
                        onClick={handleGenerate}
                        disabled={!prompt.trim() || isGenerationDisabled}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all shadow-md"
                    >
                        <SparklesIcon className="w-5 h-5" />
                        <span>Generate Scenes</span>
                    </button>
                )}

                {appStatus.status === 'loading' && statusMessage && (
                    <div className="flex items-center justify-center gap-2 text-indigo-400 text-sm">
                        <LoaderIcon className="w-4 h-4 animate-spin" />
                        <span>{statusMessage}</span>
                    </div>
                )}

                {appStatus.error && (
                    <div className="p-3 bg-red-900/30 border border-red-800 text-red-300 text-xs rounded">
                        <p className="font-bold mb-1">Error</p>
                        <p>{appStatus.error}</p>
                    </div>
                )}
            </aside>

            <main className="flex-1 p-4 md:p-6 relative bg-gray-900 flex flex-col min-h-0">
                {isGenerationDisabled && (
                    <div className="mb-4 p-3 bg-yellow-900/50 border border-yellow-800 text-yellow-300 text-sm rounded flex items-center justify-center gap-3 animate-in fade-in">
                        <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 shrink-0" />
                        <span className="font-bold">Generation Disabled:</span>
                        <span>Please add credit in the sidebar to enable creating new content.</span>
                    </div>
                )}
                {!currentGenerationItem && uploadedItems.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500">
                        <div className="p-6 bg-gray-800 rounded-full mb-4">
                             <SparklesIcon className="w-12 h-12 text-indigo-500" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-300">Start Creating</h2>
                        <p className="max-w-sm mt-2 text-sm">Use the sidebar to describe your scenes, add characters, or ask AI for a story idea.</p>
                        
                        <div className="my-6 w-full max-w-xs flex items-center justify-center gap-4">
                            <div className="h-px flex-1 bg-gray-700"></div>
                            <span className="text-xs font-semibold text-gray-600 uppercase">OR</span>
                            <div className="h-px flex-1 bg-gray-700"></div>
                        </div>
                
                        <button
                            onClick={() => initialUploadFileInputRef.current?.click()}
                            className="flex items-center justify-center gap-2 py-3 px-6 bg-gray-700/50 border border-gray-600 text-gray-300 font-bold rounded-lg hover:bg-gray-700 hover:border-gray-500 transition-all shadow-sm"
                        >
                            <UploadIcon className="w-5 h-5" />
                            Upload Image to Animate
                        </button>
                        <input
                            type="file"
                            ref={initialUploadFileInputRef}
                            className="hidden"
                            onChange={handleInitialImageUpload}
                            accept="image/*"
                        />
                    </div>
                )}

                {(currentGenerationItem || uploadedItems.length > 0) && (
                     <div className="flex flex-col h-full">
                        {currentGenerationItem && (
                            <div className="mb-4 flex items-start justify-between shrink-0">
                                <div>
                                    <h2 className="text-lg font-bold text-white">Storyboard</h2>
                                    <p className="text-xs text-gray-400 mt-1 max-w-md truncate">{currentGenerationItem.prompt}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                     {generationHistory.length > 1 && (
                                        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
                                            <button onClick={() => handleHistoryNavigation(activeHistoryIndex - 1)} disabled={activeHistoryIndex === 0} className="p-1 hover:text-white disabled:opacity-30"><ChevronLeftIcon className="w-4 h-4" /></button>
                                            <span className="text-xs font-mono text-gray-400 px-2">{activeHistoryIndex + 1}/{generationHistory.length}</span>
                                            <button onClick={() => handleHistoryNavigation(activeHistoryIndex + 1)} disabled={activeHistoryIndex === generationHistory.length - 1} className="p-1 hover:text-white disabled:opacity-30"><ChevronRightIcon className="w-4 h-4" /></button>
                                        </div>
                                    )}
                                    <button onClick={() => handleRemoveHistoryItem(currentGenerationItem.id)} className="p-2 text-gray-500 hover:text-red-500"><TrashIcon className="w-5 h-5" /></button>
                                </div>
                            </div>
                        )}
                        
                        <div className="flex-1 overflow-y-auto pr-2 space-y-8">
                            {uploadedItems.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Uploads</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {uploadedItems.map((item) => (
                                            <div key={item.id} className="relative group rounded-lg overflow-hidden">
                                                <img 
                                                    src={`data:${item.mimeType};base64,${item.generationItem.imageSet[0].src}`} 
                                                    alt={item.generationItem.prompt} 
                                                    className="w-full h-auto object-cover"
                                                />
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                                    <button onClick={() => addUploadedToStoryboard(item)} className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded">Add to Storyboard</button>
                                                    <button onClick={() => setUploadedItems(prev => prev.filter(up => up.id !== item.id))} className="p-2 text-gray-300 hover:text-red-500"><TrashIcon className="w-4 h-4" /></button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6 pb-10">
                                {currentGenerationItem?.imageSet.map((scene, index) => {
                                    const isLoading = scene.isGenerating || scene.isRegenerating || scene.isGeneratingAngles;
                                    const isSaved = savedItems.some(i => i.id === `${currentGenerationItem.id}-${index}`);
                                    return (
                                        <div key={index} className={`bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col ${scene.isCameraAngleFor !== undefined ? 'border-l-4 border-indigo-500' : ''}`}>
                                            <div className="relative aspect-video bg-black/40 flex items-center justify-center">
                                                {isLoading ? (
                                                    <div className="text-center">
                                                        <LoaderIcon className="w-8 h-8 mx-auto animate-spin text-indigo-500" />
                                                        <p className="text-xs mt-2 text-gray-400">{scene.isGenerating ? 'Generating...' : 'Processing...'}</p>
                                                    </div>
                                                ) : scene.src ? (
                                                    <img src={`data:image/png;base64,${scene.src}`} alt={scene.prompt} className="w-full h-full object-contain" />
                                                ) : (
                                                    <div className="text-center p-4 text-red-400">
                                                        <XCircleIcon className="w-8 h-8 mx-auto mb-2" />
                                                        <p className="text-xs">{scene.error || (scene.error === 'Stopped.' ? 'Stopped' : 'Failed')}</p>
                                                    </div>
                                                )}
                                                 <div className="absolute top-2 right-2">
                                                    {scene.src && (
                                                        <a href={`data:image/png;base64,${scene.src}`} download={`scene_${index + 1}.png`} className="p-1 bg-black/50 text-white rounded hover:bg-indigo-600"><DownloadIcon className="w-4 h-4" /></a>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            <div className="p-3 flex-1 flex flex-col">
                                                <div className="flex items-start justify-between gap-2 mb-3">
                                                    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-[10px] font-bold rounded uppercase">
                                                        {scene.angleName ? scene.angleName : `Scene ${index + 1}`}
                                                    </span>
                                                    <div className="flex gap-1">
                                                        {scene.src && !scene.isRegenerating && (
                                                            <>
                                                                <button onClick={() => saveScene(currentGenerationItem.id, index)} className={`p-1.5 rounded hover:bg-gray-600 ${isSaved ? 'text-indigo-400' : 'text-gray-400'}`} title={isSaved ? 'Unsave' : 'Save'}><BookmarkIcon className="w-4 h-4" solid={isSaved} /></button>
                                                                <button onClick={() => openAngleSelectionModal(currentGenerationItem.id, index)} disabled={isGenerationDisabled} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed" title="More Angles"><CameraIcon className="w-4 h-4" /></button>
                                                                <button onClick={() => startEditing(currentGenerationItem.id, index)} disabled={isGenerationDisabled} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed" title="Edit Image"><SparklesIcon className="w-4 h-4" /></button>
                                                            </>
                                                        )}
                                                        <button onClick={() => openConfirmationModal('image', currentGenerationItem.id, index)} disabled={isGenerationDisabled} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed" title="Regenerate"><RefreshIcon className="w-4 h-4" /></button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-gray-400 line-clamp-2 mb-3" title={scene.prompt}>{scene.prompt}</p>
                                                
                                                {scene.src && !scene.isRegenerating && (
                                                    <button 
                                                        onClick={() => openVideoCreator(index)} 
                                                        className={`w-full mt-auto flex items-center justify-center gap-2 py-2 px-3 rounded text-xs font-bold transition-colors ${activeVideoIndex === index ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                                                    >
                                                        <VideoIcon className="w-4 h-4" />
                                                        {activeVideoIndex === index ? 'Close Video Creator' : 'Create Video'}
                                                    </button>
                                                )}

                                                {activeVideoIndex === index && (
                                                    <div className="mt-3 pt-3 border-t border-gray-700 space-y-3 animate-in fade-in slide-in-from-top-2">
                                                        <div className="flex items-center justify-between">
                                                             <div className="flex gap-1 text-[10px] font-bold">
                                                                <button onClick={() => handleVoiceoverModeChange(currentGenerationItem.id, index, 'tts')} className={`px-2 py-1 rounded ${currentGenerationItem.videoStates[index].voiceoverMode === 'tts' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'}`}>TTS</button>
                                                                <button onClick={() => handleVoiceoverModeChange(currentGenerationItem.id, index, 'upload')} className={`px-2 py-1 rounded ${currentGenerationItem.videoStates[index].voiceoverMode === 'upload' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'}`}>Upload Audio</button>
                                                             </div>
                                                             <button 
                                                                onClick={() => handleImportNarrativeToVideo(currentGenerationItem.id, index)}
                                                                className="flex items-center gap-1 px-2 py-1 bg-indigo-600/20 text-indigo-300 rounded border border-indigo-500/30 text-[10px] font-bold hover:bg-indigo-600/40 transition-colors"
                                                                title="Import narration text from the corresponding Storybook scene"
                                                             >
                                                                <BookOpenIcon className="w-3 h-3" /> Import Script
                                                             </button>
                                                        </div>

                                                        {currentGenerationItem.videoStates[index].voiceoverMode === 'tts' ? (
                                                            <div className="space-y-2">
                                                                <textarea
                                                                    ref={scriptTextAreaRef}
                                                                    value={currentGenerationItem.videoStates[index].scriptPrompt}
                                                                    onChange={(e) => handleScriptChange(currentGenerationItem.id, index, e.target.value)}
                                                                    placeholder="Narrative or dialogue..."
                                                                    className="w-full h-20 p-2 bg-gray-900 border border-gray-700 rounded text-xs resize-none focus:border-indigo-500"
                                                                />
                                                                <div className="flex flex-wrap gap-1">
                                                                    <p className="text-[10px] text-gray-500 w-full">Insert Speaker:</p>
                                                                    <button 
                                                                        onClick={() => handleSpeakerInsert('Narrator', currentGenerationItem.id, index)} 
                                                                        className={`px-2 py-0.5 text-[10px] rounded ${currentGenerationItem.videoStates[index].speaker === 'Narrator' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                                                                    >
                                                                        Narrator
                                                                    </button>
                                                                    {characters.map(c => (
                                                                        <button 
                                                                            key={c.id} 
                                                                            onClick={() => handleSpeakerInsert(c.name, currentGenerationItem.id, index)} 
                                                                            className={`px-2 py-0.5 text-[10px] rounded ${currentGenerationItem.videoStates[index].speaker === c.name ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                                                                        >
                                                                            {c.name}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                             <input type="file" accept="audio/*" onChange={(e) => handleVoiceoverFileChange(currentGenerationItem.id, index, e.target.files?.[0] || null)} className="w-full text-xs text-gray-400" />
                                                        )}
                                                        
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Movement</span>
                                                            <div className="relative">
                                                                <button onClick={() => toggleCameraMovement(currentGenerationItem.id, index)} className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300">{currentGenerationItem.videoStates[index].cameraMovement}</button>
                                                                {currentGenerationItem.videoStates[index].isCameraMovementOpen && (
                                                                    <div className="absolute bottom-full right-0 mb-1 w-40 bg-gray-800 border border-gray-700 rounded shadow-xl max-h-32 overflow-y-auto z-10">
                                                                        {Object.keys(CAMERA_MOVEMENT_PROMPTS).map(move => (
                                                                            <button key={move} onClick={() => handleCameraMovementChange(currentGenerationItem.id, index, move)} className="block w-full text-left px-2 py-1.5 text-[10px] hover:bg-gray-700 text-gray-300 border-b border-gray-700/50 last:border-0">{move}</button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {currentGenerationItem.videoStates[index].status === 'loading' ? (
                                                            <button
                                                                onClick={handleStopGeneration}
                                                                className="w-full py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded"
                                                            >
                                                                Stop Generation
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => openConfirmationModal('video', currentGenerationItem.id, index)}
                                                                disabled={currentGenerationItem.videoStates[index].status === 'loading' || isGenerationDisabled}
                                                                className="w-full py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded disabled:bg-gray-600 disabled:cursor-not-allowed"
                                                            >
                                                                Generate Clip
                                                            </button>
                                                        )}
                                                        {currentGenerationItem.videoStates[index].status === 'loading' && <p className="text-[10px] text-center text-indigo-400 animate-pulse">{currentGenerationItem.videoStates[index].loadingMessage}</p>}
                                                        {currentGenerationItem.videoStates[index].status === 'error' && <p className="text-[10px] text-center text-red-400">{currentGenerationItem.videoStates[index].error}</p>}

                                                        {currentGenerationItem.videoStates[index].clips.length > 0 && (
                                                             <div className="pt-2 border-t border-gray-700">
                                                                <video 
                                                                    src={currentGenerationItem.videoStates[index].clips[currentGenerationItem.videoStates[index].currentClipIndex]?.videoUrl || ''} 
                                                                    controls 
                                                                    className="w-full rounded mb-2"
                                                                />
                                                                <div className="flex justify-between items-center mb-2">
                                                                    <button onClick={() => handleVideoClipNavigation(currentGenerationItem.id, index, 'prev')} disabled={currentGenerationItem.videoStates[index].currentClipIndex === 0} className="text-gray-400 hover:text-white disabled:opacity-30"><ChevronLeftIcon className="w-4 h-4"/></button>
                                                                    <span className="text-[10px] text-gray-500">Clip {currentGenerationItem.videoStates[index].currentClipIndex + 1}/{currentGenerationItem.videoStates[index].clips.length}</span>
                                                                    <button onClick={() => handleVideoClipNavigation(currentGenerationItem.id, index, 'next')} disabled={currentGenerationItem.videoStates[index].currentClipIndex === currentGenerationItem.videoStates[index].clips.length - 1} className="text-gray-400 hover:text-white disabled:opacity-30"><ChevronRightIcon className="w-4 h-4"/></button>
                                                                </div>
                                                                {currentGenerationItem.videoStates[index].currentClipIndex === currentGenerationItem.videoStates[index].clips.length - 1 && (
                                                                     <button onClick={() => openConfirmationModal('video', currentGenerationItem.id, index, true)} disabled={currentGenerationItem.videoStates[index].status === 'loading' || isGenerationDisabled} className="w-full py-1.5 bg-teal-700 hover:bg-teal-600 text-white text-[10px] font-bold rounded disabled:opacity-50 disabled:cursor-not-allowed">Extend Clip ( +4s )</button>
                                                                )}
                                                             </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {editingScene && (
                <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={cancelEditing}>
                    <div className="bg-gray-800 rounded-lg w-full max-w-4xl flex flex-col md:flex-row overflow-hidden shadow-2xl h-[90vh] md:h-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex-1 bg-black flex items-center justify-center min-h-[300px] overflow-hidden relative">
                             {editingScene.isRegenerating ? (
                                <div className="text-center text-indigo-400">
                                    <LoaderIcon className="w-10 h-10 mx-auto animate-spin mb-2" />
                                    <span>Applying Edits...</span>
                                </div>
                             ) : (
                                <div className="relative">
                                    <img src={`data:image/png;base64,${editingScene.src}`} className="max-w-full max-h-[70vh] object-contain pointer-events-none" alt="Scene to edit" />
                                    <canvas
                                        ref={canvasRef}
                                        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                                        onMouseDown={startDrawing}
                                        onMouseMove={draw}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                        onTouchStart={startDrawing}
                                        onTouchMove={draw}
                                        onTouchEnd={stopDrawing}
                                    />
                                </div>
                             )}
                        </div>
                        <div className="w-full md:w-80 p-4 flex flex-col border-l border-gray-700 bg-gray-800">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-gray-200">Edit Image</h3>
                                <button onClick={saveAndCloseEditing}><XIcon className="w-5 h-5 text-gray-500 hover:text-white" /></button>
                            </div>
                            
                            <div className="mb-4">
                                 <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Instructions</label>
                                    <div className="flex items-center gap-1">
                                        <button onClick={handleUndoEdit} disabled={editingScene.editHistoryIndex <= 0} className="p-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors" title="Undo"><UndoIcon className="w-4 h-4" /></button>
                                        <button onClick={handleRedoEdit} disabled={editingScene.editHistoryIndex >= editingScene.editHistory.length - 1} className="p-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors" title="Redo"><RedoIcon className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <textarea
                                    ref={editPromptTextAreaRef}
                                    value={editingScene.editPrompt}
                                    onChange={(e) => setEditingScene({ ...editingScene, editPrompt: e.target.value })}
                                    placeholder={
                                        editingScene.overlayImage
                                            ? "Describe how to place the uploaded object..."
                                            : drawingMode === 'remove'
                                                ? "Describe what to remove (optional)..."
                                                : "Describe changes or what to generate in green areas..."
                                    }
                                    className="w-full h-24 p-2 bg-gray-900 border border-gray-700 rounded text-sm mb-2 resize-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Paint Tools</label>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => overlayImageInputRef.current?.click()}
                                            className="flex items-center gap-1 px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold text-gray-300 border border-gray-600/50 transition-colors"
                                            title="Upload image to composite"
                                        >
                                            <UploadIcon className="w-3 h-3" /> Upload
                                        </button>
                                        <input type="file" ref={overlayImageInputRef} className="hidden" onChange={handleOverlayImageUpload} accept="image/*" />

                                        {hasDrawn && (
                                            <button
                                                onClick={clearCanvas}
                                                className="flex items-center gap-1 px-2 py-0.5 bg-gray-700/50 hover:bg-gray-700 rounded text-[10px] font-bold text-gray-400 border border-gray-600/50 transition-colors"
                                                title="Clear all paint from the canvas"
                                            >
                                                <RefreshIcon className="w-3 h-3" /> Clear
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-1 bg-gray-900 p-1 rounded-lg border border-gray-700 h-9">
                                    <button
                                        onClick={() => setDrawingMode('remove')}
                                        className={`flex-1 flex flex-row items-center justify-center gap-1.5 rounded-md transition-all ${
                                            drawingMode === 'remove' 
                                            ? 'bg-red-900/40 text-red-400 ring-1 ring-red-500' 
                                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                                        }`}
                                        title="Paint Red to Remove"
                                    >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                        <span className="text-[9px] font-bold uppercase">REMOVE</span>
                                    </button>
                                    
                                    <button
                                        onClick={() => setDrawingMode('add')}
                                        className={`flex-1 flex flex-row items-center justify-center gap-1.5 rounded-md transition-all ${
                                            drawingMode === 'add' 
                                            ? 'bg-green-900/40 text-green-400 ring-1 ring-green-500' 
                                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                                        }`}
                                        title="Paint Green to Add / Lasso Fill"
                                    >
                                        <PlusCircleIcon className="w-3.5 h-3.5" />
                                        <span className="text-[9px] font-bold uppercase">ADD</span>
                                    </button>

                                    <button
                                        onClick={() => setDrawingMode('none')}
                                        className={`flex-1 flex flex-row items-center justify-center gap-1.5 rounded-md transition-all ${
                                            drawingMode === 'none' 
                                            ? 'bg-gray-700 text-white ring-1 ring-gray-500' 
                                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                                        }`}
                                        title="Stop Painting"
                                    >
                                        <StopIcon className="w-3.5 h-3.5" />
                                        <span className="text-[9px] font-bold uppercase">VIEW</span>
                                    </button>
                                </div>
                            </div>
                            
                            {editingScene.overlayImage && (
                                <div className="mb-4">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Uploaded Object</label>
                                    <div className="relative w-24 h-24 bg-gray-900 rounded-md overflow-hidden p-1 border border-gray-700">
                                        <img src={`data:${editingScene.overlayImage.mimeType};base64,${editingScene.overlayImage.base64}`} alt="Uploaded object" className="w-full h-full object-contain" />
                                        <button onClick={() => setEditingScene(prev => prev ? { ...prev, overlayImage: null } : null)} className="absolute top-0 right-0 p-0.5 bg-black/60 text-white rounded-bl-md hover:bg-red-600 transition-colors">
                                            <XIcon className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {renderCharacterInserter('edit')}
                            
                            <div className="mt-auto pt-4 flex flex-col gap-2">
                                {editingScene.isRegenerating ? (
                                    <button
                                        onClick={handleStopGeneration}
                                        className="w-full py-3 bg-red-600 text-white font-bold rounded hover:bg-red-500 shadow-lg"
                                    >
                                        Stop
                                    </button>
                                ) : (
                                    <button
                                        onClick={generateEditVariation}
                                        disabled={(!editingScene.editPrompt.trim() && !hasDrawn && !editingScene.overlayImage) || isGenerationDisabled}
                                        className="w-full py-3 bg-indigo-600 text-white font-bold rounded hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-2"
                                    >
                                        <SparklesIcon className="w-4 h-4" />
                                        Apply Edit
                                    </button>
                                )}
                                <div className="flex justify-around items-center">
                                    <button onClick={cancelEditing} className="px-4 py-2 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors">Cancel</button>
                                    <button onClick={saveAndCloseEditing} className="px-4 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-500 rounded transition-colors">Save & Close</button>
                                </div>

                                {editingScene.error && <p className="mt-2 text-xs text-red-400 bg-red-900/20 p-2 rounded">{editingScene.error}</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {isAngleModalOpen && angleSelectionTarget && (
                <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setIsAngleModalOpen(false)}>
                    <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-gray-700 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        
                        {/* Header */}
                        <div className="p-6 border-b border-gray-800 bg-gray-900 flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <CameraIcon className="w-6 h-6 text-indigo-500" />
                                    Select Camera Angle
                                </h3>
                                <p className="text-sm text-gray-400 mt-1">Choose an alternative perspective to generate for this scene.</p>
                            </div>
                            <button onClick={() => setIsAngleModalOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                                <XIcon className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto bg-gray-900/50">
                             <div className="mb-4">
                                <div className="flex justify-between items-center">
                                    <label htmlFor="focus-subject" className="text-xs font-bold text-gray-400 uppercase tracking-wider">Focus Subject</label>
                                    <button onClick={handleSyncCharactersForAngleModal} className="text-indigo-400 hover:text-indigo-300 text-[10px] font-bold flex items-center gap-1">
                                        <RefreshIcon className="w-3 h-3" /> Sync from Sidebar
                                    </button>
                                </div>
                                <select
                                    id="focus-subject"
                                    value={focusSubject}
                                    onChange={(e) => setFocusSubject(e.target.value)}
                                    className="w-full mt-1 p-2 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                                >
                                    <option value="General Scene">General Scene</option>
                                    {charactersForAngleModal.map(char => (
                                        <option key={char.id} value={char.name}>{char.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4 mt-4">
                                {CAMERA_ANGLE_OPTIONS.map((angle) => {
                                    const isSelected = selectedAngle === angle.key;
                                    return (
                                        <div 
                                            key={angle.key} 
                                            onClick={() => handleAngleSelection(angle.key)}
                                            className={`
                                                relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 group flex flex-col gap-2
                                                ${isSelected 
                                                    ? 'bg-indigo-900/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.15)]' 
                                                    : 'bg-gray-800 border-gray-700 hover:border-gray-600 hover:bg-gray-750'}
                                            `}
                                        >
                                            <div className="flex justify-between items-start">
                                                <span className={`font-bold text-sm ${isSelected ? 'text-indigo-300' : 'text-gray-200'}`}>{angle.name}</span>
                                                <div className={`
                                                    w-5 h-5 rounded-full border flex items-center justify-center transition-colors
                                                    ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-600 bg-gray-900'}
                                                `}>
                                                    {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white" />}
                                                </div>
                                            </div>
                                            <p className={`text-xs leading-relaxed ${isSelected ? 'text-indigo-200/70' : 'text-gray-500 group-hover:text-gray-400'}`}>
                                                {angle.description}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-5 border-t border-gray-800 bg-gray-900 flex justify-end gap-3 shrink-0">
                            <button 
                                onClick={() => setIsAngleModalOpen(false)} 
                                className="px-5 py-2.5 rounded-lg text-gray-400 font-bold hover:bg-gray-800 transition-colors text-sm"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleGenerateCameraAngles} 
                                disabled={!selectedAngle || isGenerationDisabled}
                                className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-900/20 flex items-center gap-2"
                            >
                                <SparklesIcon className="w-4 h-4" />
                                <span>Generate Shot</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {generationModalState.isOpen && (() => {
                const isBatchGeneration = generationModalState.target.generationId === -1;
                const options = generationModalState.type === 'image' ? imageModelOptions : videoModelOptions;
                const costPerUnit = COST_MAP[generationModalState.model] || 0;
                const totalCost = isBatchGeneration ? costPerUnit * imageCount : costPerUnit;
                const displayCost = totalCost * selectedCurrencyInfo.rate;
                const title = isBatchGeneration ? `Generate ${imageCount} Scene${imageCount > 1 ? 's' : ''}` : (generationModalState.type === 'image' ? 'Regenerate Image' : (generationModalState.target.extend ? 'Extend Video Clip' : 'Generate Video Clip'));
                const costLabel = isBatchGeneration ? `Total Est. Cost (${imageCount}x):` : 'Estimated Cost:';

                return (
                    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-2xl border border-gray-700 animate-in fade-in zoom-in-95">
                            <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Model</label>
                                    <select
                                        value={generationModalState.model}
                                        onChange={(e) => setGenerationModalState(s => ({ ...s, model: e.target.value }))}
                                        className="w-full mt-1 p-2 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                                    >
                                        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                </div>
                                <div className="text-sm text-gray-400 flex justify-between items-center bg-gray-900/50 p-3 rounded-lg">
                                    <span>{costLabel}</span>
                                    <span className="font-bold text-white">{selectedCurrencyInfo.symbol}{displayCost.toFixed(4)}</span>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => setGenerationModalState({ ...generationModalState, isOpen: false })}
                                    className="px-4 py-2 rounded-lg text-gray-300 font-bold bg-gray-700 hover:bg-gray-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        generationModalState.onConfirm(generationModalState.model);
                                        setGenerationModalState({ ...generationModalState, isOpen: false });
                                    }}
                                    className="px-4 py-2 rounded-lg text-white font-bold bg-indigo-600 hover:bg-indigo-500 transition-colors"
                                >
                                    Confirm & Generate
                                </button>
                            </div>
                        </div>
                    </div>
                )
            })()}

            {[
                { 
                    show: showStorybookPanel, 
                    setter: setShowStorybookPanel, 
                    title: 'Storybook', 
                    content: (
                        <div className="flex flex-col flex-1 min-h-0">
                            {/* This is the panel's content area */}
                            <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                                <div className="flex justify-center pt-4">
                                    <input
                                        type="text"
                                        value={storybookContent.title}
                                        onChange={(e) => handleStorybookChange('title', e.target.value)}
                                        placeholder="Enter Story Title..."
                                        className="bg-transparent text-xl font-bold text-center text-white placeholder-gray-600 focus:outline-none border-b border-transparent focus:border-indigo-500 pb-1 w-2/3"
                                    />
                                </div>
                                
                                <div className="px-4 mb-4">
                                     <div className="flex flex-wrap justify-center gap-2 w-full max-w-2xl mx-auto py-2">
                                        {storybookContent.characters.length > 0 ? storybookContent.characters.map((c, i) => (
                                            <span key={i} className="px-2 py-1 bg-gray-700 text-gray-200 text-xs rounded">{c}</span>
                                        )) : <span className="text-gray-600 text-xs italic self-center">No characters synced yet.</span>}
                                    </div>
                                    <div className="flex items-center justify-center gap-4 w-full mt-2">
                                        <h3 className="text-sm font-bold text-gray-400">Characters in Story</h3>
                                        <button onClick={handleSyncCharacters} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold flex items-center gap-1">
                                            <RefreshIcon className="w-3 h-3" /> Sync from Sidebar
                                        </button>
                                    </div>
                                </div>

                                <div className="px-4 mb-4">
                                    <div className="flex justify-center mb-2">
                                        <div className="flex items-center gap-4 bg-gray-900/50 p-2 rounded-full border border-gray-700/50">
                                             <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-white transition-colors px-2">
                                                <input type="checkbox" checked={isAiStoryHelpMode ? wantsDialogue : wantsDialogueForAnalysis} onChange={(e) => isAiStoryHelpMode ? setWantsDialogue(e.target.checked) : setWantsDialogueForAnalysis(e.target.checked)} className="rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900" />
                                                AI Prioritize Dialogue
                                            </label>
                                            <div className="w-px h-4 bg-gray-700"></div>
                                            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-white transition-colors px-2">
                                                <input type="checkbox" checked={isAiStoryHelpMode} onChange={(e) => setIsAiStoryHelpMode(e.target.checked)} className="rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900" />
                                                Use AI Help
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-sm font-bold text-gray-400">Story Narrative</label>
                                        <button onClick={() => handleCopyToClipboard(storybookContent.storyNarrative, 'storybook-narrative')} className="text-gray-500 hover:text-green-400 transition-colors" title="Copy Narrative">
                                            {copiedId === 'storybook-narrative' ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ClipboardIcon className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    
                                    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 shadow-inner">
                                        <textarea
                                            ref={isAiStoryHelpMode ? storybookAiPromptTextAreaRef : storybookTextAreaRef}
                                            value={isAiStoryHelpMode ? storybookAiPrompt : storybookContent.storyNarrative}
                                            onChange={(e) => isAiStoryHelpMode ? setStorybookAiPrompt(e.target.value) : handleStorybookChange('storyNarrative', e.target.value)}
                                            placeholder={isAiStoryHelpMode ? "Describe your story idea roughly..." : "Write your full story here..."}
                                            className="w-full h-32 p-3 bg-gray-800 border border-gray-600 rounded text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 mb-2 transition-all"
                                        />
                                        {storybookContent.characters.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-2 mt-2 pb-2 border-b border-gray-700/50">
                                                <p className="text-xs text-gray-400 font-semibold mr-2 uppercase tracking-wider">Quick Add:</p>
                                                {storybookContent.characters.map((name, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => handleStorybookCharacterInsert(name)}
                                                        className="px-2 py-1 bg-indigo-600/80 text-white text-xs font-bold rounded hover:bg-indigo-500 transition-colors shadow-sm border border-indigo-500/30"
                                                        aria-label={`Add character ${name}`}
                                                    >
                                                        {name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {/* Narrative Controls: Audio Generator & AI Helper Buttons */}
                                        <div className="flex flex-col gap-3 mt-3">
                                            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-between gap-2">
                                                {!isAiStoryHelpMode && (
                                                    <div className="flex flex-col sm:flex-row items-center gap-2 bg-gray-800 p-1.5 rounded border border-gray-700 w-full sm:w-auto">
                                                        <select 
                                                            value={storybookContent.selectedNarrativeVoice} 
                                                            onChange={(e) => handleStorybookChange('selectedNarrativeVoice', e.target.value)}
                                                            className="bg-gray-900 text-xs p-1 rounded border border-gray-600 focus:border-indigo-500 w-full sm:w-auto"
                                                        >
                                                            {PREBUILT_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                                                        </select>
                                                        <select 
                                                            value={storybookContent.selectedNarrativeExpression} 
                                                            onChange={(e) => handleStorybookChange('selectedNarrativeExpression', e.target.value)}
                                                            className="bg-gray-900 text-xs p-1 rounded border border-gray-600 focus:border-indigo-500 w-full sm:w-auto"
                                                        >
                                                            {VOICE_EXPRESSIONS.map(e => <option key={e} value={e}>{e}</option>)}
                                                        </select>
                                                        <select 
                                                            value={storybookContent.selectedNarrativeAccent || 'Global (Neutral)'} 
                                                            onChange={(e) => handleStorybookChange('selectedNarrativeAccent', e.target.value)}
                                                            className="bg-gray-900 text-xs p-1 rounded border border-gray-600 focus:border-indigo-500 w-full sm:w-auto"
                                                        >
                                                            {ACCENT_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                                                        </select>
                                                        <button onClick={handleGenerateNarrativeAudio} disabled={storybookContent.isGeneratingNarrativeAudio || !storybookContent.storyNarrative.trim() || isGenerationDisabled} className="text-indigo-400 hover:text-white disabled:opacity-50 w-full sm:w-auto flex justify-center py-1 sm:py-0">
                                                            {storybookContent.isGeneratingNarrativeAudio ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <SpeakerWaveIcon className="w-4 h-4" />}
                                                        </button>
                                                    </div>
                                                )}
                                                
                                                <div className="flex justify-end gap-2 ml-auto w-full sm:w-auto">
                                                    {isAiStoryHelpMode ? (
                                                        isStorybookLoading ? (
                                                            <button onClick={handleStopGeneration} className="px-4 py-1.5 bg-red-600 text-white font-bold rounded hover:bg-red-500 flex items-center gap-2 text-sm w-full sm:w-auto justify-center">
                                                                <StopIcon className="w-3 h-3" /> Stop
                                                            </button>
                                                        ) : (
                                                            <button onClick={handleAskAiForStory} disabled={!storybookAiPrompt.trim() || isGenerationDisabled} className="px-4 py-1.5 bg-indigo-600 text-white font-bold rounded hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 text-sm w-full sm:w-auto justify-center">
                                                                Generate Narrative
                                                            </button>
                                                        )
                                                    ) : (
                                                        isStorybookAnalyzing ? (
                                                            <button onClick={handleStopGeneration} className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500 transition-all text-sm">
                                                                <StopIcon className="w-4 h-4" /> Stop Analysis
                                                            </button>
                                                        ) : (
                                                            <button onClick={handleAnalyzeStory} disabled={!storybookContent.storyNarrative.trim() || isGenerationDisabled} className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-teal-600 text-white font-bold rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-all text-sm shadow-sm border border-teal-500/30">
                                                                {isStorybookAnalyzing ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="w-4 h-4" />}
                                                                <span>{isStorybookAnalyzing ? 'Analyzing Story...' : 'Analyze & Create Scenes'}</span>
                                                            </button>
                                                        )
                                                    )}
                                                </div>
                                            </div>

                                            {!isAiStoryHelpMode && storybookContent.narrativeAudioSrc && (
                                                <div className="w-full mt-2 animate-in fade-in slide-in-from-top-1">
                                                    <audio src={storybookContent.narrativeAudioSrc} controls className="w-full h-10 rounded bg-gray-700" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {storybookContent.scenes.map((scene, index) => (
                                        <div key={scene.id} className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex gap-4">
                                            <div className="w-8 flex-shrink-0 flex flex-col items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-indigo-900 text-indigo-200 flex items-center justify-center text-xs font-bold shadow-sm">{index + 1}</div>
                                                <button onClick={() => removeStorybookScene(scene.id)} className="text-gray-600 hover:text-red-500 transition-colors"><TrashIcon className="w-4 h-4" /></button>
                                            </div>
                                            <div className="flex-1 space-y-3">
                                                <div>
                                                     <div className="flex justify-between mb-1">
                                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">VISUAL PROMPT</label>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => handleCopyToClipboard(scene.imageDescription, `desc-${scene.id}`)} className="text-gray-500 hover:text-green-400 transition-colors" title="Copy">
                                                                {copiedId === `desc-${scene.id}` ? <CheckIcon className="w-3 h-3 text-green-400" /> : <ClipboardIcon className="w-3 h-3" />}
                                                            </button>
                                                            <button onClick={() => handleSceneLockToggle(scene.id, 'description')} className="text-gray-500 hover:text-gray-300 transition-colors">{scene.isDescriptionLocked ? <LockClosedIcon className="w-3 h-3" /> : <LockOpenIcon className="w-3 h-3" />}</button>
                                                            <button onClick={() => handleGenerateSceneFromStorybook(index, scene.imageDescription)} disabled={isGenerationDisabled} className="text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Generate Image"><SparklesIcon className="w-3 h-3" /></button>
                                                        </div>
                                                     </div>
                                                    <textarea
                                                        value={scene.imageDescription}
                                                        onChange={(e) => handleSceneChange(scene.id, 'imageDescription', e.target.value)}
                                                        disabled={scene.isDescriptionLocked}
                                                        className="w-full p-2 bg-gray-900 border border-gray-600 rounded text-sm disabled:opacity-50 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                                                        rows={3}
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between mb-1">
                                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">NARRATION / SCRIPT</label>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => handleSceneLockToggle(scene.id, 'narration')} className="text-gray-500 hover:text-gray-300 transition-colors">{scene.isNarrationLocked ? <LockClosedIcon className="w-3 h-3" /> : <LockOpenIcon className="w-3 h-3" />}</button>
                                                            <button onClick={() => handleCopyToClipboard(scene.narration, `narr-${scene.id}`)} className="text-gray-500 hover:text-green-400 transition-colors" title="Copy">
                                                                {copiedId === `narr-${scene.id}` ? <CheckIcon className="w-3 h-3 text-green-400" /> : <ClipboardIcon className="w-3 h-3" />}
                                                            </button>
                                                        </div>
                                                     </div>
                                                    <textarea
                                                        value={scene.narration}
                                                        onChange={(e) => handleSceneChange(scene.id, 'narration', e.target.value)}
                                                        disabled={scene.isNarrationLocked}
                                                        className="w-full p-2 bg-gray-900 border border-gray-600 rounded text-sm disabled:opacity-50 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                                                        rows={3}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <button onClick={addStorybookScene} className="w-full py-3 border-2 border-dashed border-gray-700 rounded-lg text-gray-500 hover:border-gray-500 hover:text-gray-300 font-bold flex items-center justify-center gap-2 transition-colors">
                                        <PlusCircleIcon className="w-5 h-5" /> Add Scene
                                    </button>
                                    
                                    {/* Conditional Rendering of the Generate Button */}
                                    {storybookContent.scenes.length > 0 && (
                                        <div className="flex flex-col items-center justify-center pt-4 pb-8">
                                            {storybookError && (
                                                <div className={`p-3 mb-4 w-full max-w-md border text-xs rounded text-left animate-in fade-in slide-in-from-bottom-2 ${
                                                    storybookError.type === 'warning'
                                                        ? 'bg-yellow-900/30 border-yellow-800 text-yellow-300'
                                                        : 'bg-red-900/30 border-red-800 text-red-300'
                                                }`}>
                                                    <p className="font-bold mb-1 flex items-center gap-2">
                                                        {storybookError.type === 'warning' ? <span className="text-yellow-400">⚠️</span> : <XCircleIcon className="w-4 h-4"/>}
                                                        {storybookError.type === 'warning' ? 'Warning' : 'Error'}
                                                    </p>
                                                    <p>{storybookError.message}</p>
                                                </div>
                                            )}
                                            {appStatus.status === 'loading' ? (
                                                <button onClick={handleStopGeneration} className="w-full max-w-md py-4 bg-red-600 text-white font-bold text-lg rounded-xl shadow-lg hover:bg-red-500 flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02]">
                                                    <StopIcon className="w-6 h-6" />
                                                    <span>Stop Generation</span>
                                                </button>
                                            ) : (
                                                <button 
                                                    onClick={handleCreateStoryboardFromScript}
                                                    disabled={isGenerationDisabled}
                                                    className="w-full max-w-md py-4 bg-gradient-to-r from-teal-600 to-teal-500 text-white font-bold rounded-xl shadow-lg hover:from-teal-500 hover:to-teal-400 flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02] disabled:from-gray-600 disabled:to-gray-500 disabled:cursor-not-allowed"
                                                >
                                                    <SparklesIcon className="w-6 h-6" />
                                                    <span>Generate Storyboard</span>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                },
                {
                    show: showHistoryPanel,
                    setter: setShowHistoryPanel,
                    title: 'History',
                    content: (
                        <div className="flex flex-col h-full">
                            <div className="p-4 border-b border-gray-800 shrink-0">
                                <div className="flex bg-gray-800 p-1 rounded-lg">
                                    <button
                                        onClick={() => setHistoryFilter('all')}
                                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${historyFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                                    >
                                        All
                                    </button>
                                    <button
                                        onClick={() => setHistoryFilter('saved')}
                                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${historyFilter === 'saved' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                                    >
                                        Saved
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {filteredHistory.length === 0 && <p className="text-gray-500 text-sm text-center">No {historyFilter === 'saved' ? 'saved' : ''} history yet.</p>}
                                {filteredHistory.map((item) => {
                                    const hasSavedScene = savedItems.some(savedItem => savedItem.id.startsWith(`${item.id}-`));
                                    const activeIndex = generationHistory.findIndex(h => h.id === item.id);
                                    return (
                                        <div 
                                            key={item.id} 
                                            className={`p-3 rounded-lg border cursor-pointer transition-colors ${activeIndex === activeHistoryIndex ? 'bg-gray-800 border-indigo-500' : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'}`} 
                                            onClick={() => { setActiveHistoryIndex(activeIndex); setActiveVideoIndex(-1); setShowHistoryPanel(false); }}
                                        >
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-bold text-gray-400">{new Date(item.id).toLocaleTimeString()}</span>
                                                <div className="flex items-center gap-2">
                                                    {hasSavedScene && <BookmarkIcon className="w-4 h-4 text-indigo-400" solid />}
                                                    <button onClick={(e) => { e.stopPropagation(); handleRemoveHistoryItem(item.id); }} className="text-gray-500 hover:text-red-500"><TrashIcon className="w-4 h-4" /></button>
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-200 line-clamp-2 mb-2">{item.prompt}</p>
                                            <div className="flex gap-1 overflow-hidden h-12">
                                                {item.imageSet.slice(0, 5).map((s, i) => {
                                                    const isSceneSaved = savedItems.some(saved => saved.id === `${item.id}-${i}`);
                                                    return (
                                                        <div key={i} className="relative h-full shrink-0">
                                                            {s.src ? <img src={`data:image/png;base64,${s.src}`} className="h-full w-auto rounded" alt="" /> : <div className="h-full aspect-video w-auto bg-gray-700 rounded animate-pulse" />}
                                                            {isSceneSaved && (
                                                                <div className="absolute top-1 right-1 bg-indigo-600/80 rounded-full p-0.5 backdrop-blur-sm">
                                                                    <BookmarkIcon className="w-2.5 h-2.5 text-white" solid />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )
                },
            ].filter(Boolean).map((panel, idx) => (
                <div 
                    key={idx}
                    className={`fixed inset-y-0 right-0 w-full md:w-[500px] bg-gray-900 shadow-2xl transform transition-transform duration-300 ease-in-out z-50 border-l border-gray-700 flex flex-col ${panel.show ? 'translate-x-0' : 'translate-x-full'}`}
                >
                     <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900 shrink-0">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                             {panel.title === 'Storybook' && <BookOpenIcon className="w-5 h-5 text-indigo-500" />}
                             {panel.title === 'History' && <HistoryIcon className="w-5 h-5 text-gray-400" />}
                             {panel.title}
                        </h2>
                        <button onClick={() => panel.setter(false)} className="p-2 text-gray-500 hover:text-white rounded hover:bg-gray-800 transition-colors">
                            <XIcon className="w-6 h-6" />
                        </button>
                    </div>
                    {panel.content}
                </div>
            ))}
            {zoomedImage && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setZoomedImage(null)}>
                    <img src={zoomedImage.startsWith('data:') ? zoomedImage : `data:image/png;base64,${zoomedImage}`} alt="Zoomed view" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in fade-in zoom-in-75" />
                </div>
            )}
             {confirmationModal.isOpen && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-2xl border border-gray-700 animate-in fade-in zoom-in-95">
                        <h3 className="text-lg font-bold text-white mb-2">{confirmationModal.title}</h3>
                        <p className="text-sm text-gray-400 mb-6">{confirmationModal.message}</p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={confirmationModal.onCancel}
                                className="px-4 py-2 rounded-lg text-gray-300 font-bold bg-gray-700 hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmationModal.onConfirm}
                                className="px-4 py-2 rounded-lg text-white font-bold bg-indigo-600 hover:bg-indigo-500 transition-colors"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;