
import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { Modals } from './components/Modals';
// FIX: Import the Timeline component.
import { Timeline } from './components/Timeline';
import { generateVideoFromScene, generateVideoFromImages, type Character, type Storybook, generateSingleImage, generateCharacterDescription, generateCharacterVisual, editImage, generatePromptFromAudio, generatePromptsFromBase } from './services/geminiService';
import { fileToBase64 } from './utils/fileUtils';
import { HomeIcon, ClapperboardIcon, LoaderIcon, BookOpenIcon, PencilIcon, PhotoIcon } from './components/Icons';
import { dbGet, dbSet } from './utils/indexedDB';

const App: React.FC = () => {
    // HELPER: Local Storage Persistence (Keep for small settings)
    const getStorageStr = (key: string, defaultVal: string) => {
        if (typeof window === 'undefined') return defaultVal;
        return localStorage.getItem(key) || defaultVal;
    };
    const getStorageNum = (key: string, defaultVal: number) => {
        if (typeof window === 'undefined') return defaultVal;
        const item = localStorage.getItem(key);
        return item ? Number(item) : defaultVal;
    };
    const getStorageJSON = (key: string, defaultVal: any) => {
        if (typeof window === 'undefined') return defaultVal;
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultVal;
        } catch (e) { return defaultVal; }
    };

    const saveToStorage = (key: string, value: any) => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        } catch (e) {
            console.error(`Failed to save ${key} to localStorage`, e);
        }
    };

    // STATE: Mobile Tab Navigation
    const [mobileTab, setMobileTab] = useState<'editor' | 'storyboard'>('editor');

    // STATE: Sidebar & Inputs
    const [prompt, setPrompt] = useState('');
    const [imageCount, setImageCount] = useState(() => getStorageNum('imageCount', 1));
    const [aspectRatio, setAspectRatio] = useState(() => getStorageStr('aspectRatio', '16:9'));
    const [characterStyle, setCharacterStyle] = useState(() => getStorageStr('characterStyle', 'Afro-toon'));
    const [visualStyle, setVisualStyle] = useState(() => getStorageStr('visualStyle', '3D Render'));
    const [imageModel, setImageModel] = useState(() => getStorageStr('imageModel', 'gemini-2.5-flash-image'));
    const [genre, setGenre] = useState(() => getStorageStr('genre', 'General')); 
    
    // Video Settings (Now controlled in Workspace)
    const [videoModel, setVideoModel] = useState(() => getStorageStr('videoModel', 'veo-3.1-fast-generate-preview'));
    const [videoResolution, setVideoResolution] = useState(() => getStorageStr('videoResolution', '720p'));

    // Large state items - Initialized empty, loaded async from DB
    const [characters, setCharacters] = useState<Character[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [savedScenes, setSavedScenes] = useState<any[]>([]);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    
    // STATE: Storybook
    const [storybook, setStorybook] = useState<Storybook>({
        title: '',
        characters: [],
        storyNarrative: '',
        scenes: []
    });

    const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isProcessingAudio, setIsProcessingAudio] = useState(false);
    const [appStatus, setAppStatus] = useState({ status: 'idle', error: null as string | null });
    const [statusMessage, setStatusMessage] = useState('');
    const [creditSettings, setCreditSettings] = useState(() => getStorageJSON('creditSettings', { creditBalance: 0, currency: 'USD' as 'USD' | 'SEK' }));
    const [dailyCounts, setDailyCounts] = useState({ images: 0, videos: 0 });

    // STATE: Timeline
    const [timelineClips, setTimelineClips] = useState<any[]>([]);
    const [activeVideoIndex, setActiveVideoIndex] = useState(-1);

    // STATE: UI Panels
    const [activeModal, setActiveModal] = useState<string | null>(null);
    const [modalData, setModalData] = useState<any>({});

    const currentGeneration = activeHistoryIndex >= 0 ? history[activeHistoryIndex] : null;

    // Load Data from IndexedDB on mount
    useEffect(() => {
        const loadData = async () => {
            const h = await dbGet('appHistory');
            const s = await dbGet('savedScenes');
            const c = await dbGet('characters');
            
            if (h) setHistory(h);
            if (s) setSavedScenes(s);
            if (c) setCharacters(c);
            
            setIsDataLoaded(true);
        };
        loadData();
    }, []);

    // Set active index after data load if needed
    useEffect(() => {
        if (isDataLoaded && history.length > 0 && activeHistoryIndex === -1) {
            // Find the last session that is NOT closed
            for (let i = history.length - 1; i >= 0; i--) {
                if (!history[i].isClosed) {
                    setActiveHistoryIndex(i);
                    return;
                }
            }
        }
    }, [isDataLoaded, history.length]);

    // PERSISTENCE EFFECTS (Use IndexedDB for large items)
    useEffect(() => { if(isDataLoaded) dbSet('appHistory', history); }, [history, isDataLoaded]);
    useEffect(() => { if(isDataLoaded) dbSet('savedScenes', savedScenes); }, [savedScenes, isDataLoaded]);
    useEffect(() => { if(isDataLoaded) dbSet('characters', characters); }, [characters, isDataLoaded]);

    // Regular LocalStorage for settings
    useEffect(() => saveToStorage('imageCount', String(imageCount)), [imageCount]);
    useEffect(() => saveToStorage('aspectRatio', aspectRatio), [aspectRatio]);
    useEffect(() => saveToStorage('characterStyle', characterStyle), [characterStyle]);
    useEffect(() => saveToStorage('visualStyle', visualStyle), [visualStyle]);
    useEffect(() => saveToStorage('imageModel', imageModel), [imageModel]);
    useEffect(() => saveToStorage('genre', genre), [genre]);
    useEffect(() => saveToStorage('creditSettings', creditSettings), [creditSettings]);
    useEffect(() => saveToStorage('videoModel', videoModel), [videoModel]);
    useEffect(() => saveToStorage('videoResolution', videoResolution), [videoResolution]);

    // Calculate current cost per image for transparency
    const currentCostPerImage = imageModel.includes('flash') ? 0.025 : 0.05;
    const currencySymbol = creditSettings.currency === 'USD' ? '$' : 'kr';
    const exchangeRate = creditSettings.currency === 'USD' ? 1 : 10.5;

    // HELPER: Find nearest open session
    const findNearestOpenSession = (currentHistory: any[], fromIndex: number) => {
        // Try to find one before
        for (let i = fromIndex - 1; i >= 0; i--) {
            if (!currentHistory[i].isClosed) return i;
        }
        // Try to find one after
        for (let i = fromIndex + 1; i < currentHistory.length; i++) {
            if (!currentHistory[i].isClosed) return i;
        }
        return -1;
    };

    // HANDLERS
    const handleOpenImagePreview = (src: string | null) => {
        if (!src) return;
        setModalData({ src });
        setActiveModal('image-preview');
    };

    const handleNavigateHistory = (direction: number) => {
        let newIndex = activeHistoryIndex + direction;
        while (newIndex >= 0 && newIndex < history.length) {
            if (!history[newIndex].isClosed) {
                setActiveHistoryIndex(newIndex);
                setActiveVideoIndex(-1);
                return;
            }
            newIndex += direction;
        }
        const hasOpenSessions = history.some(h => !h.isClosed);
        if (newIndex === -1 && !hasOpenSessions) {
             setActiveHistoryIndex(-1);
             setActiveVideoIndex(-1);
        }
    };
    
    const handleSwitchSession = (index: number) => {
        setActiveHistoryIndex(index);
        setActiveVideoIndex(-1);
        setMobileTab('storyboard');
    };
    
    const handleNewSession = () => {
        setActiveHistoryIndex(-1);
        setActiveVideoIndex(-1);
        setMobileTab('storyboard');
    };

    const handleClearHistory = () => {
        const activeSessionId = activeHistoryIndex >= 0 ? history[activeHistoryIndex].id : null;
        const newHistory = history.map(session => {
            if (session.id === activeSessionId) return session;
            const savedIndices: number[] = [];
            session.imageSet.forEach((scene: any, index: number) => {
                 const uniqueId = `${session.id}-${scene.sceneId}`;
                 if (savedScenes.some(s => s.id === uniqueId)) {
                     savedIndices.push(index);
                 }
            });
            if (savedIndices.length === 0) return null;
            return {
                ...session,
                imageSet: savedIndices.map(i => session.imageSet[i]),
                videoStates: savedIndices.map(i => session.videoStates[i]),
                isClosed: true 
            };
        }).filter(Boolean) as any[];

        setHistory(newHistory);
        if (activeSessionId) {
            const newIndex = newHistory.findIndex(h => h.id === activeSessionId);
            setActiveHistoryIndex(newIndex);
        } else {
            setActiveHistoryIndex(-1);
        }
    };

    const handleAudioUpload = async (file: File) => {
        setIsProcessingAudio(true);
        setAppStatus({ status: 'loading', error: null });
        setStatusMessage("Transcribing audio...");
        try {
            const base64 = await fileToBase64(file);
            const text = await generatePromptFromAudio(base64, file.type);
            setPrompt(text);
            setStatusMessage("Audio transcribed! You can now generate the story.");
            setAppStatus({ status: 'idle', error: null });
        } catch (e: any) {
            console.error(e);
            setAppStatus({ status: 'error', error: "Audio transcription failed." });
        } finally {
            setIsProcessingAudio(false);
            setTimeout(() => setStatusMessage(""), 4000);
        }
    };

    const handleGenericUpload = async (file: File) => {
        try {
            setAppStatus({ status: 'loading', error: null });
            setStatusMessage("Uploading image...");
            const base64 = await fileToBase64(file);
            const newScene = { sceneId: `scene-${Date.now()}-upload`, src: base64, prompt: "Uploaded Image", error: null, isHidden: false, status: 'complete' };

            let targetIndex = -1;
            if (activeHistoryIndex !== -1 && !history[activeHistoryIndex].isClosed) {
                targetIndex = activeHistoryIndex;
            } else {
                for (let i = history.length - 1; i >= 0; i--) {
                    if (!history[i].isClosed) {
                        targetIndex = i;
                        break;
                    }
                }
            }

            if (targetIndex !== -1) {
                setHistory(prev => {
                    const newHistory = [...prev];
                    const session = { ...newHistory[targetIndex] };
                    session.imageSet = [...session.imageSet, newScene];
                    session.videoStates = [...session.videoStates, { status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' }];
                    newHistory[targetIndex] = session;
                    return newHistory;
                });
                setActiveHistoryIndex(targetIndex);
            } else {
                const newItem = {
                    id: Date.now(), type: 'upload', prompt: "Uploaded Image Session",
                    imageSet: [newScene],
                    videoStates: [{ status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' }],
                    aspectRatio: aspectRatio, characterStyle: characterStyle, visualStyle: visualStyle, isClosed: false
                };
                setHistory(prev => [...prev, newItem]);
                setActiveHistoryIndex(history.length); 
            }
            setMobileTab('storyboard'); 
            setStatusMessage("");
        } catch (e) {
            console.error(e);
            setAppStatus({ status: 'error', error: "Failed to upload image" });
        } finally {
            setAppStatus({ status: 'idle', error: null });
        }
    };

    const handleUploadStartImage = async (file: File) => {
        handleGenericUpload(file);
    };

    const handleUploadToSession = async (file: File) => {
        if (activeHistoryIndex === -1) {
            handleGenericUpload(file);
            return;
        }
        try {
            setAppStatus({ status: 'loading', error: null });
            setStatusMessage("Adding to session...");
            const base64 = await fileToBase64(file);
            const newScene = { sceneId: `scene-${Date.now()}-upload`, src: base64, prompt: "Uploaded Image", error: null, isHidden: false, status: 'complete' };

            setHistory(prev => {
                const newHistory = [...prev];
                const session = { ...newHistory[activeHistoryIndex] };
                session.imageSet = [...session.imageSet, newScene];
                session.videoStates = [...session.videoStates, { status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' }];
                newHistory[activeHistoryIndex] = session;
                return newHistory;
            });
            setStatusMessage("");
        } catch (e) {
            console.error(e);
            setAppStatus({ status: 'error', error: "Failed to add image" });
        } finally {
            setAppStatus({ status: 'idle', error: null });
        }
    };

    const handleGenerate = async (overridePrompts?: string[], source: 'idea' | 'storybook' = 'idea') => {
        if ((!prompt && !overridePrompts) || creditSettings.creditBalance <= 0) {
            if (creditSettings.creditBalance <= 0) setAppStatus({ status: 'error', error: "Insufficient credits. Please add funds." });
            return;
        }

        setIsGenerating(true);
        setMobileTab('storyboard'); 
        setAppStatus({ status: 'loading', error: null });
        setStatusMessage("Initializing...");
        if (activeModal === 'storybook') setActiveModal(null);

        try {
            let promptsToGenerate = overridePrompts || [];
            if (promptsToGenerate.length === 0) {
                if (imageCount > 1) {
                    setStatusMessage("Expanding story ideas...");
                    promptsToGenerate = await generatePromptsFromBase(prompt, imageCount, genre, characterStyle, characters);
                } else {
                    promptsToGenerate = [prompt];
                }
            }

            const newSessionId = Date.now();
            const placeholders = promptsToGenerate.map((p, i) => ({
                sceneId: `pending-${newSessionId}-${i}`, prompt: p, src: null, error: null, isHidden: false, status: 'pending'
            }));

            const newItem = {
                id: newSessionId, type: source,
                prompt: source === 'idea' ? (prompt || "Story Idea Session") : (storybook.title || "Storybook Session"),
                imageSet: placeholders,
                videoStates: placeholders.map(() => ({ status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' })),
                aspectRatio, characterStyle, visualStyle, isClosed: false
            };

            setHistory(prev => [...prev, newItem]);
            setActiveHistoryIndex(history.length); 

            const costPerImage = imageModel.includes('flash') ? 0.025 : 0.05;

            for (let i = 0; i < promptsToGenerate.length; i++) {
                setHistory(prev => {
                    const newHistory = [...prev];
                    const sIdx = newHistory.findIndex(h => h.id === newSessionId);
                    if (sIdx === -1) return prev; 
                    const session = { ...newHistory[sIdx] };
                    const newImageSet = [...session.imageSet];
                    newImageSet[i] = { ...newImageSet[i], status: 'generating' };
                    session.imageSet = newImageSet;
                    newHistory[sIdx] = session;
                    return newHistory;
                });

                setStatusMessage(`Generating scene ${i + 1} of ${promptsToGenerate.length}...`);
                const { src, error } = await generateSingleImage(
                    promptsToGenerate[i], aspectRatio, characterStyle, visualStyle, genre, characters, imageModel
                );

                setHistory(prev => {
                    const newHistory = [...prev];
                    const sIdx = newHistory.findIndex(h => h.id === newSessionId);
                    if (sIdx === -1) return prev; 
                    const session = { ...newHistory[sIdx] };
                    const newImageSet = [...session.imageSet];
                    newImageSet[i] = { ...newImageSet[i], src: src, error: error, status: error ? 'error' : 'complete' };
                    session.imageSet = newImageSet;
                    newHistory[sIdx] = session;
                    return newHistory;
                });

                if (src) {
                    setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - costPerImage) }));
                    setDailyCounts(p => ({ ...p, images: p.images + 1 }));
                }
            }
        } catch (e: any) {
            setAppStatus({ status: 'error', error: e.message });
        } finally {
            setIsGenerating(false);
            setStatusMessage("");
        }
    };

    const handleRestoreCard = (card: any) => {
        let targetType = card.sessionType;
        if (!targetType || targetType === 'Saved' || targetType === 'history-session') {
            if (card.prompt === "Uploaded Image" || card.sessionPrompt === "Uploaded Image Session") targetType = 'upload';
            else if (card.sessionPrompt?.includes("Storybook") || card.prompt?.includes("Storybook")) targetType = 'storybook';
            else targetType = 'idea';
        }

        const likelySavedId = card.isSavedOrphan ? card.id : `${card.sessionId}-${card.sceneId}`;
        const isActuallySaved = savedScenes.some(s => s.id === likelySavedId);

        const newScene = { 
            ...card, sceneId: `restored-${Date.now()}`,
            originalSavedId: isActuallySaved ? likelySavedId : undefined, isHidden: false, status: 'complete', error: null
        };

        let targetIndex = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (!history[i].isClosed && history[i].type === targetType) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
            const session = history[targetIndex];
            const existingIndex = session.imageSet.findIndex((s: any) => 
                (s.originalSavedId && s.originalSavedId === likelySavedId) || (s.src === card.src)
            );

            if (existingIndex !== -1) {
                setHistory(prev => {
                     const newHistory = [...prev];
                     const session = { ...newHistory[targetIndex] };
                     const newImageSet = [...session.imageSet];
                     newImageSet[existingIndex] = { ...newImageSet[existingIndex], isHidden: false };
                     session.imageSet = newImageSet;
                     newHistory[targetIndex] = session;
                     return newHistory;
                });
                setActiveHistoryIndex(targetIndex);
                setMobileTab('storyboard');
                setActiveModal(null);
                return;
            }

            setHistory(prev => {
                const newHistory = [...prev];
                const session = { ...newHistory[targetIndex] };
                session.imageSet = [...session.imageSet, newScene];
                session.videoStates = [...session.videoStates, { status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' }];
                newHistory[targetIndex] = session;
                return newHistory;
            });
            setActiveHistoryIndex(targetIndex);
        } else {
            const sessionTitle = card.sessionPrompt || (
                targetType === 'upload' ? "Uploaded Image Session" :
                targetType === 'storybook' ? "Restored Storybook" :
                card.prompt || "Restored Story Idea"
            );

            const newSession = {
                id: Date.now(), type: targetType, prompt: sessionTitle,
                imageSet: [newScene],
                videoStates: [{ status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' }],
                aspectRatio: card.aspectRatio || aspectRatio,
                characterStyle: card.characterStyle || characterStyle, visualStyle: card.visualStyle || visualStyle, isClosed: false
            };
            setHistory(prev => [...prev, newSession]);
            setActiveHistoryIndex(history.length);
        }
        setMobileTab('storyboard');
        setActiveModal(null);
    };

    const handleCloseSession = (index: number) => {
        if (index === -1) return;
        setHistory(prev => {
            const newHistory = [...prev];
            newHistory[index] = { ...newHistory[index], isClosed: true };
            return newHistory;
        });
        const nearestIndex = findNearestOpenSession(history, index);
        let nextIndex = nearestIndex !== -1 ? nearestIndex : -1;
        setActiveHistoryIndex(nextIndex);
    };

    const handleToggleVideoCreator = (index: number) => {
        setActiveVideoIndex(prev => prev === index ? -1 : index);
    };

    const handleUpdateVideoDraft = (genId: number, sceneId: string, updates: any) => {
        setHistory(prev => prev.map(h => {
            if (h.id === genId) {
                const idx = h.imageSet.findIndex((s: any) => s.sceneId === sceneId);
                if (idx !== -1) {
                    const newVS = [...h.videoStates];
                    newVS[idx] = { ...newVS[idx], ...updates };
                    return { ...h, videoStates: newVS };
                }
            }
            return h;
        }));
    };

    const handleGenerateVideo = async (genId: number, sceneId: string, scriptOverride?: string, cameraMovement: string = 'Zoom In (Focus In)') => {
        const item = history.find(h => h.id === genId);
        if (!item) return;
        const idx = item.imageSet.findIndex((s: any) => s.sceneId === sceneId);
        if (idx === -1) return;

        // Credit check is now handled in Workspace to show local error, but double check here
        if (creditSettings.creditBalance < 0.5) {
             setAppStatus({ status: 'error', error: "Insufficient credits for video ($0.50)." });
             return;
        }
        
        setHistory(prev => prev.map(h => {
             if (h.id === genId) {
                 const newVS = [...h.videoStates];
                 newVS[idx] = { ...newVS[idx], status: 'loading', loadingMessage: 'Initializing video...' };
                 return { ...h, videoStates: newVS };
             }
             return h;
        }));

        try {
            const onProgress = (msg: string) => {
                 setHistory(prev => prev.map(h => {
                     if (h.id === genId) {
                         const newVS = [...h.videoStates];
                         newVS[idx] = { ...newVS[idx], loadingMessage: msg };
                         return { ...h, videoStates: newVS };
                     }
                     return h;
                 }));
            };

            // FIX: Removed extra `null` argument causing parameter shift and type error.
            const res = await generateVideoFromScene(
                item.imageSet[idx], item.aspectRatio, scriptOverride || "", null, item.visualStyle, 
                item.characterStyle, 
                videoModel, videoResolution as '720p' | '1080p', cameraMovement, 
                onProgress, 
                null
            );
            
            setHistory(prev => prev.map(h => {
                if (h.id === genId) {
                    const newVS = [...h.videoStates];
                    newVS[idx] = { 
                        ...newVS[idx], // Keep drafts
                        status: 'idle', 
                        clips: [...newVS[idx].clips, { url: res.videoUrl, duration: 4, videoObject: res.videoObject }] 
                    };
                    return { ...h, videoStates: newVS };
                }
                return h;
            }));
            setDailyCounts(p => ({ ...p, videos: p.videos + 1 }));
            setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - 0.5) }));

        } catch (e: any) {
             setHistory(prev => prev.map(h => {
                 if (h.id === genId) {
                     const newVS = [...h.videoStates];
                     newVS[idx] = { ...newVS[idx], status: 'error', error: e.message };
                     return { ...h, videoStates: newVS };
                 }
                 return h;
             }));
            // Only set global app status error if it's a critical failure, otherwise keep it local to the card
            // setAppStatus({ status: 'error', error: e.message }); 
        }
    };

    const handleAddToTimeline = (url: string, videoObject?: any) => {
        setTimelineClips(prev => [...prev, { id: Date.now().toString(), url, duration: 4, videoObject }]);
    };

    const handleExtendClip = async (clipId: string, extensionPrompt: string) => {
        const clipToExtend = timelineClips.find(c => c.id === clipId);
        if (!clipToExtend || !clipToExtend.videoObject) {
            setAppStatus({ status: 'error', error: "Cannot extend this clip (missing source data)." });
            return;
        }
        if (creditSettings.creditBalance < 0.5) {
            setAppStatus({ status: 'error', error: "Insufficient credits for extension ($0.50)." });
            return;
        }

        // Add loading placeholder to timeline
        const loadingId = `loading-${Date.now()}`;
        setTimelineClips(prev => [...prev, { id: loadingId, url: '', duration: 4, videoObject: null, isLoading: true }]);

        try {
            const dummyScene = { src: null, prompt: '', isHidden: false }; 
            const onProgress = (msg: string) => {}; 
            
            // FIX: Removed extra `null` argument causing parameter shift and type error.
            const res = await generateVideoFromScene(
                dummyScene, aspectRatio, extensionPrompt, null, visualStyle,
                characterStyle, 
                'veo-3.1-generate-preview', '720p', 'Static Hold',
                onProgress,
                clipToExtend.videoObject
            );

            // Replace loading placeholder with real clip
            setTimelineClips(prev => prev.map(c => 
                c.id === loadingId ? { id: Date.now().toString(), url: res.videoUrl!, duration: 4, videoObject: res.videoObject } : c
            ));

            setDailyCounts(p => ({ ...p, videos: p.videos + 1 }));
            setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - 0.5) }));

        } catch (e: any) {
            setAppStatus({ status: 'error', error: e.message });
            // Remove loading placeholder
            setTimelineClips(prev => prev.filter(c => c.id !== loadingId));
        }
    };

    const handleAnimateFromImages = async (mode: any, images: any, prompt: string) => {
        if (creditSettings.creditBalance < 0.5) {
            setAppStatus({ status: 'error', error: "Insufficient credits ($0.50)." });
            return;
        }
        setIsGenerating(true);
        setMobileTab('storyboard');
        setStatusMessage("Animating...");
        try {
            const onProgress = (msg: string) => setStatusMessage(msg);
            const res = await generateVideoFromImages(mode, images, prompt, videoModel, aspectRatio, videoResolution as '720p' | '1080p', onProgress);
            handleAddToTimeline(res.videoUrl!, res.videoObject);
            setDailyCounts(p => ({ ...p, videos: p.videos + 1 }));
            setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - 0.5) }));
        } catch (e: any) {
            setAppStatus({ status: 'error', error: e.message });
        } finally {
            setIsGenerating(false);
            setStatusMessage("");
        }
    };

    const handleUploadNewCharacterImage = async (file: File) => {
        try {
            const base64 = await fileToBase64(file);
            const newChar: Character = {
                id: Date.now(),
                name: file.name.split('.')[0].substring(0, 10),
                imagePreview: `data:${file.type};base64,${base64}`,
                originalImageBase64: base64,
                originalImageMimeType: file.type,
                description: '',
                detectedImageStyle: null,
                isDescribing: true
            };
            setCharacters(prev => [...prev, newChar]);
    
            generateCharacterDescription(base64, file.type)
                .then(res => {
                    setCharacters(current => current.map(c =>
                        c.id === newChar.id ? { ...c, description: res.description, detectedImageStyle: res.detectedStyle, isDescribing: false } : c
                    ));
                })
                .catch(err => {
                    console.error("Analysis failed", err);
                    setCharacters(current => current.map(c =>
                        c.id === newChar.id ? { ...c, isDescribing: false } : c
                    ));
                });
    
        } catch (e) {
            console.error("Upload failed", e);
            setAppStatus({ status: 'error', error: "Failed to upload character image" });
        }
    };

    const handleCharacterImageUpload = async (file: File, id: number) => {
        try {
            const base64 = await fileToBase64(file);
             setCharacters(prev => prev.map(c => {
                 if (c.id === id) {
                     return {
                         ...c,
                         imagePreview: `data:${file.type};base64,${base64}`,
                         originalImageBase64: base64,
                         originalImageMimeType: file.type,
                         isDescribing: true
                     };
                 }
                 return c;
             }));
    
             generateCharacterDescription(base64, file.type)
                .then(res => {
                    setCharacters(current => current.map(c =>
                        c.id === id ? { ...c, description: res.description, detectedImageStyle: res.detectedStyle, isDescribing: false } : c
                    ));
                })
                .catch(err => {
                     setCharacters(current => current.map(c =>
                        c.id === id ? { ...c, isDescribing: false } : c
                    ));
                });
        } catch (e) {
            console.error(e);
        }
    }
    
    const handleBuildCharacterVisual = async (id: number) => {
        const char = characters.find(c => c.id === id);
        if (!char) return;
        setCharacters(prev => prev.map(c => c.id === id ? { ...c, isDescribing: true } : c));
        try {
            const { src, error } = await generateCharacterVisual(char, visualStyle);
            if (src) {
                 setCharacters(prev => prev.map(c => c.id === id ? {
                     ...c,
                     imagePreview: `data:image/png;base64,${src}`,
                     originalImageBase64: c.originalImageBase64 || src,
                     originalImageMimeType: c.originalImageMimeType || 'image/png',
                     isDescribing: false
                 } : c));
            } else {
                setAppStatus({ status: 'error', error: error || "Failed to generate visual" });
                setCharacters(prev => prev.map(c => c.id === id ? { ...c, isDescribing: false } : c));
            }
        } catch (e: any) {
             setAppStatus({ status: 'error', error: e.message });
             setCharacters(prev => prev.map(c => c.id === id ? { ...c, isDescribing: false } : c));
        }
    }

    const handleLoadHistory = (index: number) => {
        setHistory(prev => {
            const newHistory = [...prev];
            newHistory[index] = { ...newHistory[index], isClosed: false }; // Re-open
            return newHistory;
        });
        setActiveHistoryIndex(index);
        setActiveModal(null);
        setMobileTab('storyboard');
    };
    
    const handleDeleteHistory = (index: number) => {
        setHistory(prev => prev.filter((_, i) => i !== index));
        if (activeHistoryIndex === index) {
             setActiveHistoryIndex(Math.max(-1, index - 1));
        } else if (activeHistoryIndex > index) {
             setActiveHistoryIndex(activeHistoryIndex - 1);
        }
    };

    const handleDeleteScene = (genId: number, sceneId: string) => {
        const sessionIndex = history.findIndex(h => h.id === genId);
        if (sessionIndex === -1) return;
        let shouldClose = false;
        setHistory(prev => {
            const newHistory = [...prev];
            const session = { ...newHistory[sessionIndex] };
            session.imageSet = session.imageSet.map((s: any) => 
                s.sceneId === sceneId ? { ...s, isHidden: true } : s
            );
            const hasVisibleScenes = session.imageSet.some((s: any) => !s.isHidden);
            if (!hasVisibleScenes) {
                session.isClosed = true;
                shouldClose = true;
            }
            newHistory[sessionIndex] = session;
            return newHistory;
        });
        if (shouldClose && activeHistoryIndex === sessionIndex) {
             setTimeout(() => {
                const nearestIndex = findNearestOpenSession(history, sessionIndex);
                setActiveHistoryIndex(nearestIndex);
             }, 0);
        }
    };

    const handleSaveScene = (genId: number, sceneId: string) => {
        const item = history.find(h => h.id === genId);
        if (!item) return;
        const scene = item.imageSet.find((s: any) => s.sceneId === sceneId);
        if (!scene) return;
        const uniqueId = scene.originalSavedId || `${genId}-${sceneId}`;
        if (savedScenes.some(s => s.id === uniqueId)) {
            setSavedScenes(prev => prev.filter(s => s.id !== uniqueId));
        } else {
            setSavedScenes(prev => [...prev, { 
                id: uniqueId, src: scene.src, prompt: scene.prompt, timestamp: Date.now(),
                aspectRatio: item.aspectRatio, visualStyle: item.visualStyle, characterStyle: item.characterStyle, sessionType: item.type 
            }]);
        }
    };

    const handleToggleSaveCard = (card: any) => {
        const uniqueId = card.isSavedOrphan ? card.id : `${card.sessionId}-${card.sceneId}`;
        if (savedScenes.some(s => s.id === uniqueId)) {
            setSavedScenes(prev => prev.filter(s => s.id !== uniqueId));
        } else {
            setSavedScenes(prev => [...prev, {
                id: uniqueId, src: card.src, prompt: card.prompt || card.sessionPrompt, timestamp: card.timestamp || Date.now(),
                aspectRatio: card.aspectRatio, visualStyle: card.visualStyle, characterStyle: card.characterStyle, sessionType: card.sessionType
            }]);
        }
    };

    const handleRestoreSavedCard = (card: any) => {
        handleRestoreCard(card);
    };

    const handleEditScene = (genId: number, sceneId: string) => {
        const item = history.find(h => h.id === genId);
        if (!item) return;
        const scene = item.imageSet.find((s: any) => s.sceneId === sceneId);
        if (!scene) return;
        setModalData({ genId, sceneId, src: scene.src, prompt: scene.prompt });
        setActiveModal('edit-image');
    };

    const handleConfirmEdit = async (editPrompt: string, maskBase64?: string, newStyle?: string, referenceImageBase64?: string | null) => {
        if (!modalData.src) return;
        const cost = 0.025;
        if (creditSettings.creditBalance < cost) {
            setAppStatus({ status: 'error', error: "Insufficient credits." });
            return;
        }
        setIsGenerating(true);
        setActiveModal(null);
        
        // Optimistic UI Update: Set status on the existing card to generating
        setHistory(prev => prev.map(h => {
            if (h.id === modalData.genId) {
                    const idx = h.imageSet.findIndex((s: any) => s.sceneId === modalData.sceneId);
                    if (idx !== -1) {
                        const newSet = [...h.imageSet];
                        newSet[idx] = { ...newSet[idx], status: 'generating' };
                        return { ...h, imageSet: newSet };
                    }
            }
            return h;
        }));

        setStatusMessage("Editing image...");
        try {
            const currentItem = history.find(h => h.id === modalData.genId);
            const overlayImage = maskBase64 ? { base64: maskBase64, mimeType: 'image/png' } : undefined;
            const refImage = referenceImageBase64 ? { base64: referenceImageBase64, mimeType: 'image/png' } : undefined;
            
            const { src, error } = await editImage({
                imageBase64: modalData.src, mimeType: 'image/png', editPrompt: editPrompt,
                aspectRatio: currentItem?.aspectRatio || '16:9', characterStyle: currentItem?.characterStyle || 'General',
                visualStyle: newStyle || currentItem?.visualStyle || '3D Render', genre: genre, characters: characters,
                imageModel: imageModel || 'gemini-2.5-flash-image', overlayImage: overlayImage, referenceImage: refImage, hasVisualMasks: !!maskBase64
            });

            if (src) {
                setHistory(prev => prev.map(h => {
                    if (h.id === modalData.genId) {
                         const idx = h.imageSet.findIndex((s: any) => s.sceneId === modalData.sceneId);
                         if (idx !== -1) {
                             const newSet = [...h.imageSet];
                             newSet[idx] = { ...newSet[idx], src: src, prompt: `${newSet[idx].prompt} (Edited: ${editPrompt})`, status: 'complete' };
                             return { ...h, imageSet: newSet };
                         }
                    }
                    return h;
                }));
                setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - cost) }));
            } else {
                setAppStatus({ status: 'error', error: error || "Failed to edit" });
                setHistory(prev => prev.map(h => {
                    if (h.id === modalData.genId) {
                         const idx = h.imageSet.findIndex((s: any) => s.sceneId === modalData.sceneId);
                         if (idx !== -1) {
                             const newSet = [...h.imageSet];
                             newSet[idx] = { ...newSet[idx], status: 'complete', error: error || "Failed" };
                             return { ...h, imageSet: newSet };
                         }
                    }
                    return h;
                }));
            }
        } catch (e: any) {
            setAppStatus({ status: 'error', error: e.message });
        } finally {
            setIsGenerating(false);
            setStatusMessage("");
        }
    };

    const handleRegenerateScene = async (genId: number, sceneId: string) => {
        const item = history.find(h => h.id === genId);
        if (!item) return;
        const idx = item.imageSet.findIndex((s: any) => s.sceneId === sceneId);
        if (idx === -1) return;
        const scene = item.imageSet[idx];
        const cost = 0.025;
        if (creditSettings.creditBalance < cost) {
            setAppStatus({ status: 'error', error: "Insufficient credits." });
            return;
        }
        setIsGenerating(true);
        setStatusMessage("Regenerating scene...");
         setHistory(prev => prev.map(h => {
            if (h.id === genId) {
                 const newSet = [...h.imageSet];
                 newSet[idx] = { ...newSet[idx], status: 'generating' };
                 return { ...h, imageSet: newSet };
            }
            return h;
        }));
        try {
            const { src, error } = await generateSingleImage(
                scene.prompt, item.aspectRatio, item.characterStyle, item.visualStyle, genre, characters, imageModel
            );
             setHistory(prev => prev.map(h => {
                if (h.id === genId) {
                     const newSet = [...h.imageSet];
                     newSet[idx] = { ...newSet[idx], src: src || newSet[idx].src, error: error, status: error ? 'error' : 'complete' };
                     return { ...h, imageSet: newSet };
                }
                return h;
            }));
            if (src) setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - cost) }));
        } catch (e: any) {
            setAppStatus({ status: 'error', error: e.message });
             setHistory(prev => prev.map(h => {
                if (h.id === genId) {
                     const newSet = [...h.imageSet];
                     newSet[idx] = { ...newSet[idx], status: 'error', error: e.message };
                     return { ...h, imageSet: newSet };
                }
                return h;
            }));
        } finally {
            setIsGenerating(false);
            setStatusMessage("");
        }
    };

    const handleAngleSelect = (genId: number, sceneId: string) => {
        const item = history.find(h => h.id === genId);
        if (!item) return;
        const scene = item.imageSet.find((s: any) => s.sceneId === sceneId);
        if (!scene) return;
        setModalData({ genId, sceneId, src: scene.src });
        setActiveModal('camera-angles');
    };

    const handleConfirmAngle = async (angle: string, subject?: string) => {
        const { genId, sceneId, src: originalSrc } = modalData;
        if (!originalSrc) return;
        const cost = 0.025;
        if (creditSettings.creditBalance < cost) {
            setAppStatus({ status: 'error', error: "Insufficient credits." });
            return;
        }
        
        setActiveModal(null);
        const prompt = subject ? `Change camera angle to ${angle}. Focus strictly on ${subject}. Keep the character and scene appearance consistent.` : `Change camera angle to ${angle}. Keep the scene and characters exactly the same.`;
        
        // OPTIMISTIC UPDATE: Insert a placeholder "Generating" card immediately
        const newSceneId = `scene-${Date.now()}-${angle.replace(/\s+/g, '')}`;
        
        setHistory(prev => prev.map(h => {
            if (h.id === genId) {
                 const idx = h.imageSet.findIndex((s: any) => s.sceneId === sceneId);
                 if (idx !== -1) {
                     const newSet = [...h.imageSet];
                     const newVideoStates = [...h.videoStates];
                     const placeholderScene = {
                         sceneId: newSceneId, 
                         prompt: `Generating ${angle}...`,
                         src: null, 
                         error: null, 
                         angleName: angle, 
                         isHidden: false, 
                         status: 'generating' // This triggers the spinner in Workspace
                     };
                     newSet.splice(idx + 1, 0, placeholderScene);
                     newVideoStates.splice(idx + 1, 0, { status: 'idle', clips: [], draftScript: '', draftCameraMovement: 'Zoom In (Focus In)' });
                     return { ...h, imageSet: newSet, videoStates: newVideoStates };
                 }
            }
            return h;
        }));

        setIsGenerating(true);
        setStatusMessage(`Generating ${angle} view...`);
        
        try {
            const currentItem = history.find(h => h.id === genId);
            const { src: newSrc, error } = await editImage({
                imageBase64: originalSrc, mimeType: 'image/png', editPrompt: prompt,
                aspectRatio: currentItem?.aspectRatio || '16:9', characterStyle: currentItem?.characterStyle || 'General',
                visualStyle: currentItem?.visualStyle || '3D Render', genre: genre, characters: characters,
                imageModel: imageModel || 'gemini-2.5-flash-image'
            });

            if (newSrc) {
                setHistory(prev => prev.map(h => {
                    if (h.id === genId) {
                         // Find our placeholder by ID
                         const idx = h.imageSet.findIndex((s: any) => s.sceneId === newSceneId);
                         if (idx !== -1) {
                             const newSet = [...h.imageSet];
                             newSet[idx] = { 
                                 ...newSet[idx], 
                                 prompt: `${currentItem?.imageSet.find((s:any) => s.sceneId === sceneId)?.prompt} (${angle})`,
                                 src: newSrc, 
                                 status: 'complete' 
                             };
                             return { ...h, imageSet: newSet };
                         }
                    }
                    return h;
                }));
                setCreditSettings(prev => ({ ...prev, creditBalance: Math.max(0, prev.creditBalance - cost) }));
            } else {
                setAppStatus({ status: 'error', error: error || "Failed to generate angle" });
                 setHistory(prev => prev.map(h => {
                    if (h.id === genId) {
                         const idx = h.imageSet.findIndex((s: any) => s.sceneId === newSceneId);
                         if (idx !== -1) {
                             const newSet = [...h.imageSet];
                             newSet[idx] = { ...newSet[idx], status: 'error', error: error || "Failed" };
                             return { ...h, imageSet: newSet };
                         }
                    }
                    return h;
                }));
            }
        } catch (e: any) {
            setAppStatus({ status: 'error', error: e.message });
             setHistory(prev => prev.map(h => {
                    if (h.id === genId) {
                         const idx = h.imageSet.findIndex((s: any) => s.sceneId === newSceneId);
                         if (idx !== -1) {
                             const newSet = [...h.imageSet];
                             newSet[idx] = { ...newSet[idx], status: 'error', error: e.message };
                             return { ...h, imageSet: newSet };
                         }
                    }
                    return h;
                }));
        } finally {
            setIsGenerating(false);
            setStatusMessage("");
        }
    };

    if (!isDataLoaded) {
        return <div className="flex h-screen items-center justify-center bg-gray-900 text-white"><LoaderIcon className="w-8 h-8 animate-spin" /></div>;
    }

    return (
        <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
            <div className={`${mobileTab === 'editor' ? 'flex' : 'hidden'} w-full md:flex md:w-80 flex-shrink-0 flex-col h-full border-r border-gray-800 pb-14 md:pb-0 relative z-10 bg-gray-900`}>
                <Sidebar 
                    prompt={prompt} setPrompt={setPrompt}
                    imageCount={imageCount} setImageCount={setImageCount}
                    aspectRatio={aspectRatio} setAspectRatio={setAspectRatio}
                    characterStyle={characterStyle} setCharacterStyle={setCharacterStyle}
                    visualStyle={visualStyle} setVisualStyle={setVisualStyle}
                    imageModel={imageModel} setImageModel={setImageModel}
                    characters={characters} setCharacters={setCharacters}
                    genre={genre} setGenre={setGenre}
                    onGenerate={() => handleGenerate(undefined, 'idea')} onStop={() => setIsGenerating(false)}
                    isGenerating={isGenerating} isDisabled={creditSettings.creditBalance <= 0}
                    appStatus={appStatus} statusMessage={statusMessage}
                    creditSettings={creditSettings} dailyCounts={dailyCounts}
                    onAddCredit={(amt) => setCreditSettings(p => ({ ...p, creditBalance: p.creditBalance + amt }))}
                    onResetCredit={() => setCreditSettings(p => ({ ...p, creditBalance: 0 }))}
                    onToggleCurrency={() => setCreditSettings(prev => ({ ...prev, currency: prev.currency === 'USD' ? 'SEK' : 'USD' }))}
                    exchangeRate={exchangeRate}
                    setShowStorybookPanel={() => setActiveModal('storybook')}
                    setShowHistoryPanel={() => setActiveModal('history')}
                    onAudioUpload={handleAudioUpload} isProcessingAudio={isProcessingAudio}
                    handleAnimateFromImages={handleAnimateFromImages}
                    handleBuildCharacterVisual={handleBuildCharacterVisual}
                    handleUploadNewCharacterImage={handleUploadNewCharacterImage}
                    handleCharacterImageUpload={handleCharacterImageUpload}
                    updateCharacter={(id, p) => setCharacters(prev => prev.map(c => c.id === id ? { ...c, ...p } : c))} 
                    removeCharacter={(id) => setCharacters(prev => prev.filter(c => c.id !== id))}
                    onPreviewImage={handleOpenImagePreview}
                />
            </div>
            
            <div className={`${mobileTab === 'storyboard' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 relative pb-14 md:pb-0 h-full`}>
                <Workspace 
                    generationItem={currentGeneration} savedItems={savedScenes}
                    onSaveScene={handleSaveScene} 
                    onEditScene={handleEditScene} 
                    onRegenerateScene={handleRegenerateScene}
                    onAngleSelect={handleAngleSelect} 
                    onOpenVideoCreator={handleToggleVideoCreator}
                    onGenerateVideo={handleGenerateVideo} onAddToTimeline={handleAddToTimeline}
                    onStop={() => setIsGenerating(false)} isGenerating={isGenerating} isDisabled={false}
                    activeVideoIndex={activeVideoIndex} videoModel={videoModel}
                    videoResolution={videoResolution}
                    setVideoModel={setVideoModel}
                    setVideoResolution={setVideoResolution}
                    onPreviewImage={handleOpenImagePreview}
                    onUploadStartImage={handleUploadStartImage}
                    onUploadToSession={handleUploadToSession}
                    storybook={storybook}
                    onDeleteScene={handleDeleteScene}
                    onNavigateHistory={handleNavigateHistory}
                    historyIndex={activeHistoryIndex}
                    totalHistoryItems={history.length}
                    currency={creditSettings.currency}
                    exchangeRate={exchangeRate}
                    onCloseSession={() => handleCloseSession(activeHistoryIndex)}
                    history={history}
                    onSwitchSession={handleSwitchSession}
                    onNewSession={handleNewSession}
                    onUpdateVideoDraft={handleUpdateVideoDraft}
                    creditBalance={creditSettings.creditBalance}
                />
                
                {timelineClips.length > 0 && (
                    <Timeline 
                        clips={timelineClips} 
                        onReorder={setTimelineClips} 
                        onDelete={(id) => setTimelineClips(p => p.filter(c => c.id !== id))}
                        onExtend={handleExtendClip}
                        onPlayAll={() => {}}
                    />
                )}
            </div>

            <Modals 
                activeModal={activeModal} setActiveModal={setActiveModal}
                modalData={modalData} onClose={() => setActiveModal(null)} onConfirm={() => {}}
                storybookContent={storybook} setStorybookContent={setStorybook}
                history={history} onLoadHistory={handleLoadHistory} onDeleteHistory={handleDeleteHistory}
                onClearHistory={handleClearHistory}
                onGenerateFromStorybook={(scenes: string[]) => handleGenerate(scenes, 'storybook')}
                characters={characters} 
                onEditImage={handleConfirmEdit}
                onApplyCameraAngle={handleConfirmAngle}
                costPerImage={currentCostPerImage} 
                currencySymbol={currencySymbol}
                exchangeRate={exchangeRate} 
                savedItems={savedScenes} 
                characterStyle={characterStyle}
                onToggleSave={handleToggleSaveCard}
                imageModel={imageModel}
                setImageModel={setImageModel}
            />

            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 md:hidden">
                <button 
                    onClick={() => setMobileTab(prev => prev === 'editor' ? 'storyboard' : 'editor')}
                    className="w-12 h-12 bg-indigo-600 rounded-full shadow-[0_0_15px_rgba(79,70,229,0.5)] flex items-center justify-center text-white border-2 border-indigo-400 hover:bg-indigo-500 transition-all active:scale-95"
                >
                    {mobileTab === 'editor' ? (
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 6v12a2.25 2.25 0 002.25 2.25zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
};

export default App;
