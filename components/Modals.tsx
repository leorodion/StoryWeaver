
import React, { useState, useRef, useEffect } from 'react';
import { 
    XIcon, BookOpenIcon, SparklesIcon, LoaderIcon, CheckIcon, ClipboardIcon, 
    LockClosedIcon, LockOpenIcon, RefreshIcon, TrashIcon, 
    HistoryIcon, SaveIcon, PencilIcon, CameraIcon, PaintBrushIcon, EraserIcon
} from './Icons';
import { 
    generateStructuredStory, generateScenesFromNarrative, regenerateSceneVisual, 
    CAMERA_ANGLE_OPTIONS
} from '../services/geminiService';
import type { Character, Storybook } from '../services/geminiService';

interface ModalsProps {
    activeModal: string | null;
    setActiveModal: (modal: string | null) => void;
    modalData: any;
    onClose: () => void;
    onConfirm: () => void;
    
    // Storybook
    storybookContent: Storybook;
    setStorybookContent: (data: Storybook) => void;
    onGenerateFromStorybook: (scenes: string[]) => void;
    
    // History
    history: any[];
    onLoadHistory: (index: number) => void;
    onDeleteHistory: (index: number) => void;
    onClearHistory: () => void;
    
    // General
    characters: Character[];
    
    // Edit/Camera
    onEditImage: (prompt: string, mask?: string, style?: string, refImage?: string | null) => void;
    onApplyCameraAngle: (angle: string, subject?: string) => void;
    
    // Economics
    costPerImage: number;
    currencySymbol: string;
    exchangeRate: number;
    
    // Saved Items
    savedItems: any[];
    characterStyle: string;
    onToggleSave: (card: any) => void;

    imageModel?: string;
    setImageModel?: (val: string) => void;
}

