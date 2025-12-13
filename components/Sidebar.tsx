
import React, { useRef, useState, useEffect } from 'react';
import { CreditCardIcon, BookOpenIcon, HistoryIcon, MusicalNoteIcon, SparklesIcon, StopIcon, ClapperboardIcon, UploadIcon, XIcon, UserPlusIcon, PencilIcon, TrashIcon, CheckIcon, LoaderIcon } from './Icons';
import type { Character } from '../services/geminiService';

interface SidebarProps {
    prompt: string;
    setPrompt: (val: string) => void;
    imageCount: number;
    setImageCount: (val: number) => void;
    aspectRatio: string;
    setAspectRatio: (val: string) => void;
    characterStyle: string;
    setCharacterStyle: (val: string) => void;
    visualStyle: string;
    setVisualStyle: (val: string) => void;
    imageModel: string;
    setImageModel: (val: string) => void;
    genre: string;
    setGenre: (val: string) => void;
    characters: Character[];
    setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
    
    // Video settings moved to workspace, removed from here

    onGenerate: (source?: 'idea' | 'storybook') => void;
    onStop: () => void;
    isGenerating: boolean;
    isDisabled: boolean;
    appStatus: { status: string; error: string | null };
    statusMessage: string;
    creditSettings: { creditBalance: number; currency: 'USD' | 'SEK' };
    dailyCounts: { images: number; videos: number };
    onAddCredit: (amount: number, currency: 'USD' | 'SEK') => void;
    onResetCredit: () => void;
    onToggleCurrency: () => void;
    exchangeRate: number;
    setShowStorybookPanel: (val: boolean) => void;
    setShowHistoryPanel: (val: boolean) => void;
    onAudioUpload: (file: File) => void;
    isProcessingAudio: boolean;
    handleAnimateFromImages: (mode: 'start' | 'startEnd' | 'reference', images: any[], prompt: string) => void;
    handleBuildCharacterVisual: (id: number) => void;
    handleUploadNewCharacterImage: (file: File) => void;
    handleCharacterImageUpload: (file: File, id: number) => void;
    updateCharacter: (id: number, props: Partial<Character>) => void;
    removeCharacter: (id: number) => void;
    onPreviewImage: (src: string | null) => void;
}

