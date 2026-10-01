import React, { useState } from 'react';
import { CompetitionReportComponent } from './components/CompetitionReport';
import { Arena } from './arena/Arena';
import { Button } from './components/ui/button';

function App() {
  const [tab, setTab] = useState<'leaderboard' | 'arena'>('leaderboard');

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
        </div>

        {tab === 'leaderboard' ? <CompetitionReportComponent /> : <Arena />}
      </div>
    </div>
  );
}

export default App;