export const Modals: React.FC<ModalsProps> = ({
    activeModal,
    modalData,
    onClose, 
    storybookContent,
    setStorybookContent,
    onGenerateFromStorybook,
    history,
    onLoadHistory,
    onDeleteHistory,
    onClearHistory,
    characters, 
    onEditImage,
    onApplyCameraAngle,
    costPerImage,
    currencySymbol,
    exchangeRate,
    savedItems,
    characterStyle,
    onToggleSave,
}) => {
    // State for Storybook
    const [creationMode, setCreationMode] = useState<'ai' | 'paste'>('ai');
    const [title, setTitle] = useState('');
    const [characterNames, setCharacterNames] = useState('');
    const [prompt, setPrompt] = useState('');
    const [selectedStoryGenre, setSelectedStoryGenre] = useState('Sci-Fi');
    const [selectedMovieStyle, setSelectedMovieStyle] = useState('Nollywood');
    const [includeDialogue, setIncludeDialogue] = useState(true);
    const [isGeneratingStory, setIsGeneratingStory] = useState(false);
    
    const [pastedNarrative, setPastedNarrative] = useState('');
    const [enhanceWithDialogue, setEnhanceWithDialogue] = useState(false);
    
    const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
    const [confirmingSceneIndex, setConfirmingSceneIndex] = useState<number | null>(null);
    const [showCostConfirmation, setShowCostConfirmation] = useState(false);

    // State for Camera Angle
    const [selectedAngle, setSelectedAngle] = useState('');
    const [focusSubject, setFocusSubject] = useState('');

    // State for Edit Image
    const [editPrompt, setEditPrompt] = useState('');
    const [brushSize, setBrushSize] = useState(20);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageContainerRef = useRef<HTMLDivElement>(null);

    // Setup Canvas for Editing
    useEffect(() => {
        if (activeModal === 'edit-image' && canvasRef.current && imageContainerRef.current) {
            const canvas = canvasRef.current;
            const container = imageContainerRef.current;
            
            const resizeCanvas = () => {
                const rect = container.getBoundingClientRect();
                canvas.width = rect.width;
                canvas.height = rect.height;
            };
            
            setTimeout(resizeCanvas, 100);
            window.addEventListener('resize', resizeCanvas);
            return () => window.removeEventListener('resize', resizeCanvas);
        }
    }, [activeModal, modalData]);

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDrawing(true);
        draw(e);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.beginPath(); // Reset path
        }
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;
        
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        
        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(255, 100, 100, 1)'; // Solid red internally
        }

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    const handleConfirmEditWithMask = () => {
        let maskBase64: string | undefined = undefined;
        
        if (canvasRef.current) {
            const sourceCanvas = canvasRef.current;
            
            const ctx = sourceCanvas.getContext('2d');
            const pixelData = ctx?.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
            const hasDrawing = pixelData?.some(channel => channel !== 0);

            if (hasDrawing) {
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = sourceCanvas.width;
                maskCanvas.height = sourceCanvas.height;
                const mCtx = maskCanvas.getContext('2d');
                if (mCtx) {
                    mCtx.fillStyle = '#000000';
                    mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                    mCtx.drawImage(sourceCanvas, 0, 0);
                    mCtx.globalCompositeOperation = 'source-in';
                    mCtx.fillStyle = '#FFFFFF';
                    mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                    mCtx.globalCompositeOperation = 'destination-over';
                    mCtx.fillStyle = '#000000';
                    mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                    maskBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
                }
            }
        }
        
        onEditImage(editPrompt, maskBase64);
    };

    // Handlers for Storybook
    const toggleCharacterInList = (name: string) => {
        const current = characterNames.split(', ').filter(s => s.trim());
        if (current.includes(name)) {
            setCharacterNames(current.filter(n => n !== name).join(', '));
        } else {
            setCharacterNames([...current, name].join(', '));
        }
    };

    const getSelectedCharacters = () => {
        const namesArray = characterNames.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        return characters.filter(c => namesArray.includes(c.name.toLowerCase()));
    };

    const handleCreateStory = async () => {
        setIsGeneratingStory(true);
        try {
            const selectedChars = getSelectedCharacters();
            const res = await generateStructuredStory(prompt, title, selectedChars, includeDialogue, characterStyle, selectedStoryGenre, selectedMovieStyle);
            setStorybookContent({
                title: title,
                characters: characterNames.split(',').map(s => s.trim()).filter(s => s),
                storyNarrative: res.storyNarrative,
                scenes: res.scenes
            });
        } catch (e) {
            console.error(e);
        } finally {
            setIsGeneratingStory(false);
        }
    };

    const handleProcessPastedStory = async () => {
        setIsGeneratingStory(true);
        try {
            const selectedChars = getSelectedCharacters();
            const scenes = await generateScenesFromNarrative(pastedNarrative, selectedChars, enhanceWithDialogue, characterStyle, selectedMovieStyle);
            setStorybookContent({
                title: title,
                characters: characterNames.split(',').map(s => s.trim()).filter(s => s),
                storyNarrative: pastedNarrative,
                scenes: scenes
            });
        } catch (e) {
             console.error(e);
        } finally {
            setIsGeneratingStory(false);
        }
    };
    
    const handleGenerateScenes = async () => {
         setIsGeneratingScenes(true);
         try {
            const currentNames = storybookContent.characters;
            const fullChars = characters.filter(c => currentNames.includes(c.name));
            
            const scenes = await generateScenesFromNarrative(storybookContent.storyNarrative, fullChars, true, characterStyle, selectedMovieStyle);
            setStorybookContent({ ...storybookContent, scenes });
         } catch(e) { console.error(e); }
         finally { setIsGeneratingScenes(false); }
    };

    const handleRegenerateVisual = async (index: number) => {
        try {
            const scene = storybookContent.scenes[index];
            const currentNames = storybookContent.characters;
            const fullChars = characters.filter(c => currentNames.includes(c.name));
            
            const newDesc = await regenerateSceneVisual(scene.script, fullChars);
            const newScenes = [...storybookContent.scenes];
            newScenes[index] = { ...newScenes[index], imageDescription: newDesc };
            setStorybookContent({...storybookContent, scenes: newScenes});
        } catch(e) { console.error(e); }
    };

    const copyToClipboard = (text: string) => {
        if(navigator.clipboard) navigator.clipboard.writeText(text);
    };

    const totalScenes = storybookContent.scenes.length;
    const totalCost = totalScenes * costPerImage * exchangeRate;
    const totalCostDisplay = currencySymbol + totalCost.toFixed(2);

    if (!activeModal) return null;

    if (activeModal === 'image-preview') {
         return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
                <div className="relative max-w-5xl max-h-full" onClick={e => e.stopPropagation()}>
                    <button onClick={onClose} className="absolute -top-10 right-0 text-white hover:text-gray-300"><XIcon className="w-8 h-8"/></button>
                    <img src={modalData.src} className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl" />
                </div>
            </div>
         );
    }

    if (activeModal === 'history') {
         const displayedHistory = [...history].reverse();

         return (
            <div className="fixed inset-0 z-[100] flex justify-end" onClick={onClose}>
                 <div className="w-full md:w-96 h-full bg-gray-900 border-l border-gray-700 shadow-2xl flex flex-col animate-in slide-in-from-right" onClick={e => e.stopPropagation()}>
                     <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                         <h2 className="font-bold text-white flex items-center gap-2"><HistoryIcon className="w-5 h-5"/> History</h2>
                         <button onClick={onClose}><XIcon className="w-5 h-5 text-gray-500"/></button>
                     </div>
                     <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {displayedHistory.length === 0 && <p className="text-gray-500 text-center text-sm py-8">No history yet.</p>}
                        
                        {displayedHistory.map((session: any) => (
                            <div key={session.id} className="bg-gray-800 rounded border border-gray-700 p-3 group">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="text-sm font-bold text-gray-200 line-clamp-1">{session.prompt}</h3>
                                    <div className="flex gap-1">
                                        <button 
                                            onClick={() => onLoadHistory(history.findIndex(h => h.id === session.id))} 
                                            className="text-xs text-indigo-400 hover:text-indigo-300"
                                        >
                                            Open
                                        </button>
                                        <button onClick={() => onDeleteHistory(history.findIndex(h => h.id === session.id))} className="text-gray-600 hover:text-red-400"><TrashIcon className="w-3 h-3"/></button>
                                    </div>
                                </div>
                                <div className="flex gap-1 overflow-x-auto pb-1">
                                    {session.imageSet.map((s: any, i: number) => {
                                        const uniqueId = `${session.id}-${s.sceneId}`;
                                        const isSaved = savedItems.some(saved => saved.id === uniqueId || saved.id === s.sceneId);
                                        
                                        return (
                                            <div key={i} className="relative w-16 h-9 bg-gray-900 rounded shrink-0 overflow-hidden group/img">
                                                {s.src && <img src={`data:image/png;base64,${s.src}`} className="w-full h-full object-cover" />}
                                                {isSaved && <div className="absolute top-0.5 right-0.5 text-indigo-400"><SaveIcon className="w-2.5 h-2.5"/></div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                     </div>
                     <div className="p-4 border-t border-gray-800">
                        <button onClick={onClearHistory} className="w-full py-2 text-xs text-red-400 hover:bg-red-900/20 rounded border border-red-900/0 hover:border-red-900/50">Clear Unsaved History</button>
                     </div>
                 </div>
            </div>
         );
    }
    
    if (activeModal === 'storybook') {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
                <div className="w-full max-w-4xl h-[90vh] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-4 border-b border-gray-800 flex justify-between items-center shrink-0">
                        <h2 className="font-bold text-white flex items-center gap-2"><BookOpenIcon className="w-5 h-5"/> Storybook Creator</h2>
                        <button onClick={onClose}><XIcon className="w-5 h-5 text-gray-500 hover:text-white"/></button>
                    </div>

                    <div className="flex-1 flex overflow-hidden">
                        <div className="w-2/5 p-4 overflow-y-auto border-r border-gray-800 space-y-4">
                            <div className="flex bg-gray-800 rounded-lg p-1">
                                <button onClick={() => setCreationMode('ai')} className={`flex-1 py-2 text-xs font-bold rounded-md ${creationMode === 'ai' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Generate from Idea</button>
                                <button onClick={() => setCreationMode('paste')} className={`flex-1 py-2 text-xs font-bold rounded-md ${creationMode === 'paste' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Paste Your Story</button>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400">Story Title</label>
                                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. The Last Starlight" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white"/>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400">Characters</label>
                                <div className="bg-gray-800 border border-gray-600 rounded p-2">
                                    <input value={characterNames} onChange={e => setCharacterNames(e.target.value)} placeholder="Comma-separated names" className="w-full bg-transparent text-sm text-white outline-none"/>
                                    {characters.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-700">
                                            {characters.map(c => <button key={c.id} onClick={() => toggleCharacterInList(c.name)} className={`px-2 py-0.5 text-[10px] rounded-full ${characterNames.includes(c.name) ? 'bg-indigo-500 text-white' : 'bg-gray-700 text-gray-300'}`}>{c.name}</button>)}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {creationMode === 'ai' ? (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-400">Story Prompt</label>
                                        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="A brave astronaut discovers a new planet..." className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white resize-none"/>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400">Genre</label>
                                            <select value={selectedStoryGenre} onChange={e => setSelectedStoryGenre(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm">
                                                <option>Sci-Fi</option><option>Fantasy</option><option>Drama</option><option>Comedy</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400">Cinematic Style</label>
                                            <select value={selectedMovieStyle} onChange={e => setSelectedMovieStyle(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm">
                                                <option>Nollywood</option><option>Hollywood</option><option>Bollywood</option><option>General</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 pt-2">
                                        <input type="checkbox" checked={includeDialogue} onChange={e => setIncludeDialogue(e.target.checked)} id="dialogue_check" />
                                        <label htmlFor="dialogue_check" className="text-sm text-gray-300">Include Dialogue</label>
                                    </div>
                                    <button onClick={handleCreateStory} disabled={isGeneratingStory} className="w-full py-2 bg-indigo-600 text-white font-bold rounded mt-2 disabled:bg-gray-700 flex items-center justify-center gap-2">
                                        {isGeneratingStory ? <><LoaderIcon className="w-4 h-4 animate-spin"/> Generating Story...</> : <><SparklesIcon className="w-4 h-4"/> Create Story</>}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-400">Your Narrative</label>
                                        <textarea value={pastedNarrative} onChange={e => setPastedNarrative(e.target.value)} rows={8} placeholder="Paste your full story here..." className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white resize-none"/>
                                    </div>
                                    <div className="flex items-center gap-2 pt-2">
                                        <input type="checkbox" checked={enhanceWithDialogue} onChange={e => setEnhanceWithDialogue(e.target.checked)} id="enhance_dialogue_check" />
                                        <label htmlFor="enhance_dialogue_check" className="text-sm text-gray-300">Enhance with Dialogue</label>
                                    </div>
                                    <button onClick={handleProcessPastedStory} disabled={isGeneratingStory} className="w-full py-2 bg-indigo-600 text-white font-bold rounded mt-2 disabled:bg-gray-700 flex items-center justify-center gap-2">
                                        {isGeneratingStory ? <><LoaderIcon className="w-4 h-4 animate-spin"/> Processing...</> : <><SparklesIcon className="w-4 h-4"/> Process Story</>}
                                    </button>
                                </>
                            )}
                        </div>

                        <div className="w-3/5 p-4 overflow-y-auto space-y-4">
                            {storybookContent.scenes.map((scene, index) => (
                                <div key={scene.id || index} className="bg-gray-800 p-3 rounded-lg border border-gray-700">
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="font-bold text-sm text-white">Scene {index + 1}</h4>
                                        <div className="flex gap-1">
                                            <button onClick={() => { copyToClipboard(scene.imageDescription); setConfirmingSceneIndex(index); setTimeout(() => setConfirmingSceneIndex(null), 1500); }} className="p-1 text-gray-400 hover:text-white"><ClipboardIcon className="w-4 h-4"/></button>
                                            <button onClick={() => handleRegenerateVisual(index)} className="p-1 text-gray-400 hover:text-white"><RefreshIcon className="w-4 h-4"/></button>
                                            {confirmingSceneIndex === index && <CheckIcon className="w-4 h-4 text-green-400"/>}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400">Visual</label>
                                            <textarea value={scene.imageDescription} onChange={(e) => { const newScenes = [...storybookContent.scenes]; newScenes[index].imageDescription = e.target.value; setStorybookContent({...storybookContent, scenes: newScenes}); }} rows={3} className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-gray-300 resize-none"/>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400">Script</label>
                                            <textarea value={scene.script} onChange={(e) => { const newScenes = [...storybookContent.scenes]; newScenes[index].script = e.target.value; setStorybookContent({...storybookContent, scenes: newScenes}); }} rows={3} className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-gray-300 resize-none"/>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {storybookContent.scenes.length === 0 && <div className="text-center text-gray-500 py-16">Your story scenes will appear here.</div>}
                        </div>
                    </div>

                    <div className="p-4 border-t border-gray-800 flex justify-between items-center shrink-0">
                        {storybookContent.scenes.length > 0 && (
                            <>
                                <button onClick={handleGenerateScenes} disabled={isGeneratingScenes} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                                    {isGeneratingScenes ? <LoaderIcon className="w-3 h-3 animate-spin"/> : <RefreshIcon className="w-3 h-3"/>} Regenerate All Scenes
                                </button>
                                <div className="flex items-center gap-4">
                                    {showCostConfirmation && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span>Total: {totalCostDisplay} ({totalScenes} scenes)</span>
                                            <button onClick={() => onGenerateFromStorybook(storybookContent.scenes.map(s => s.imageDescription))} className="px-3 py-1 bg-green-600 rounded text-white">Confirm</button>
                                            <button onClick={() => setShowCostConfirmation(false)} className="px-3 py-1 bg-gray-600 rounded">Cancel</button>
                                        </div>
                                    )}
                                    <button onClick={() => setShowCostConfirmation(true)} disabled={showCostConfirmation} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded disabled:bg-gray-700">Generate Storyboard</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (activeModal === 'camera-angles') {
        return (
             <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
                <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
                    <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                        <h2 className="font-bold text-white flex items-center gap-2"><CameraIcon className="w-5 h-5"/> Select Camera Angle</h2>
                        <button onClick={onClose}><XIcon className="w-5 h-5 text-gray-500"/></button>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            {CAMERA_ANGLE_OPTIONS.map(opt => (
                                <button key={opt.key} onClick={() => setSelectedAngle(opt.name)} className={`p-3 text-center rounded border transition-colors ${selectedAngle === opt.name ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 hover:border-gray-500'}`}>
                                    <p className="text-xs font-bold">{opt.name}</p>
                                    <p className="text-[10px] text-gray-400 mt-1">{opt.description}</p>
                                </button>
                            ))}
                        </div>
                        <input value={focusSubject} onChange={e => setFocusSubject(e.target.value)} placeholder="Optional: Focus subject (e.g., 'the hero')" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm mb-4"/>
                        <button onClick={() => onApplyCameraAngle(selectedAngle, focusSubject)} disabled={!selectedAngle} className="w-full py-2 bg-indigo-600 text-white font-bold rounded disabled:bg-gray-700">Apply Angle</button>
                    </div>
                </div>
             </div>
        );
    }
    
    if (activeModal === 'edit-image') {
        return (
             <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
                <div className="w-full max-w-4xl h-[90vh] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex" onClick={e => e.stopPropagation()}>
                    <div className="w-2/3 flex flex-col items-center justify-center p-4 relative" ref={imageContainerRef}>
                        <img src={`data:image/png;base64,${modalData.src}`} className="max-w-full max-h-full object-contain" />
                        <canvas 
                            ref={canvasRef}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70 cursor-crosshair"
                            onMouseDown={startDrawing}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onMouseMove={draw}
                            onTouchStart={startDrawing}
                            onTouchEnd={stopDrawing}
                            onTouchMove={draw}
                        />
                    </div>
                    <div className="w-1/3 border-l border-gray-800 flex flex-col p-4">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="font-bold text-white flex items-center gap-2"><PencilIcon className="w-5 h-5"/> Edit Image</h2>
                            <button onClick={onClose}><XIcon className="w-5 h-5 text-gray-500"/></button>
                        </div>
                        <div className="flex-1 space-y-4">
                            <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={5} placeholder="Describe your edit..." className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm resize-none"/>
                            
                            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700">
                                <h3 className="text-xs font-bold text-gray-400 mb-2">Masking (Optional)</h3>
                                <div className="flex gap-2 mb-3">
                                    <button onClick={() => setTool('brush')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs rounded ${tool === 'brush' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}><PaintBrushIcon className="w-4 h-4"/> Brush</button>
                                    <button onClick={() => setTool('eraser')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs rounded ${tool === 'eraser' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}><EraserIcon className="w-4 h-4"/> Eraser</button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-400">Size:</label>
                                    <input type="range" min="5" max="100" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="flex-1"/>
                                </div>
                                <button onClick={clearCanvas} className="w-full mt-3 text-xs text-red-400 hover:underline">Clear Mask</button>
                            </div>
                        </div>
                        <button onClick={handleConfirmEditWithMask} disabled={!editPrompt} className="w-full py-3 bg-indigo-600 text-white font-bold rounded disabled:bg-gray-700 mt-4">Generate Edit</button>
                    </div>
                </div>
             </div>
        );
    }


    return null;
};
