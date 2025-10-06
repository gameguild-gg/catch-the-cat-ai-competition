import React from 'react';
import { CompetitionReportComponent } from './components/CompetitionReport';

function App() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="container mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold text-center mb-8">
          Catch the Cat AI Competition
        </h1>
        


        {/* Competition Report Section */}
        <CompetitionReportComponent />
      </div>
    </div>
  );
}

export default App;
