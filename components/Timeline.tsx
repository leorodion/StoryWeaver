

import React, { useState, useRef, useEffect } from 'react';
import { PlayIcon, TrashIcon, ScissorsIcon, SparklesIcon, XIcon } from './Icons';

interface TimelineProps {
    clips: { id: string; url: string; duration: number; videoObject?: any; isLoading?: boolean }[];
    onReorder: (newClips: any[]) => void;
    onDelete: (id: string) => void;
    onExtend: (id: string, prompt: string) => void;
    onPlayAll: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({ clips, onReorder, onDelete, onExtend, onPlayAll }) => {
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [extendPrompt, setExtendPrompt] = useState('');
    const draggedItem = useRef<number | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to end when new clip adds
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
        }
    }, [clips.length]);

    const handleDragStart = (_e: React.DragEvent, index: number) => {
        draggedItem.current = index;
    };

    const handleDragEnter = (_e: React.DragEvent, index: number) => {
        if (draggedItem.current === null || draggedItem.current === index) return;
        const newClips = [...clips];
        const item = newClips.splice(draggedItem.current, 1)[0];
        newClips.splice(index, 0, item);
        draggedItem.current = index;
        onReorder(newClips);
    };

    const handleDragEnd = () => {
        draggedItem.current = null;
    };

    const handleExtendClick = () => {
        if (selectedClipId && extendPrompt.trim()) {
            onExtend(selectedClipId, extendPrompt);
            setExtendPrompt('');
            setSelectedClipId(null);
        }
    };
    
    const selectedClip = clips.find(c => c.id === selectedClipId);

    return (
        <div className="fixed bottom-0 left-0 right-0 h-24 bg-gray-900 border-t border-gray-700 flex z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
            {/* Left: Play All Control */}
            <div className="flex-shrink-0 w-20 flex items-center justify-center border-r border-gray-800 bg-gray-900 z-10">
                <button 
                    onClick={onPlayAll} 
                    disabled={clips.length === 0 || clips.some(c => c.isLoading)} 
                    className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 shadow-lg transition-transform active:scale-95 group"
                >
                    <PlayIcon className="w-6 h-6 ml-1 group-hover:scale-110 transition-transform" />
                </button>
            </div>

            {/* Middle: Clips Strip */}
            <div className="flex-1 relative flex items-center bg-black/20 overflow-hidden">
                <div 
                    ref={scrollContainerRef}
                    className="absolute inset-0 overflow-x-auto flex items-center px-4 gap-1.5 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
                >
                    {clips.map((clip, index) => (
                        <div 
                            key={clip.id} 
                            draggable={!clip.isLoading}
                            onDragStart={(e) => !clip.isLoading && handleDragStart(e, index)}
                            onDragEnter={(e) => !clip.isLoading && handleDragEnter(e, index)}
                            onDragEnd={handleDragEnd}
                            onClick={() => !clip.isLoading && setSelectedClipId(selectedClipId === clip.id ? null : clip.id)}
                            className={`
                                relative h-16 w-28 bg-gray-800 rounded-md overflow-hidden border cursor-pointer group flex-shrink-0 transition-all duration-200
                                ${selectedClipId === clip.id ? 'border-indigo-500 ring-2 ring-indigo-500/50 scale-105 z-10' : 'border-gray-700 hover:border-gray-500'}
                                ${clip.isLoading ? 'cursor-wait border-indigo-500/30' : ''}
                            `}
                        >
                            {clip.isLoading ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
                                    {/* Loading Circle Placeholder */}
                                    <div className="relative w-8 h-8">
                                        <div className="absolute inset-0 border-2 border-gray-700 rounded-full"></div>
                                        <div className="absolute inset-0 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                    <span className="text-[8px] text-gray-400 font-bold mt-1 animate-pulse">Generating</span>
                                </div>
                            ) : (
                                <>
                                    <video src={clip.url} className="w-full h-full object-cover pointer-events-none" />
                                    
                                    {/* Trim Handles (Visual) */}
                                    {selectedClipId === clip.id && (
                                        <>
                                            <div className="absolute left-0 top-0 bottom-0 w-2 bg-indigo-500/80 cursor-ew-resize flex items-center justify-center hover:bg-indigo-400 transition-colors">
                                                <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                                            </div>
                                            <div className="absolute right-0 top-0 bottom-0 w-2 bg-indigo-500/80 cursor-ew-resize flex items-center justify-center hover:bg-indigo-400 transition-colors">
                                                <div className="w-0.5 h-4 bg-white/50 rounded-full"></div>
                                            </div>
                                        </>
                                    )}

                                    {/* Duration Badge */}
                                    <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/80 text-white px-1 rounded-sm font-mono backdrop-blur-sm shadow-sm">
                                        {clip.duration}s
                                    </span>
                                </>
                            )}
                        </div>
                    ))}
                    
                    {clips.length === 0 && (
                        <div className="text-xs text-gray-600 italic ml-2 flex items-center gap-2">
                            <ScissorsIcon className="w-4 h-4 opacity-50"/>
                            Add clips from the workspace to start editing
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Inline Edit Panel */}
            {selectedClipId && (
                <div className="flex-shrink-0 w-72 border-l border-gray-800 bg-gray-900 flex flex-col p-2 animate-in slide-in-from-right-10 duration-200 relative z-50">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                            <ScissorsIcon className="w-3 h-3"/> Edit Clip
                        </span>
                        <div className="flex gap-1">
                             <button onClick={() => { onDelete(selectedClipId); setSelectedClipId(null); }} className="p-1 hover:bg-red-900/30 text-gray-500 hover:text-red-400 rounded transition-colors" title="Delete Clip">
                                <TrashIcon className="w-3.5 h-3.5"/>
                            </button>
                            <button onClick={() => setSelectedClipId(null)} className="p-1 hover:bg-gray-800 text-gray-500 hover:text-white rounded transition-colors">
                                <XIcon className="w-3.5 h-3.5"/>
                            </button>
                        </div>
                    </div>
                    
                    {selectedClip?.videoObject ? (
                        <div className="flex flex-col gap-2 h-full">
                            <textarea 
                                value={extendPrompt} 
                                onChange={e => setExtendPrompt(e.target.value)} 
                                placeholder="Extend clip: Describe what happens next..." 
                                className="w-full flex-1 bg-black/30 border border-gray-700 rounded p-2 text-[10px] text-white resize-none focus:border-indigo-500 focus:outline-none placeholder-gray-600" 
                            />
                            <button 
                                onClick={handleExtendClick} 
                                disabled={!extendPrompt.trim()}
                                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-[10px] font-bold rounded flex items-center justify-center gap-1 transition-colors"
                            >
                                <SparklesIcon className="w-3 h-3" /> Generate Extension
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-[10px] text-gray-500 text-center">
                            This clip cannot be extended.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};