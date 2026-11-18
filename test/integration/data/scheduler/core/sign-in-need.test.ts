// A host can say a task needs no Mera sign-in: that task's authenticated condition then passes
// without the token check. Without the member, every task checks as before.
import '@/test/helpers';

import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import { useUserStore } from '@/lib/stores/user-store';
import { advanceUntilDone, authState, testHost, useFakeClock } from '@/test/helpers';

import { addTask, resetScheduler, settle } from './support';

let jwtCalls: jest.SpyInstance;
beforeEach(() => {
  useFakeClock(Date.UTC(2026, 9, 9, 12, 0, 0));
  resetScheduler();
  useUserStore.setState({ userPersona: {} as never });
  // Signed out: the token check fails, so a task that checks does not run.
  Object.assign(authState, { jwt: null, cookie: null });
  jwtCalls = jest.spyOn(testHost.auth, 'getJwtToken');
});
afterEach(() => {
  AppScheduler.dispose();
  delete testHost.taskNeedsMeraSignIn;
  jest.restoreAllMocks();
});

async function start() {
  const task = addTask({ frequency: 10_000, conditions: [{ type: 'authenticated' }] });
  await advanceUntilDone(AppScheduler.init());
  await settle(11_000);
  return task;
}

it('without the member a task checks the sign-in and, signed out, does not run', async () => {
  const task = await start();
  expect(jwtCalls).toHaveBeenCalled();
  expect(task.runs).toHaveLength(0);
});

it('a task the host says needs no sign-in runs without the token check', async () => {
  testHost.taskNeedsMeraSignIn = () => false;
  const task = await start();
  expect(task.runs.length).toBeGreaterThan(0);
  expect(jwtCalls).not.toHaveBeenCalled();
});

it('the host is asked by task name, and another task still checks', async () => {
  const asked: string[] = [];
  testHost.taskNeedsMeraSignIn = (name) => {
    asked.push(name);
    return name === 'some-other-task' ? false : true;
  };
  const task = await start();
  expect(asked).toContain(task.name);
  expect(task.runs).toHaveLength(0);
  expect(jwtCalls).toHaveBeenCalled();
});

it('a host answering true is the same as no member', async () => {
  testHost.taskNeedsMeraSignIn = () => true;
  const task = await start();
  expect(task.runs).toHaveLength(0);
  expect(jwtCalls).toHaveBeenCalled();
});
