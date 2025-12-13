
import React, { useRef, useState, useEffect } from 'react';
import { DownloadIcon, RefreshIcon, BookmarkIcon, CameraIcon, SparklesIcon, VideoIcon, TrashIcon, PlusIcon, UploadIcon, ClapperboardIcon, XIcon, ExclamationTriangleIcon } from './Icons';
import { CAMERA_MOVEMENT_PROMPTS } from '../services/geminiService';

interface WorkspaceProps {
    generationItem: any;
    savedItems: any[];
    onSaveScene: (genId: number, sceneId: string) => void;
    onEditScene: (genId: number, sceneId: string) => void;
    onRegenerateScene: (genId: number, sceneId: string) => void;
    onAngleSelect: (genId: number, sceneId: string) => void;
    onDeleteScene?: (genId: number, sceneId: string) => void; 
    onOpenVideoCreator: (idx: number) => void;
    onGenerateVideo: (genId: number, sceneId: string, script?: string, cameraMovement?: string) => void;
    onAddToTimeline: (videoUrl: string, videoObject?: any) => void;
    onStop: () => void;
    isGenerating: boolean;
    isDisabled: boolean;
    activeVideoIndex: number;
    videoModel: string;
    videoResolution?: string;
    setVideoModel: (val: string) => void;
    setVideoResolution: (val: string) => void;
    onPreviewImage: (src: string | null) => void;
    onUploadStartImage?: (file: File) => void;
    onUploadToSession?: (file: File) => void;
    storybook?: any; 
    
    // Legacy Navigation Props
    onNavigateHistory: (direction: number) => void;
    historyIndex: number;
    totalHistoryItems: number;
    
    currency: 'USD' | 'SEK';
    exchangeRate: number;
    onCloseSession?: () => void;

    // Tab Props
    history: any[];
    onSwitchSession: (index: number) => void;
    onNewSession: () => void;
    onUpdateVideoDraft: (genId: number, sceneId: string, updates: any) => void;
    
    // Add credit check from parent
    creditBalance: number;
}

