#!/usr/bin/env tsx
import process from 'node:process';

const USAGE = 'Usage: fetch-forks.ts [--token TOKEN] <owner> <repo>';

interface ForkItem {
  owner?: { login?: string };
  clone_url?: string;
}

async function fetchAllForks(owner: string, repo: string, token?: string): Promise<ForkItem[]> {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/forks`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'catch-the-cat-ai-competition-fetch-forks',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const allForks: ForkItem[] = [];
  for (let page = 1; ; page++) {
    const url = `${baseUrl}?per_page=100&page=${page}`;
    console.error(`Fetching page ${page}: ${url}`);

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`GitHub API request failed with status ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as ForkItem[];
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }
    console.error(`  Got ${data.length} forks on page ${page}`);
    allForks.push(...data);

    if (data.length < 100) {
      break;
    }
  }

  console.error(`Found ${allForks.length} forks total`);
  return allForks;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let owner = '';
  let repo = '';
  let token = process.env.GITHUB_TOKEN || undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.error(USAGE);
      process.exit(0);
    } else if (arg === '--token' && i + 1 < args.length) {
      token = args[++i];
    } else if (arg.startsWith('--token=')) {
      token = arg.slice('--token='.length);
    } else if (!owner) {
      owner = arg;
    } else if (!repo) {
      repo = arg;
    }
  }

  if (!owner || !repo) {
    console.error(USAGE);
    process.exit(1);
  }

  const forks = await fetchAllForks(owner, repo, token);

  const corpus = forks
    .map((f) => ({ login: f.owner?.login || '', cloneUrl: f.clone_url || '' }))
    .filter((f) => f.login)
    .map((f) => `${f.login}|${f.cloneUrl}`);

  if (corpus.length === 0) {
    console.error('No forks discovered');
    process.exit(1);
  }

  process.stdout.write(corpus.join('\n') + '\n');
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
