'use client';

import { useState } from 'react';

export default function Home() {
  const [year, setYear] = useState('1995');
  const [month, setMonth] = useState('8');
  const [segments, setSegments] = useState<any[]>([]); // 4つのセグメントを保存
  const [currentIndex, setCurrentIndex] = useState(0); // 現在のコーナー番号
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // 番組全体（4セグメント分）を一気に生成
  const generateProgram = async () => {
    setIsLoading(true);
    setSegments([]);
    setCurrentIndex(0);
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setSegments(data.segments);
    } catch (error) {
      console.error('Error:', error);
      alert('番組の生成に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  // 現在表示されているセグメントの音声を再生
  const playVoice = async () => {
    const currentScript = segments[currentIndex]?.script;
    if (!currentScript) return;
    
    setIsPlaying(true);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentScript }),
      });
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      audio.onended = () => setIsPlaying(false);
      audio.play();
    } catch (error) {
      alert('音声の再生に失敗しました。');
      setIsPlaying(false);
    }
  };

  // Apple Music で検索
  const openAppleMusic = () => {
    const song = segments[currentIndex];
    if (!song) return;
    const query = encodeURIComponent(`${song.artistName} ${song.songTitle}`);
    window.open(`https://music.apple.com/jp/search?term=${query}`, '_blank');
  };

  // 次のコーナーへ進む
  const nextSegment = () => {
    if (currentIndex < segments.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const currentSegment = segments[currentIndex];

  return (
    <main className="min-h-screen bg-black text-gray-100 p-8 font-sans">
      <div className="max-w-3xl mx-auto text-center">
        <header className="mb-12">
          <h1 className="text-5xl font-black mb-2 text-yellow-500 tracking-tighter italic">TIME SLIP DJ</h1>
          <p className="text-gray-400 font-mono tracking-widest text-sm">30-MINUTE RETRO BROADCAST SYSTEM</p>
        </header>

        {/* 設定エリア */}
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 mb-10 inline-block shadow-2xl">
          <div className="flex gap-4 items-center">
            <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xl text-yellow-500">
              {Array.from({ length: 46 }, (_, i) => 1980 + i).map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xl text-yellow-500">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
            </select>
            <button 
              onClick={generateProgram} 
              disabled={isLoading} 
              className="bg-yellow-600 hover:bg-yellow-500 text-white font-black py-3 px-8 rounded-full text-lg disabled:opacity-30 transition-all"
            >
              {isLoading ? '構成作成中...' : '番組をフル生成'}
            </button>
          </div>
        </div>

        {/* 放送プレイヤーエリア */}
        {segments.length > 0 && currentSegment && (
          <div className="bg-gray-100 text-gray-900 p-8 md:p-12 rounded shadow-2xl relative text-left border-t-8 border-red-600">
            {/* 進行度インジケーター */}
            <div className="flex gap-2 mb-6">
              {segments.map((_, idx) => (
                <div key={idx} className={`h-1 flex-1 rounded ${idx <= currentIndex ? 'bg-red-600' : 'bg-gray-300'}`} />
              ))}
            </div>

            <div className="flex justify-between items-start mb-8">
              <div>
                <span className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1 block">Corner {currentIndex + 1} / 4</span>
                <h2 className="text-3xl font-black tracking-tight">{currentSegment.segmentTitle}</h2>
              </div>
              <button 
                onClick={playVoice} 
                disabled={isPlaying}
                className="bg-red-600 text-white px-8 py-4 rounded-full font-black hover:bg-red-700 disabled:bg-gray-400 transition-transform active:scale-95 shadow-lg flex items-center gap-2"
              >
                {isPlaying ? <span className="animate-pulse">● ON AIR...</span> : '▶ トークを聴く'}
              </button>
            </div>

            <div className="whitespace-pre-wrap font-serif text-lg leading-relaxed mb-10 bg-gray-50 p-6 rounded border-l-4 border-gray-300">
              {currentSegment.script}
            </div>

            <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-300 text-center">
              <p className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-widest">Now Selected Track</p>
              <h3 className="text-2xl font-black mb-6">{currentSegment.songTitle} / {currentSegment.artistName}</h3>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button onClick={openAppleMusic} className="bg-black text-white px-8 py-4 rounded-xl font-bold hover:bg-gray-800 flex items-center justify-center gap-2">
                  <span className="text-xl"></span> Apple Music
                </button>
                
                {currentIndex < segments.length - 1 && (
                  <button onClick={nextSegment} className="bg-blue-600 text-white px-8 py-4 rounded-xl font-bold hover:bg-blue-500">
                    次のコーナーへ進む →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}