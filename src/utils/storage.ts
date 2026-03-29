import { type AppState } from "../types";

const STORAGE_KEY = "festival-prepare-system-state";

export const createEmptyState = (): AppState => ({
  items: [],
  floors: [],
  rooms: [],
  beforeCounts: {},
  afterCounts: {},
  surplusRules: {},
  moves: [],
  planningErrors: [],
  lastPlannedAt: null,
});

export const loadState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyState();
    }

    const parsed = JSON.parse(raw) as AppState;
    return {
      ...createEmptyState(),
      ...parsed,
    };
  } catch {
    return createEmptyState();
  }
};

export const saveState = (state: AppState): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const clearState = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};