export const Workspace = React.memo((props: WorkspaceProps) => {
    const { generationItem, savedItems, history } = props;
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const addImageInputRef = useRef<HTMLInputElement>(null);
    
    // Local Error State for localized feedback
    const [videoError, setVideoError] = useState<string | null>(null);

    // Reset errors when switching active video creator
    useEffect(() => {
        setVideoError(null);
    }, [props.activeVideoIndex]);

    const handleImportScript = (idx: number, sceneId: string) => {
        if (props.storybook?.scenes && props.storybook.scenes[idx]) {
            props.onUpdateVideoDraft(generationItem.id, sceneId, { draftScript: props.storybook.scenes[idx].script || '' });
        }
    };

    const handleVideoGenerateClick = (genId: number, sceneId: string, script: string, movement: string) => {
        // Check credits locally to show error right here
        if (props.creditBalance < 0.5) {
            setVideoError(`Insufficient credits for video ($0.50). Balance: $${props.creditBalance.toFixed(2)}`);
            return;
        }
        setVideoError(null);
        props.onGenerateVideo(genId, sceneId, script, movement);
    };

    // Calculate dynamic video cost
    const videoCost = 0.5 * props.exchangeRate;
    const videoCostDisplay = props.currency === 'USD' ? `$${videoCost.toFixed(2)}` : `${videoCost.toFixed(2)}kr`;

    // Identify open sessions for Tabs
    const openSessions = history.map((h, i) => ({ ...h, originalIndex: i })).filter(h => !h.isClosed);
    const hasActiveUploadSession = history.some(h => !h.isClosed && h.type === 'upload');
    const isCurrentSessionUpload = generationItem?.type === 'upload';

    // Render Tab Bar Helper
    const renderTabBar = () => (
        <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-2 scrollbar-thin scrollbar-thumb-gray-700">
            {openSessions.map((session) => (
                <div 
                    key={session.id}
                    onClick={() => props.onSwitchSession(session.originalIndex)}
                    className={`
                        group flex items-center gap-2 px-3 py-2 rounded-t-lg cursor-pointer border-t border-l border-r border-transparent min-w-[120px] max-w-[200px]
                        ${props.historyIndex === session.originalIndex 
                            ? 'bg-gray-800 border-gray-700 text-white' 
                            : 'bg-gray-900/50 hover:bg-gray-800/80 text-gray-400 hover:text-gray-300'
                        }
                    `}
                >
                    <span className="text-xs font-bold truncate flex-1">{session.prompt || 'Untitled Session'}</span>
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            if (props.historyIndex === session.originalIndex && props.onCloseSession) {
                                props.onCloseSession();
                            } else {
                                props.onSwitchSession(session.originalIndex);
                            }
                        }}
                        className={`p-0.5 rounded-full hover:bg-red-900/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ${props.historyIndex === session.originalIndex ? 'opacity-100' : ''}`}
                    >
                        <XIcon className="w-3 h-3" />
                    </button>
                </div>
            ))}
            {!hasActiveUploadSession && (
                <button 
                    onClick={props.onNewSession}
                    className={`
                        flex items-center justify-center w-8 h-8 rounded hover:bg-gray-800 transition-colors
                        ${props.historyIndex === -1 ? 'bg-gray-800 text-white' : 'text-gray-500'}
                    `}
                    title="New Session"
                >
                    <PlusIcon className="w-4 h-4" />
                </button>
            )}
        </div>
    );

    if (!generationItem || generationItem.isClosed || props.historyIndex === -1) {
        return (
            <div className="flex-1 flex flex-col h-full relative">
                <div className="px-4 pt-2 border-b border-gray-800">
                    {renderTabBar()}
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 p-8 pb-32">
                    <div className="p-6 bg-gray-800 rounded-full mb-6 border border-gray-700 shadow-xl"><SparklesIcon className="w-16 h-16 text-indigo-500" /></div>
                    <h2 className="text-2xl font-bold text-gray-300 mb-2">Start Creating</h2>
                    <p className="max-w-md text-sm mb-8 text-gray-400">Use the sidebar to describe your scenes, or upload an image to start working immediately.</p>
                    {props.onUploadStartImage && (
                        <div className="flex flex-col items-center">
                            <button 
                                onClick={() => uploadInputRef.current?.click()}
                                className="flex flex-col items-center justify-center w-64 h-40 bg-gray-800 border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl group transition-all"
                            >
                                <UploadIcon className="w-8 h-8 text-gray-500 group-hover:text-indigo-400 mb-2 transition-colors" />
                                <span className="text-sm font-bold text-gray-400 group-hover:text-white">Upload Image to Start</span>
                                <span className="text-[10px] text-gray-600 mt-1">Supports PNG, JPG</span>
                            </button>
                            <input type="file" ref={uploadInputRef} className="hidden" accept="image/*" onChange={(e) => { if (e.target.files?.[0]) { props.onUploadStartImage!(e.target.files[0]); e.target.value = ''; }}} />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
             <div className="px-4 pt-2 border-b border-gray-800 shrink-0">
                {renderTabBar()}
            </div>

            <div className="flex-1 p-6 overflow-y-auto pb-40">
                <div className="flex justify-between items-start mb-6">
                    <div className="flex-1 mr-4">
                        <h2 className="text-lg font-bold text-white">Storyboard</h2>
                        <p className="text-xs text-gray-400 mt-1 max-w-lg truncate">{generationItem.prompt}</p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {props.onUploadToSession && isCurrentSessionUpload && (
                            <>
                                <button 
                                    onClick={() => addImageInputRef.current?.click()}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded hover:border-indigo-500 hover:text-indigo-400 text-gray-300 text-xs font-bold transition-all mr-2"
                                    title="Add an image to this session"
                                >
                                    <UploadIcon className="w-4 h-4" /> Add Image
                                </button>
                                <input type="file" ref={addImageInputRef} className="hidden" accept="image/*" onChange={(e) => { if (e.target.files?.[0]) { props.onUploadToSession!(e.target.files[0]); e.target.value = ''; }}} />
                            </>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
                    {generationItem.imageSet.map((scene: any, index: number) => {
                        if (scene.isHidden) return null;
                        const sceneId = scene.sceneId || `legacy-${index}`;
                        const isSaved = savedItems.some(i => i.id === `${generationItem.id}-${sceneId}` || (scene.originalSavedId && i.id === scene.originalSavedId));
                        const status = scene.status || (scene.isGenerating || scene.isRegenerating ? 'generating' : (scene.src ? 'complete' : (scene.error ? 'error' : 'pending')));
                        const videoState = generationItem.videoStates[index];
                        const draftScript = videoState.draftScript || '';
                        const draftMovement = videoState.draftCameraMovement || 'Zoom In (Focus In)';

                        return (
                            <div key={sceneId} className={`bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col ${scene.isCameraAngleFor !== undefined ? 'border-l-4 border-indigo-500' : ''}`}>
                                <div className="relative aspect-video bg-gray-900 flex items-center justify-center group overflow-hidden">
                                    {status === 'generating' ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-gray-900/80 backdrop-blur-sm border border-indigo-500/30 m-2 rounded-lg animate-pulse">
                                            <div className="w-12 h-12 rounded-full bg-indigo-900/50 flex items-center justify-center mb-2 animate-bounce"><SparklesIcon className="w-6 h-6 text-indigo-400" /></div>
                                            <p className="text-xs font-bold text-indigo-300">Generating...</p>
                                        </div>
                                    ) : status === 'pending' ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800/50 backdrop-blur-sm m-2 rounded-lg border border-gray-700/50">
                                             <div className="absolute inset-0 bg-gradient-to-br from-gray-800/10 to-gray-900/10 backdrop-blur-[2px]"></div>
                                             <div className="relative z-10 flex flex-col items-center opacity-60">
                                                <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center mb-2"><SparklesIcon className="w-5 h-5 text-gray-500" /></div>
                                                <span className="px-2 py-0.5 bg-gray-900/60 rounded text-[9px] font-bold text-gray-400 border border-gray-700/50">Waiting in Queue</span>
                                             </div>
                                        </div>
                                    ) : scene.src ? (
                                        <div className="w-full h-full cursor-zoom-in relative" onClick={() => props.onPreviewImage(`data:image/png;base64,${scene.src}`)} title="Click to zoom">
                                            <img src={`data:image/png;base64,${scene.src}`} className="w-full h-full object-contain" />
                                        </div>
                                    ) : (
                                        <div className="text-center text-red-400 p-4"><p className="text-xs">{scene.error || 'Failed'}</p></div>
                                    )}
                                    {scene.src && status === 'complete' && (
                                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                                            <a href={`data:image/png;base64,${scene.src}`} download={`scene_${index}.png`} className="p-1 bg-black/60 text-white rounded hover:bg-indigo-600 pointer-events-auto"><DownloadIcon className="w-4 h-4" /></a>
                                        </div>
                                    )}
                                </div>

                                <div className="p-3 flex-1 flex flex-col">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-[10px] font-bold rounded uppercase">{scene.angleName || `Scene ${index + 1}`}</span>
                                        <div className="flex gap-1">
                                            {status === 'complete' && (
                                                <>
                                                    <button onClick={() => props.onSaveScene(generationItem.id, sceneId)} className={`p-1.5 rounded hover:bg-gray-600 ${isSaved ? 'text-indigo-400' : 'text-gray-400'}`} title="Save"><BookmarkIcon className="w-4 h-4" solid={isSaved} /></button>
                                                    <button onClick={() => props.onAngleSelect(generationItem.id, sceneId)} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded" title="Camera"><CameraIcon className="w-4 h-4" /></button>
                                                    <button onClick={() => props.onEditScene(generationItem.id, sceneId)} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded" title="Edit"><SparklesIcon className="w-4 h-4" /></button>
                                                </>
                                            )}
                                            {(status === 'complete' || status === 'error') && (
                                                <button onClick={() => props.onRegenerateScene(generationItem.id, sceneId)} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded" title="Regenerate"><RefreshIcon className="w-4 h-4" /></button>
                                            )}
                                            <button onClick={() => props.onDeleteScene && props.onDeleteScene(generationItem.id, sceneId)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded ml-1" title="Delete"><TrashIcon className="w-4 h-4" /></button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 line-clamp-2 mb-3">{scene.prompt}</p>

                                    {status === 'complete' && (
                                        <button onClick={() => props.onOpenVideoCreator(index)} className={`w-full mt-auto flex items-center justify-center gap-2 py-2 rounded text-xs font-bold ${props.activeVideoIndex === index ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                                            <VideoIcon className="w-4 h-4" /> {props.activeVideoIndex === index ? 'Close Video Creator' : 'Create Video'}
                                        </button>
                                    )}

                                    {props.activeVideoIndex === index && (
                                        <div className="mt-2 pt-2 border-t border-gray-700 space-y-2 animate-in slide-in-from-top-2">
                                            {/* 1. Dialogue (Moved to Top) */}
                                            <div>
                                                <div className="flex justify-between items-center mb-0.5">
                                                    <label className="text-[9px] font-bold text-gray-400 uppercase">Narrator / Dialogue</label>
                                                    {props.storybook?.scenes?.[index] && (
                                                        <button onClick={() => handleImportScript(index, sceneId)} className="flex items-center gap-1 text-[8px] text-indigo-400 hover:text-indigo-300 font-bold"><SparklesIcon className="w-2.5 h-2.5" /> Import</button>
                                                    )}
                                                </div>
                                                <textarea 
                                                    value={draftScript} 
                                                    onChange={e => props.onUpdateVideoDraft(generationItem.id, sceneId, { draftScript: e.target.value })} 
                                                    placeholder="Narrator:..." 
                                                    className="w-full bg-black/30 border border-gray-600 rounded p-1.5 text-[10px] text-gray-200 focus:outline-none focus:border-indigo-500 resize-none h-12"
                                                />
                                            </div>

                                            {/* 2. Combined Settings Row: Camera | Model | Resolution */}
                                            <div className="flex items-end gap-1.5">
                                                <div className="flex-1 min-w-0">
                                                    <label className="text-[8px] font-bold text-gray-500 uppercase mb-0.5 block">Camera</label>
                                                    <div className="relative">
                                                        <select 
                                                            value={draftMovement} 
                                                            onChange={(e) => props.onUpdateVideoDraft(generationItem.id, sceneId, { draftCameraMovement: e.target.value })} 
                                                            className="w-full bg-black/30 border border-gray-600 rounded p-1 pr-5 text-[10px] text-gray-200 focus:outline-none focus:border-indigo-500 appearance-none truncate h-7"
                                                        >
                                                            {Object.keys(CAMERA_MOVEMENT_PROMPTS).map(key => (<option key={key} value={key}>{key}</option>))}
                                                        </select>
                                                        <ClapperboardIcon className="w-2.5 h-2.5 text-gray-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                                    </div>
                                                </div>
                                                
                                                <div className="flex gap-1 shrink-0">
                                                    <div className="flex flex-col">
                                                        <label className="text-[8px] font-bold text-gray-500 uppercase mb-0.5 block">Model</label>
                                                        <select 
                                                            value={props.videoModel} 
                                                            onChange={(e) => props.setVideoModel(e.target.value)} 
                                                            className="h-7 bg-black/30 text-[10px] text-gray-400 hover:text-white border border-gray-700 rounded px-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
                                                        >
                                                            <option value="veo-3.1-fast-generate-preview">Veo Fast</option>
                                                            <option value="veo-3.1-generate-preview">Veo HQ</option>
                                                        </select>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <label className="text-[8px] font-bold text-gray-500 uppercase mb-0.5 block">Res</label>
                                                        <select 
                                                            value={props.videoResolution} 
                                                            onChange={(e) => props.setVideoResolution(e.target.value)} 
                                                            className="h-7 bg-black/30 text-[10px] text-gray-400 hover:text-white border border-gray-700 rounded px-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
                                                        >
                                                            <option value="720p">720p</option>
                                                            <option value="1080p">1080p</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>

                                            {videoState.status === 'loading' ? (
                                                <div className="text-center py-1">
                                                    <p className="text-[10px] text-indigo-400 animate-pulse">{videoState.loadingMessage || 'Generating...'}</p>
                                                    <button onClick={props.onStop} className="mt-1 text-[9px] text-red-400 hover:text-red-300 underline">Cancel</button>
                                                </div>
                                            ) : (
                                                <>
                                                    <button 
                                                        onClick={() => handleVideoGenerateClick(generationItem.id, sceneId, draftScript, draftMovement)} 
                                                        disabled={props.isDisabled} 
                                                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded shadow-sm transition-colors"
                                                    >
                                                        Generate Clip
                                                    </button>
                                                    
                                                    {/* LOCAL ERROR DISPLAY - Shows right here under the button */}
                                                    {videoError && (
                                                        <div className="mt-2 p-1.5 bg-red-900/30 border border-red-800 rounded flex items-start gap-1.5 animate-in fade-in slide-in-from-top-1">
                                                            <ExclamationTriangleIcon className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                                                            <p className="text-[9px] text-red-300 text-left leading-tight">{videoError}</p>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            {videoState.status === 'error' && <p className="text-[9px] text-red-400 text-center">{videoState.error}</p>}
                                            {videoState.clips.length > 0 && (
                                                <div className="bg-black/30 rounded p-1.5 border border-gray-700">
                                                    <video src={videoState.clips[videoState.clips.length - 1].videoUrl} controls className="w-full rounded mb-1.5" />
                                                    <button onClick={() => props.onAddToTimeline(videoState.clips[videoState.clips.length - 1].videoUrl, videoState.clips[videoState.clips.length - 1].videoObject)} className="w-full py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-bold rounded flex items-center justify-center gap-1"><PlusIcon className="w-3 h-3" /> Add to Timeline</button>
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
    );
}, (prev, next) => {
    return prev.generationItem === next.generationItem &&
           prev.activeVideoIndex === next.activeVideoIndex &&
           prev.isGenerating === next.isGenerating &&
           prev.savedItems === next.savedItems &&
           prev.historyIndex === next.historyIndex && 
           prev.history === next.history &&
           prev.videoResolution === next.videoResolution &&
           prev.videoModel === next.videoModel &&
           prev.creditBalance === next.creditBalance; // Important for error check
});