export const Sidebar: React.FC<SidebarProps> = (props) => {
    const [isCreditAdderOpen, setIsCreditAdderOpen] = useState(false);
    const [creditToAdd, setCreditToAdd] = useState(50);
    const audioFileInputRef = useRef<HTMLInputElement>(null);
    
    // Video Mode State
    const [isVideoMode, setIsVideoMode] = useState(false);
    const [animationMode, setAnimationMode] = useState<'start' | 'startEnd' | 'reference'>('start');
    const [animationImages, setAnimationImages] = useState<({ base64: string; mimeType: string; file: File } | null)[]>([null, null, null]);
    const [animationPrompt, setAnimationPrompt] = useState('');
    const animateImageRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
    
    const uploadCharacterFileInputRef = useRef<HTMLInputElement>(null);
    const characterFileInputRef = useRef<HTMLInputElement>(null);
    const [uploadingCharId, setUploadingCharId] = useState<number | null>(null);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    
    // CONFIRMATION STATE
    const [isConfirming, setIsConfirming] = useState(false);
    const [isConfirmingAnimation, setIsConfirmingAnimation] = useState(false);

    // Ref for Credit Adder Click Outside
    const creditContainerRef = useRef<HTMLDivElement>(null);

    // Reset confirmation if parameters change
    useEffect(() => {
        setIsConfirming(false);
        setIsConfirmingAnimation(false);
    }, [props.imageCount, props.imageModel, props.prompt, props.aspectRatio, props.visualStyle, props.characterStyle, animationMode, animationImages]);

    // Click outside handler for Credit Adder
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (creditContainerRef.current && !creditContainerRef.current.contains(event.target as Node)) {
                setIsCreditAdderOpen(false);
            }
        };

        if (isCreditAdderOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isCreditAdderOpen]);

    const currencySymbol = props.creditSettings.currency === 'USD' ? '$' : 'kr';
    const displayCredit = props.creditSettings.creditBalance * props.exchangeRate;

    // Cost Calculation
    const costPerImageUSD = props.imageModel.includes('flash') ? 0.025 : 0.05;
    const estimatedCostUSD = props.imageCount * costPerImageUSD;
    const displayCost = props.creditSettings.currency === 'USD' 
        ? `$${estimatedCostUSD.toFixed(3)}` 
        : `${(estimatedCostUSD * props.exchangeRate).toFixed(2)}kr`;
    
    // Video Cost for Animation
    const videoCostUSD = 0.5;
    const displayVideoCost = props.creditSettings.currency === 'USD'
        ? `$${videoCostUSD.toFixed(2)}`
        : `${(videoCostUSD * props.exchangeRate).toFixed(2)}kr`;

    const handleGenerateClick = () => {
        if (!props.prompt) return;
        
        if (!isConfirming) {
            setIsConfirming(true);
            return;
        }
        props.onGenerate();
        setIsConfirming(false);
    };

    const handleAnimationImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const result = ev.target?.result as string;
            const base64 = result.split(',')[1];
            const newImages = [...animationImages];
            newImages[index] = { base64, mimeType: file.type, file };
            setAnimationImages(newImages);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleGenerateAnimation = () => {
        if (!isConfirmingAnimation) {
            setIsConfirmingAnimation(true);
            return;
        }
        props.handleAnimateFromImages(animationMode, animationImages, animationPrompt);
        setIsConfirmingAnimation(false);
    };

    const handleQuickAddCharacter = (name: string) => {
        if (textAreaRef.current) {
            const start = textAreaRef.current.selectionStart;
            const end = textAreaRef.current.selectionEnd;
            const text = props.prompt;
            const before = text.substring(0, start);
            const after = text.substring(end, text.length);
            // Insert name with a space after
            const insertion = `${name} `;
            const newText = before + insertion + after;
            props.setPrompt(newText);
            
            // Need to set timeout to allow React render cycle to complete before setting cursor
            setTimeout(() => {
                if (textAreaRef.current) {
                    textAreaRef.current.focus();
                    const newCursor = start + insertion.length;
                    textAreaRef.current.setSelectionRange(newCursor, newCursor);
                }
            }, 0);
        } else {
            const currentPrompt = props.prompt || '';
            if (!currentPrompt.includes(name)) {
                props.setPrompt((currentPrompt + " " + name).trim());
            }
        }
    };

    return (
        <aside className="w-full h-full bg-gray-900 border-r border-gray-800 flex flex-col font-sans text-gray-300 overflow-hidden">
            {/* FIXED HEADER */}
            <div className="shrink-0 p-4 border-b border-gray-800 bg-gray-900 z-10">
                <div className="flex items-center justify-between mb-3">
                    <h1 className="text-xl font-bold text-indigo-400 tracking-tight">Story Weaver</h1>
                    
                    {/* Credits */}
                    <div className="relative flex items-center gap-2" ref={creditContainerRef}>
                        <button onDoubleClick={props.onToggleCurrency} className="text-[10px] font-bold text-gray-500 hover:text-white uppercase transition-colors select-none" title="Double click to switch Currency">
                            {props.creditSettings.currency}
                        </button>
                        <button onDoubleClick={() => setIsCreditAdderOpen(!isCreditAdderOpen)} className="flex items-center gap-1 bg-gray-800 px-2 py-1 rounded-full border border-gray-700 hover:border-indigo-500 transition-colors select-none" title="Double click to add credits">
                            <CreditCardIcon className={`w-3 h-3 ${displayCredit > 0 ? 'text-green-400' : 'text-yellow-400'}`} />
                            <span className="text-xs font-bold text-white">{currencySymbol}{displayCredit.toFixed(2)}</span>
                        </button>
                        {isCreditAdderOpen && (
                            <div className="absolute top-full right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 z-50">
                                <h3 className="text-xs font-bold text-gray-400 mb-2 uppercase">Add Credits ({props.creditSettings.currency})</h3>
                                <div className="flex gap-2 mb-2">
                                    <input type="number" value={creditToAdd} onChange={e => setCreditToAdd(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-xs text-white" />
                                    <button onClick={() => { props.onAddCredit(creditToAdd / props.exchangeRate, props.creditSettings.currency); setIsCreditAdderOpen(false); }} className="bg-indigo-600 text-white px-3 rounded text-xs font-bold">Add</button>
                                </div>
                                <button onClick={() => { props.onResetCredit(); setIsCreditAdderOpen(false); }} className="w-full text-center text-[10px] text-red-400 hover:text-red-300">Reset Balance</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Navigation Buttons */}
                <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => props.setShowStorybookPanel(true)} className="flex items-center justify-center gap-2 py-1.5 bg-indigo-900/30 border border-indigo-500/30 text-indigo-200 text-xs font-bold rounded hover:bg-indigo-900/50 transition-colors">
                        <BookOpenIcon className="w-3.5 h-3.5" /> Storybook
                    </button>
                    <button onClick={() => props.setShowHistoryPanel(true)} className="flex items-center justify-center gap-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold rounded border border-gray-700 transition-colors">
                        <HistoryIcon className="w-3.5 h-3.5" /> History
                    </button>
                </div>
            </div>

            {/* SCROLLABLE CONTENT AREA */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                
                {/* 1. Main Prompt / Animation Section */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        {/* MODE TOGGLE */}
                        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setIsVideoMode(!isVideoMode)}>
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${isVideoMode ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 bg-gray-800 group-hover:border-gray-500'}`}>
                                {isVideoMode && <CheckIcon className="w-3 h-3 text-white" />}
                            </div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none group-hover:text-gray-300 transition-colors">
                                {isVideoMode ? "Animate from Image" : "Story Idea"}
                            </label>
                        </div>

                        {/* AUDIO UPLOAD BUTTON - Only visible in Story Idea mode */}
                        {!isVideoMode && (
                            <button 
                                onClick={() => audioFileInputRef.current?.click()} 
                                disabled={props.isProcessingAudio} 
                                className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                            >
                                {props.isProcessingAudio ? <LoaderIcon className="w-3 h-3 animate-spin"/> : <MusicalNoteIcon className="w-3 h-3"/>} 
                                {props.isProcessingAudio ? 'Transcribing...' : 'Upload Audio'}
                            </button>
                        )}
                        <input 
                            type="file" 
                            ref={audioFileInputRef} 
                            className="hidden" 
                            onChange={(e) => { 
                                if (e.target.files?.[0]) {
                                    props.onAudioUpload(e.target.files[0]);
                                    e.target.value = '';
                                } 
                            }} 
                            accept="audio/*" 
                        />
                    </div>

                    {isVideoMode ? (
                        // --- VIDEO GENERATION MODE ---
                        <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-right-4 duration-300">
                             {/* Tabs */}
                             <div className="flex gap-1 bg-gray-800 p-1 rounded">
                                {['start', 'startEnd', 'reference'].map(mode => (
                                    <button key={mode} onClick={() => setAnimationMode(mode as any)} className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-colors ${animationMode === mode ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:bg-gray-700'}`}>
                                        {mode === 'start' ? 'Start' : mode === 'startEnd' ? 'Start/End' : 'Reference'}
                                    </button>
                                ))}
                            </div>

                            {/* Upload Grid */}
                            <div className="grid grid-cols-3 gap-2">
                                {[0, 1, 2].map(idx => {
                                    let show = (animationMode === 'start' && idx === 0) || (animationMode === 'startEnd' && idx < 2) || (animationMode === 'reference');
                                    return (
                                        <div key={idx} className={`relative group aspect-square ${!show ? 'opacity-20 pointer-events-none grayscale' : ''}`}>
                                            <input type="file" ref={animateImageRefs[idx]} className="hidden" accept="image/*" onChange={(e) => handleAnimationImageUpload(e, idx)} />
                                            <button 
                                                onClick={() => {
                                                    if (animationImages[idx]) {
                                                        props.onPreviewImage(`data:${animationImages[idx]?.mimeType};base64,${animationImages[idx]?.base64}`);
                                                    } else {
                                                        animateImageRefs[idx].current?.click();
                                                    }
                                                }} 
                                                className="w-full h-full bg-gray-800 border border-dashed border-gray-600 rounded flex items-center justify-center overflow-hidden hover:border-gray-400 transition-colors"
                                                disabled={!show}
                                            >
                                                {animationImages[idx] ? (
                                                    <img src={`data:${animationImages[idx]?.mimeType};base64,${animationImages[idx]?.base64}`} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="flex flex-col items-center gap-1">
                                                        <UploadIcon className="w-4 h-4 text-gray-500" />
                                                        <span className="text-[8px] text-gray-600 font-bold uppercase">{idx === 0 ? 'Start' : idx === 1 ? (animationMode === 'reference' ? 'Ref 1' : 'End') : 'Ref 2'}</span>
                                                    </div>
                                                )}
                                            </button>
                                            
                                            {animationImages[idx] && show && (
                                                <>
                                                    <button onClick={() => { const n = [...animationImages]; n[idx] = null; setAnimationImages(n); }} className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full shadow-sm z-10"><XIcon className="w-2.5 h-2.5" /></button>
                                                    <button onClick={() => animateImageRefs[idx].current?.click()} className="absolute bottom-1 right-1 p-0.5 bg-gray-700 text-white rounded shadow-sm z-10 hover:bg-gray-600"><PencilIcon className="w-2.5 h-2.5" /></button>
                                                </>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                            
                            {/* Prompt */}
                            <textarea 
                                value={animationPrompt} 
                                onChange={e => setAnimationPrompt(e.target.value)} 
                                placeholder={animationMode === 'reference' ? "Describe the video to generate..." : "Describe movement (e.g. 'Camera pans right')..."} 
                                className="w-full h-20 p-2 bg-black/20 border border-gray-700 rounded text-xs resize-none focus:border-indigo-500 focus:outline-none text-gray-300 placeholder-gray-600" 
                            />
                        </div>
                    ) : (
                        // --- STORY IDEA MODE ---
                        <>
                             {/* Quick Select Chips - Always Visible if characters exist */}
                            {props.characters.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pb-1">
                                    {props.characters.map(c => (
                                        <button 
                                            key={c.id} 
                                            onClick={() => handleQuickAddCharacter(c.name)} 
                                            className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 bg-gray-800 rounded-full border border-gray-700 hover:border-indigo-500 hover:text-indigo-300 transition-all group"
                                            title={`Insert ${c.name} at cursor`}
                                        >
                                            {c.imagePreview ? 
                                                <img src={c.imagePreview} className="w-4 h-4 rounded-full object-cover" /> : 
                                                <div className="w-4 h-4 rounded-full bg-indigo-900 flex items-center justify-center text-[8px] font-bold text-indigo-300">{c.name.charAt(0)}</div>
                                            }
                                            <span className="text-[10px] font-medium text-gray-300 group-hover:text-indigo-200">{c.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            <textarea 
                                ref={textAreaRef}
                                value={props.prompt} 
                                onChange={(e) => props.setPrompt(e.target.value)} 
                                placeholder="Describe your scene... (Click 'Upload Audio' to speak your story)" 
                                className="w-full h-24 p-3 bg-black/20 border border-gray-700 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm text-gray-200 placeholder-gray-600 resize-none transition-all" 
                            />
                        </>
                    )}

                    {/* SHARED GENERATE BUTTON */}
                    <div className="pt-2">
                        {(isConfirming || isConfirmingAnimation) && !props.isGenerating && (
                            <div className="mb-2 bg-gray-800 rounded p-2 text-center border border-gray-700 animate-in fade-in slide-in-from-bottom-2">
                                <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400">
                                    <span>Est. Cost: <span className="text-white font-bold">{isVideoMode ? displayVideoCost : displayCost}</span></span>
                                    <span className="text-gray-600">|</span>
                                    <div className="flex items-center gap-1">
                                        <span>Model:</span>
                                        {isVideoMode ? (
                                             <span className="text-indigo-400 font-bold">Veo</span>
                                        ) : (
                                            <select 
                                                value={props.imageModel} 
                                                onChange={(e) => props.setImageModel(e.target.value)} 
                                                className="bg-transparent text-indigo-400 font-bold focus:outline-none cursor-pointer text-[10px] p-0 border-none ring-0 appearance-none hover:text-indigo-300"
                                            >
                                                <option value="gemini-2.5-flash-image">Flash (Fast)</option>
                                                <option value="gemini-3-pro-image-preview">Pro (Quality)</option>
                                            </select>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {props.isGenerating ? (
                            <button onClick={props.onStop} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded shadow-lg flex justify-center items-center gap-2 transition-all">
                                <StopIcon className="w-5 h-5" /> Stop
                            </button>
                        ) : (
                            <button 
                                onClick={isVideoMode ? handleGenerateAnimation : handleGenerateClick} 
                                disabled={props.isDisabled || (isVideoMode ? !animationImages[0] : !props.prompt)} 
                                className={`w-full py-3 font-bold rounded shadow-lg flex justify-center items-center gap-2 transition-all ${
                                    (isVideoMode ? isConfirmingAnimation : isConfirming)
                                        ? 'bg-green-600 hover:bg-green-500 text-white' 
                                        : 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white'
                                }`}
                            >
                                {(isVideoMode ? isConfirmingAnimation : isConfirming) ? (
                                    <>Confirm & Generate</>
                                ) : (
                                    isVideoMode ? <><ClapperboardIcon className="w-5 h-5" /> Generate Video</> : <><SparklesIcon className="w-5 h-5" /> Generate</>
                                )}
                            </button>
                        )}
                        
                        {/* Status Messages */}
                        <div className="mt-2 min-h-[20px] text-center">
                            {props.appStatus.error && (
                                <p className="text-[10px] text-red-400 bg-red-900/20 py-1 px-2 rounded inline-block">{props.appStatus.error}</p>
                            )}
                            {props.statusMessage && !props.appStatus.error && (
                                <p className="text-[10px] text-indigo-400 animate-pulse">{props.statusMessage}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* 2. Character List Section */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-gray-800 pb-1">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Characters</h3>
                        <button 
                            onClick={() => uploadCharacterFileInputRef.current?.click()} 
                            className="flex items-center gap-1 text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors"
                        >
                            <UploadIcon className="w-3 h-3" /> New
                        </button>
                        <input 
                            type="file" 
                            ref={uploadCharacterFileInputRef} 
                            className="hidden" 
                            accept="image/*" 
                            onChange={(e) => {
                                if (e.target.files?.[0]) {
                                    props.handleUploadNewCharacterImage(e.target.files[0]);
                                    e.target.value = '';
                                }
                            }} 
                        />
                    </div>

                    <div className="space-y-2">
                        {props.characters.length === 0 && (
                            <div className="p-4 border border-dashed border-gray-700 rounded text-center">
                                <p className="text-xs text-gray-500">No characters yet.</p>
                                <p className="text-[10px] text-gray-600">Upload an image to maintain consistency.</p>
                            </div>
                        )}
                        {props.characters.map(c => (
                            <div key={c.id} className="bg-gray-800 rounded border border-gray-700 p-2 flex gap-3 group hover:border-gray-600 transition-colors">
                                {/* Character Image */}
                                <div className="relative w-12 h-12 shrink-0 group/image">
                                    <div 
                                        className="w-full h-full rounded overflow-hidden bg-gray-900 cursor-pointer relative border border-gray-600"
                                        onClick={() => c.imagePreview ? props.onPreviewImage(c.imagePreview) : null}
                                        title="Click to view image"
                                    >
                                        {c.imagePreview ? (
                                            <img src={c.imagePreview} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                <UserPlusIcon className="w-5 h-5" />
                                            </div>
                                        )}
                                        {c.imagePreview && <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
                                            {/* Invisible clickable area for zoom, but allows hover effect */}
                                        </div>}
                                    </div>
                                    {/* Separate Edit Button */}
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); setUploadingCharId(c.id); characterFileInputRef.current?.click(); }}
                                        className="absolute -bottom-1 -right-1 p-1 bg-gray-700 border border-gray-600 rounded-full hover:bg-indigo-600 text-gray-300 hover:text-white shadow-md z-10"
                                        title="Replace Image"
                                    >
                                        <PencilIcon className="w-2.5 h-2.5" />
                                    </button>
                                </div>

                                {/* Character Info */}
                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div className="flex items-start justify-between">
                                        <input 
                                            value={c.name} 
                                            onChange={e => props.updateCharacter(c.id, { name: e.target.value })} 
                                            className="bg-transparent text-xs font-bold text-gray-200 focus:outline-none w-full placeholder-gray-600" 
                                            placeholder="Character Name"
                                        />
                                        <button onClick={() => props.removeCharacter(c.id)} className="text-gray-600 hover:text-red-400 ml-2">
                                            <TrashIcon className="w-3 h-3" />
                                        </button>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 mt-1">
                                         <button 
                                            onClick={() => props.handleBuildCharacterVisual(c.id)} 
                                            disabled={c.isDescribing || props.isDisabled} 
                                            className="flex-1 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[9px] text-gray-300 flex items-center justify-center gap-1 transition-colors border border-gray-600"
                                            title="Generate a consistent visual from description"
                                        >
                                            {c.isDescribing ? <LoaderIcon className="w-2.5 h-2.5 animate-spin"/> : <SparklesIcon className="w-2.5 h-2.5"/>}
                                            {c.imagePreview ? "Regenerate" : "Generate Visual"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    {/* Empty Slot Button */}
                    <button 
                        onClick={() => props.setCharacters([...props.characters, { id: Date.now(), name: 'New Character', imagePreview: null, originalImageBase64: null, originalImageMimeType: null, description: '', detectedImageStyle: null, isDescribing: false }])} 
                        className="w-full py-1.5 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded border border-transparent hover:border-gray-700 transition-all"
                    >
                        + Add Empty Slot
                    </button>
                    
                    <input 
                        type="file" 
                        ref={characterFileInputRef} 
                        className="hidden" 
                        accept="image/*" 
                        onChange={(e) => {
                            if (e.target.files?.[0] && uploadingCharId) {
                                props.handleCharacterImageUpload(e.target.files[0], uploadingCharId);
                                e.target.value = '';
                            }
                        }} 
                    />
                </div>

                {/* 3. Settings - Image Settings */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                        <label className="text-[9px] font-bold text-gray-500 uppercase">Scenes</label>
                        <input type="number" value={props.imageCount} onChange={e => props.setImageCount(Number(e.target.value))} className="w-full bg-black/20 border border-gray-700 rounded p-1.5 text-xs text-gray-300 focus:border-indigo-500" min="1" max="10" />
                    </div>
                    <div>
                        <label className="text-[9px] font-bold text-gray-500 uppercase">Ratio</label>
                        <select value={props.aspectRatio} onChange={e => props.setAspectRatio(e.target.value)} className="w-full bg-black/20 border border-gray-700 rounded p-1.5 text-xs text-gray-300 focus:border-indigo-500">
                            <option>16:9</option><option>9:16</option><option>1:1</option>
                        </select>
                    </div>
                    {/* Art Style and Character Type on the same row */}
                    <div>
                        <label className="text-[9px] font-bold text-gray-500 uppercase">Art Style</label>
                        <select value={props.visualStyle} onChange={e => props.setVisualStyle(e.target.value)} className="w-full bg-black/20 border border-gray-700 rounded p-1.5 text-xs text-gray-300 focus:border-indigo-500">
                            <option>3D Render</option>
                            <option>Realistic Photo</option>
                            <option>Illustration</option>
                            <option>Anime</option>
                            <option>2D Flat</option>
                            <option>Oil Painting</option>
                            <option>Pixel Art</option>
                            <option>Watercolor</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[9px] font-bold text-gray-500 uppercase">Character Type</label>
                        <select value={props.characterStyle} onChange={e => props.setCharacterStyle(e.target.value)} className="w-full bg-black/20 border border-gray-700 rounded p-1.5 text-xs text-gray-300 focus:border-indigo-500">
                            <option value="General">General</option>
                            <option value="Afro-toon">Afro-toon (Specialized)</option>
                        </select>
                    </div>
                </div>
            </div>
        </aside>
    );
};