import React, { useState, useEffect } from 'react';
import { CompetitionReportComponent } from './components/CompetitionReport';
import { Arena } from './arena/Arena';
import { PlayVsBot } from './play/PlayVsBot';
import { Button } from './components/ui/button';

function App() {
  const [tab, setTab] = useState<'leaderboard' | 'arena' | 'play'>('leaderboard');
  const [deepLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    const catcher = params.get('catcher');
    if (cat) return { bot: cat, role: 'catcher' as const };
    if (catcher) return { bot: catcher, role: 'cat' as const };
    return undefined;
  });

  useEffect(() => {
    if (deepLink) setTab('play');
  }, [deepLink]);


  return (
    <div className="min-h-screen bg-background p-8">
      <div className="container mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold text-center mb-8">
          Catch the Cat AI Competition
        </h1>

        <div className="flex justify-center gap-2 mb-8">
          <Button
            variant={tab === 'leaderboard' ? 'default' : 'outline'}
            onClick={() => setTab('leaderboard')}
          >
            Leaderboard
          </Button>
          <Button
            variant={tab === 'arena' ? 'default' : 'outline'}
            onClick={() => setTab('arena')}
          >
            Arena
          </Button>
          <Button
            variant={tab === 'play' ? 'default' : 'outline'}
            onClick={() => setTab('play')}
          >
            Play vs Bot
          </Button>
        </div>

        {tab === 'leaderboard' ? <CompetitionReportComponent /> : tab === 'arena' ? <Arena /> : <PlayVsBot deepLink={deepLink} />}
      </div>
    </div>
  );
}

export default App;
