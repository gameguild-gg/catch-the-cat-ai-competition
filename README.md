# Catch The Cat AI Competition

This repo contains the code for running the competition of AI agents for the catch the cat game.

## Rules

https://gameguild.gg/learn/courses/ai4games/lessons/week-07-catch-the-cat-game

## Steps

```mermaid
flowchart TD
    A[Start Competition] --> B[Get List of Agent Repositories]
    
    B --> C{For Each Repository}
    C --> D[Clone Repository]
    D --> E[Build catchthecat Executable]
    E --> F{More Repositories?}
    F -->|Yes| C
    F -->|No| G[Generate 8 Random Initial States]
    
    G --> H{For Each Combination of 2 Executables}
    H --> I[Set: Cat Agent & Catcher Agent]
    I --> J[Set turnIsCat = true]
    
    J --> K{For Each Initial State}
    K --> L[Load Current State]
    L --> M{Game Loop: Has Winner OR Invalid Output?}
    
    M -->|No| N{Is Cat Turn?}
    N -->|Yes| O[simulate cat move]
    N -->|No| P[simulate catcher move]
    O --> Q[turnIsCat = false]
    P --> R[turnIsCat = true]
    Q --> M
    R --> M
    
    M -->|Yes| S[Generate Partial Report for Current Match]
    S --> T{More Initial States?}
    T -->|Yes| K
    T -->|No| U{More Agent Combinations?}
    U -->|Yes| H
    U -->|No| V[Compose Final Report]
    
    V --> W[Show Final Scoreboard]
    W --> X[Allow Players to Watch Agent Replays]
    X --> Y[End Competition]
```

## Rules for points

Summary:

There are 2 set of rules for points:

- Number of moves made in onder to win, so you have to make it win with the less moves as possible;
- Time spent processing each move, so your algorithm with the less time as possible;

### Moves Score

- In a square board of size` N*N`, the maximum number of catcher moves is` N*N`.
- If the cat wins:
    - Cat receives `N*N - moves` points.
    - Catcher receives `moves` points.
- If the catcher wins:
    - Catcher receives `N*N - moves` points.
    - Cat receives `moves` points.

The result will be normalized by dividing the result by `N*N`.

### Time Score

- The maximum time limit is `2s`;
- If the time limit is reached, the other agent wins;
- Both agents have timers that will deduct it from the `Move Score`;

### Match Score

A match is when two users play against each other in a game.

```
CatScore = CatMoveScore - CatTimeScore * Weight

CatcherScore = CatcherMoveScore - CatcherTimeScore * Weight

UserScoreOnMatch = CatScore + CatcherScore
```

### Competition Score

```
UserScore = {
  cat: 0,
  catcher: 0,
}
Usernames[]; // list of usernames
UserScores = Map<UserName, UserScore>
InitialStates[] = generateRandomInitialStates(8)
for each InitialState in InitialStates:
    for each cat in Users:
        for each catcher in Users:
            if cat == catcher:
                continue
            matchReport = playGame(cat, catcher, InitialState)
            UserScores[cat].cat += matchReport.catScore
            UserScores[catcher].catcher += matchReport.catcherScore
Sort UserScores by the sum of cat and catcher scores
Generate html report
```

## CI/CD and GitHub Pages Deployment

This repository includes a GitHub Actions workflow that automatically builds and deploys the competition reports to GitHub Pages.

### Workflow Features

- **Automatic Deployment**: Triggers on pushes to `main` or `master` branches
- **Daily Scheduling**: Runs on a daily schedule (see `.github/workflows/deploy.yml`) to generate fresh reports
- **Manual Deployment**: Can be triggered manually via GitHub Actions UI
- **Report Generation**: Runs `npm run report` to generate competition data
- **React App Build**: Builds the React application for web deployment
- **GitHub Pages**: Deploys the built application to GitHub Pages
- **Smart Caching**: Caches npm dependencies and cloned repositories for faster builds

### Setup Instructions

1. **Enable GitHub Pages**: Go to your repository settings → Pages → Source: "GitHub Actions"
2. **Configure Repository**: Ensure the `homepage` field in `package.json` matches your GitHub Pages URL
3. **Push Changes**: The workflow will automatically run on pushes to main/master
4. **View Results**: Access your deployed competition reports at `https://[username].github.io/[repository-name]`

### Workflow File

The workflow is defined in `.github/workflows/deploy.yml` and includes:
- Node.js 18 setup with npm caching
- Smart caching for npm dependencies and cloned repositories
- Daily scheduling for automated report generation
- Dependency installation
- Competition report generation
- React application build
- GitHub Pages deployment with proper permissions

### Caching Strategy

The workflow implements intelligent caching to improve performance:
- **NPM Dependencies**: Cached based on `package-lock.json` hash
- **Repository Cache**: Caches cloned repositories in `./repos` and `./deps` folders
- **Cache Keys**: Uses OS and file hashes for optimal cache invalidation

### Local Development

To run the competition locally:
```bash
npm install
npm run report  # Generate competition data
npm start       # Start development server
```

### Test your bot in the browser

The site has an **Arena** tab: pick any two built bots, click "Run Match", and watch the game live on the hex board with per-move timings.

Bots run the same headless CLI contract as the leaderboard runner: `--headless --turn <cat|catcher> --size <21> --board <string>`, with the last two stdout lines being processing time in µs and the move as `x,y`. No GUI code is compiled into the wasm builds.

Build bots locally:
```bash
npm run build:bots              # all bots in users.json
ONLY=<username> npm run build:bots  # one bot
```
Requires emsdk (auto-bootstrapped into `./emsdk` on first run). Builds land in `public/bots/` plus `manifest.json`.

To test your fork before it's in users.json: clone it into `forks/<your-username>`, add yourself to `users.json`, then `ONLY=<your-username> npm run build:bots`.

For the full bot interface spec, see the Steps and Rules for points sections above.
