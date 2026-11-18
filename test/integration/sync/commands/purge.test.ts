// A "Not preferred" mute purges only when its toast closes, or when the safety timer runs it. Over a
// sink the result says a purge is pending, and its commitPurge sends the close as a command.
import { cancelPendingPurges, commitSourcePrefPurge, revertSourcePrefChange, setSourcePrefFromUi } from '@/lib/database/services/publication-pref-ui-actions';
import { setPreferenceKind } from '@/lib/database/services/publication-preference-service';
import { clearAllStores } from '@/lib/stores';
import { advanceUntilDone, testHost, useFakeClock } from '@/test/helpers';
import { quietLogger, resetPersonaMemory, seedArticles, settleWrites, statuses } from '../../data/services/persona/support';

const names = ['Times of India', 'TOI Business'];
const mute = () => setSourcePrefFromUi({ kind: 'publisher', names }, 'muted');

let logs: ReturnType<typeof quietLogger>;
beforeEach(async () => {
  logs = quietLogger();
  resetPersonaMemory();
  await seedArticles([
    { id: 'a', title: 'x', publication: 'Times of India' },
    { id: 'b', title: 'y', publication: 'TOI Business' },
  ]);
});
afterEach(async () => {
  await settleWrites();
  logs.restore();
});

it('keeps every row until the toast closes, then purges once', async () => {
  const result = await mute();
  expect(result.purgePending).toBe(true);
  expect(await statuses()).toEqual({ a: 'unscored', b: 'unscored' });

  await commitSourcePrefPurge(result.changeLogId!);
  await commitSourcePrefPurge(result.changeLogId!);

  expect(await statuses()).toEqual({ a: 'excluded', b: 'excluded' });
});

it('a revert inside the window keeps every row, and the close that follows purges nothing', async () => {
  const result = await mute();
  await revertSourcePrefChange(result);
  await commitSourcePrefPurge(result.changeLogId!);
  expect(await statuses()).toEqual({ a: 'unscored', b: 'unscored' });
});

it('an id nothing is pending for does nothing', async () => {
  await expect(commitSourcePrefPurge('unknown')).resolves.toBeUndefined();
  expect(await statuses()).toEqual({ a: 'unscored', b: 'unscored' });
});

it('purges once on its own after 60 seconds when nothing closes the window', async () => {
  useFakeClock(Date.UTC(2026, 9, 9, 12));
  const result = await advanceUntilDone(mute());
  expect(await advanceUntilDone(statuses())).toEqual({ a: 'unscored', b: 'unscored' });

  await jest.advanceTimersByTimeAsync(60_000);
  await advanceUntilDone(settleWrites());

  expect(await advanceUntilDone(statuses())).toEqual({ a: 'excluded', b: 'excluded' });
  await commitSourcePrefPurge(result.changeLogId!);
});

describe('over a sink', () => {
  it('the result carries a commitPurge that sends the close for its change', async () => {
    const sent: { name: string; args: unknown[] }[] = [];
    testHost.podCommand = async (c) => {
      sent.push(c);
      return c.name === 'setSourcePrefFromUi' ? { applied: true, changeLogId: 'c1', purgePending: true } : undefined;
    };

    const result = await mute();
    await result.commitPurge?.();

    expect(sent.map((s) => [s.name, s.args])).toEqual([
      ['setSourcePrefFromUi', [{ kind: 'publisher', names }, 'muted']],
      ['commitSourcePrefPurge', ['c1']],
    ]);
  });

  it('a result with no purge pending gets no commitPurge', async () => {
    testHost.podCommand = async () => ({ applied: true, changeLogId: 'c1' });
    expect((await mute()).commitPurge).toBeUndefined();
  });
});

describe('a reset', () => {
  it('drops a waiting purge, so nothing of the person who logged out runs in the next account', async () => {
    useFakeClock(Date.UTC(2026, 9, 9, 12));
    await advanceUntilDone(mute());
    await advanceUntilDone(clearAllStores());

    // The next account has a row from the same publication and has muted it without a purge of its
    // own: a purge left from before would now exclude that row.
    await advanceUntilDone(seedArticles([{ id: 'c', title: 'z', publication: 'Times of India' }]));
    await advanceUntilDone(setPreferenceKind('Times of India', 'mute', 'user'));
    await jest.advanceTimersByTimeAsync(61_000);
    await advanceUntilDone(settleWrites());
    expect(await advanceUntilDone(statuses())).toEqual({ c: 'unscored' });
  });

  it('cancelPendingPurges drops every waiting purge and is safe with none', async () => {
    useFakeClock(Date.UTC(2026, 9, 9, 12));
    await advanceUntilDone(mute());
    cancelPendingPurges();
    cancelPendingPurges();
    await jest.advanceTimersByTimeAsync(61_000);
    await advanceUntilDone(settleWrites());
    expect(await advanceUntilDone(statuses())).toEqual({ a: 'unscored', b: 'unscored' });
  });
});
