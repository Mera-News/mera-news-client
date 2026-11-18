"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useSchedulerStore = void 0;
var _zustand = require("zustand");
const useSchedulerStore = exports.useSchedulerStore = (0, _zustand.create)((set, get) => ({
  status: 'initializing',
  jobs: {},
  taskCurrentStatus: {},
  taskLastRun: {},
  taskProgress: {},
  taskStartedAt: {},
  runningCount: 0,
  failedCount: 0,
  pendingCount: 0,
  setStatus: s => set({
    status: s
  }),
  // Synchronously mark a task as running before its job is created, so two
  // near-simultaneous triggers can't both pass the isRunning() exclusivity
  // guard during the async createJob window. Resolved later by setJobRunning /
  // setJobCompleted / setJobFailed, or cleared by clearTaskReservation if the
  // job is never created.
  reserveTask: taskName => set(state => ({
    taskCurrentStatus: {
      ...state.taskCurrentStatus,
      [taskName]: 'running'
    },
    taskStartedAt: {
      ...state.taskStartedAt,
      [taskName]: Date.now()
    }
  })),
  clearTaskReservation: taskName => set(state => {
    if (state.taskCurrentStatus[taskName] !== 'running') return state;
    return {
      taskCurrentStatus: {
        ...state.taskCurrentStatus,
        [taskName]: null
      },
      taskStartedAt: {
        ...state.taskStartedAt,
        [taskName]: null
      }
    };
  }),
  addJob: job => set(state => ({
    jobs: {
      ...state.jobs,
      [job.id]: {
        ...job
      }
    },
    // Preserve an existing 'running' reservation (reserveTask) so the
    // exclusivity window isn't reopened between enqueue and setJobRunning.
    taskCurrentStatus: {
      ...state.taskCurrentStatus,
      [job.taskName]: state.taskCurrentStatus[job.taskName] === 'running' ? 'running' : job.status
    },
    pendingCount: state.pendingCount + 1
  })),
  setJobRunning: jobId => set(state => {
    const job = state.jobs[jobId];
    if (!job) return state;
    const updated = {
      ...job,
      status: 'running',
      startedAt: Date.now()
    };
    return {
      jobs: {
        ...state.jobs,
        [jobId]: updated
      },
      taskCurrentStatus: {
        ...state.taskCurrentStatus,
        [job.taskName]: 'running'
      },
      taskStartedAt: {
        ...state.taskStartedAt,
        [job.taskName]: updated.startedAt ?? null
      },
      runningCount: state.runningCount + 1,
      pendingCount: Math.max(0, state.pendingCount - 1)
    };
  }),
  // `stampLastRun` defaults to true so every existing caller is unaffected. The
  // runner passes false for a no-op run (ctx.markNoOp) so the task's frequency
  // gate isn't armed off a cycle that did nothing.
  setJobCompleted: (jobId, completedAt, stampLastRun = true) => set(state => {
    const job = state.jobs[jobId];
    if (!job) return state;
    const updated = {
      ...job,
      status: 'completed',
      completedAt
    };
    return {
      jobs: {
        ...state.jobs,
        [jobId]: updated
      },
      taskCurrentStatus: {
        ...state.taskCurrentStatus,
        [job.taskName]: 'completed'
      },
      taskLastRun: stampLastRun ? {
        ...state.taskLastRun,
        [job.taskName]: completedAt
      } : state.taskLastRun,
      taskStartedAt: {
        ...state.taskStartedAt,
        [job.taskName]: null
      },
      runningCount: Math.max(0, state.runningCount - 1)
    };
  }),
  setJobFailed: (jobId, exhausted, retryAt) => set(state => {
    const job = state.jobs[jobId];
    if (!job) return state;
    const status = exhausted ? 'failed' : 'retrying';
    const updated = {
      ...job,
      status,
      retryAt
    };
    return {
      jobs: {
        ...state.jobs,
        [jobId]: updated
      },
      taskCurrentStatus: {
        ...state.taskCurrentStatus,
        [job.taskName]: status
      },
      taskStartedAt: {
        ...state.taskStartedAt,
        [job.taskName]: null
      },
      runningCount: Math.max(0, state.runningCount - 1),
      failedCount: exhausted ? state.failedCount + 1 : state.failedCount
    };
  }),
  updateProgress: (jobId, progress) => set(state => {
    const job = state.jobs[jobId];
    if (!job) return state;
    const updated = {
      ...job,
      progress
    };
    return {
      jobs: {
        ...state.jobs,
        [jobId]: updated
      },
      taskProgress: {
        ...state.taskProgress,
        [job.taskName]: progress
      }
    };
  }),
  /**
   * Release an in-memory `'running'` flag that no longer corresponds to a live
   * run. The runner's abort `setTimeout` is frozen while the app is
   * backgrounded on iOS, so a run interrupted mid-flight leaves the task
   * permanently 'running' — every subsequent tick/foreground/trigger then hits
   * the exclusivity guard and the task never fires again for the session.
   *
   * Deliberately conservative: only fires when `taskStartedAt` is known AND
   * older than `maxAgeMs`. A null `taskStartedAt` means we can't date the run,
   * and yanking the reservation off a genuinely-running exclusive task would
   * reopen the concurrency window it exists to close. Returns true when it
   * actually cleared something, so the caller can log it as the anomaly it is.
   */
  clearStaleRunning: (taskName, maxAgeMs) => {
    const state = get();
    if (state.taskCurrentStatus[taskName] !== 'running') return false;
    const startedAt = state.taskStartedAt[taskName];
    if (startedAt == null) return false;
    if (Date.now() - startedAt <= maxAgeMs) return false;
    set(s => ({
      taskCurrentStatus: {
        ...s.taskCurrentStatus,
        [taskName]: null
      },
      taskStartedAt: {
        ...s.taskStartedAt,
        [taskName]: null
      },
      runningCount: Math.max(0, s.runningCount - 1)
    }));
    return true;
  },
  isRunning: taskName => get().taskCurrentStatus[taskName] === 'running',
  getLastRun: taskName => get().taskLastRun[taskName] ?? null,
  setLastRun: (taskName, ts) => set(state => ({
    taskLastRun: {
      ...state.taskLastRun,
      [taskName]: ts
    }
  })),
  loadLastRunTimes: times => set(state => ({
    taskLastRun: {
      ...state.taskLastRun,
      ...times
    }
  }))
}));