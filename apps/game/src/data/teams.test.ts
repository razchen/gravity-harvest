import { afterEach, describe, expect, it } from 'vitest';
import { SIDES, colourOf, factionOfTeam, isMine, myTeam, setSeats } from './teams';

describe('teams', () => {
  afterEach(() => setSeats({ you: 'a', factions: { a: 'ordan', b: 'sable' } }));

  it('yours and theirs follow the seat the hello gives you, not the seat name', () => {
    setSeats({ you: 'b', factions: { a: 'ordan', b: 'sable' } });
    expect(myTeam()).toBe('b');
    expect(isMine('b')).toBe(true);
    expect(isMine('a')).toBe(false);
    expect(colourOf('b')).toBe(SIDES.mine);
    expect(colourOf('a')).toBe(SIDES.theirs);
  });

  it('each side looks like the faction the server reports for it, the same one on both sides too', () => {
    setSeats({ you: 'b', factions: { a: 'sable', b: 'sable' } });
    expect(factionOfTeam('a')).toBe('sable');
    expect(factionOfTeam('b')).toBe('sable');
  });
});
