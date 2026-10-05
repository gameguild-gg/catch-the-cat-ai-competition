import { describe, it, expect } from 'vitest';
import usersData from '../users.json';

interface UserEntry {
  username: string;
  repo: string;
}

describe('users.json', () => {
  it('contains entries', () => {
    expect(usersData.length).toBeGreaterThan(0);
  });

  it('every entry has non-empty username and repo', () => {
    for (const u of usersData as UserEntry[]) {
      expect(u.username).toBeTruthy();
      expect(u.repo).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('all usernames are unique', () => {
    expect(new Set((usersData as UserEntry[]).map((u) => u.username)).size).toBe(usersData.length);
  });
});
