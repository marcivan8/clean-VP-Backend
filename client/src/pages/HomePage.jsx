import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Wand2, Clock, ChevronRight, FileVideo } from 'lucide-react';
import VibeCharacter from '../components/3D/VibeCharacter';

const HomePage = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white overflow-hidden relative selection:bg-primary/30">
            {/* Ambient 3D Background */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-40">
                <VibeCharacter className="w-full h-full scale-[2] translate-y-1/4" isThinking={false} />
            </div>

            <div className="max-w-7xl mx-auto px-6 py-12 relative z-10 flex flex-col h-screen">

                {/* Header */}
                <header className="flex justify-between items-center mb-16">
                    <div className="flex items-center gap-3 relative z-10 group">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden">
                            <VibeCharacter className="scale-[2] pointer-events-none" />
                        </div>
                        <span className="font-semibold text-xl tracking-tight">Vibed</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <button className="text-sm text-gray-400 hover:text-white transition-colors">Documentation</button>
                        <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center">
                            <span className="text-xs font-medium">JD</span>
                        </div>
                    </div>
                </header>

                <main className="flex-1 flex flex-col justify-center max-w-5xl mx-auto w-full -mt-20">
                    <div className="text-center mb-12">
                        <h1 className="text-5xl md:text-6xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/50 mb-4 tracking-tight">
                            Create. Analyze. Viralize.
                        </h1>
                        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                            The advanced AI-powered video editor designed for high-performance content creators.
                        </p>
                    </div>

                    {/* Mode Selection Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
                        {/* Editor Card */}
                        <div
                            onClick={() => navigate('/editor')}
                            className="group relative h-64 bg-white/5 border border-white/10 rounded-2xl p-8 cursor-pointer hover:border-purple-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-purple-500/10 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-white/5">
                                        <Video className="w-6 h-6 text-purple-400" />
                                    </div>
                                    <h2 className="text-2xl font-semibold mb-2 text-white group-hover:text-purple-300 transition-colors">Video Editor</h2>
                                    <p className="text-gray-400 text-sm leading-relaxed">
                                        Full-featured timeline editor with AI co-pilot. <br />
                                        Edit, trim, grade, and export your content.
                                    </p>
                                </div>
                                <div className="flex items-center text-sm font-medium text-purple-400 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                                    Launch Editor <ChevronRight className="w-4 h-4 ml-1" />
                                </div>
                            </div>
                        </div>

                        {/* Analyzer Card */}
                        <div
                            onClick={() => window.location.href = 'https://vibed.ai'}
                            className="group relative h-64 bg-white/5 border border-white/10 rounded-2xl p-8 cursor-pointer hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-white/5">
                                        <Wand2 className="w-6 h-6 text-blue-400" />
                                    </div>
                                    <h2 className="text-2xl font-semibold mb-2 text-white group-hover:text-blue-300 transition-colors">Vibed Editor</h2>
                                    <p className="text-gray-400 text-sm leading-relaxed">
                                        Deep insights into your raw footage. <br />
                                        Detect hooks, pacing issues, and viral potential.
                                    </p>
                                </div>
                                <div className="flex items-center text-sm font-medium text-blue-400 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                                    Enter Vibed <ChevronRight className="w-4 h-4 ml-1" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Recent Projects (Mock) */}
                    <div className="border-t border-white/10 pt-8">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Recent Projects</h3>
                            <button className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center">
                                View All <ChevronRight className="w-3 h-3 ml-1" />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="group bg-white/5 border border-white/5 hover:border-white/10 rounded-xl p-4 flex items-center gap-4 cursor-pointer transition-colors">
                                    <div className="w-12 h-12 bg-black/40 rounded-lg flex items-center justify-center text-gray-600 group-hover:text-gray-400">
                                        <FileVideo className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-medium text-gray-200 group-hover:text-white text-sm">Project_Alpha_v{i}</h4>
                                        <p className="text-xs text-gray-500 flex items-center mt-1">
                                            <Clock className="w-3 h-3 mr-1" /> 2h ago
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </main>
            </div>
        </div>
    );
};

export default HomePage;
