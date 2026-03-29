export const SCHEMA_VERSION = 1;
export const SURPLUS_KEEP_ORIGIN = "__KEEP_ORIGIN__";

export type Item = {
  id: string;
  name: string;
};

export type Floor = {
  id: string;
  name: string;
  order: number;
};

export type Room = {
  id: string;
  name: string;
  floorId: string;
  order: number;
};

export type CountMatrix = Record<string, Record<string, number>>;

export type MoveReason =
  | "same-floor-adjacent"
  | "same-floor"
  | "cross-floor"
  | "surplus";

export type MoveInstruction = {
  itemId: string;
  fromRoomId: string;
  toRoomId: string;
  quantity: number;
  reason: MoveReason;
};

export type AppState = {
  items: Item[];
  floors: Floor[];
  rooms: Room[];
  beforeCounts: CountMatrix;
  afterCounts: CountMatrix;
  surplusRules: Record<string, string>;
  moves: MoveInstruction[];
  planningErrors: string[];
  lastPlannedAt: string | null;
};

export type ExportPayload = {
  schemaVersion: number;
  exportedAt: string;
  state: AppState;
};
