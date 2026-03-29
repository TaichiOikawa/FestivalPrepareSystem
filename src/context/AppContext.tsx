import {
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type PropsWithChildren,
} from "react";
import {
  SURPLUS_KEEP_ORIGIN,
  type AppState,
  type Floor,
  type Item,
  type MoveInstruction,
  type Room,
} from "../types";
import { createEmptyState, loadState, saveState } from "../utils/storage";
import { AppContext } from "./appContextInstance.ts";

export type Action =
  | { type: "ADD_ITEM"; payload: Item }
  | { type: "REMOVE_ITEM"; payload: { itemId: string } }
  | { type: "MOVE_ITEM"; payload: { itemId: string; direction: "up" | "down" } }
  | { type: "ADD_FLOOR"; payload: Floor }
  | { type: "REMOVE_FLOOR"; payload: { floorId: string } }
  | {
      type: "MOVE_FLOOR";
      payload: { floorId: string; direction: "up" | "down" };
    }
  | { type: "ADD_ROOM"; payload: Room }
  | { type: "REMOVE_ROOM"; payload: { roomId: string } }
  | { type: "MOVE_ROOM"; payload: { roomId: string; direction: "up" | "down" } }
  | {
      type: "SET_COUNT";
      payload: {
        phase: "before" | "after";
        roomId: string;
        itemId: string;
        count: number;
      };
    }
  | { type: "SET_SURPLUS_RULE"; payload: { itemId: string; roomId: string } }
  | {
      type: "SET_PLAN_RESULT";
      payload: { moves: MoveInstruction[]; planningErrors: string[] };
    }
  | { type: "REPLACE_STATE"; payload: AppState }
  | { type: "CLEAR_ALL" };

export type AppContextValue = {
  state: AppState;
  dispatch: Dispatch<Action>;
};

const createNormalizedCountMatrix = (
  state: AppState,
  matrix: AppState["beforeCounts"],
): AppState["beforeCounts"] => {
  const normalized: AppState["beforeCounts"] = {};

  for (const room of state.rooms) {
    normalized[room.id] = {};
    for (const item of state.items) {
      normalized[room.id][item.id] = matrix[room.id]?.[item.id] ?? 0;
    }
  }

  return normalized;
};

const normalizeState = (state: AppState): AppState => {
  const rawRooms = state.rooms as Array<
    Room & {
      floor?: number;
      adjacentRoomIds?: string[];
    }
  >;

  const migratedFloors = [...state.floors];
  const legacyFloorToId = new Map<number, string>();
  let fallbackFloorOrder = migratedFloors.length;

  const ensureFloorId = (legacyFloor: number): string => {
    const existing = legacyFloorToId.get(legacyFloor);
    if (existing) {
      return existing;
    }

    const already = migratedFloors.find((x) => x.name === `${legacyFloor}F`);
    if (already) {
      legacyFloorToId.set(legacyFloor, already.id);
      return already.id;
    }

    const id = `legacy-floor-${legacyFloor}`;
    migratedFloors.push({
      id,
      name: `${legacyFloor}F`,
      order: fallbackFloorOrder,
    });
    fallbackFloorOrder += 1;
    legacyFloorToId.set(legacyFloor, id);
    return id;
  };

  const migratedRooms = rawRooms.map((room, index) => {
    const floorId = room.floorId
      ? room.floorId
      : typeof room.floor === "number"
        ? ensureFloorId(room.floor)
        : "";

    return {
      id: room.id,
      name: room.name,
      floorId,
      order: Number.isFinite(room.order) ? room.order : index,
    } as Room;
  });

  let floors = migratedFloors
    .map((floor, index) => ({
      ...floor,
      order: Number.isFinite(floor.order) ? floor.order : index,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));

  if (floors.length === 0) {
    floors = [{ id: "default-floor", name: "1F", order: 0 }];
  }

  floors = floors.map((floor, index) => ({ ...floor, order: index }));

  const validFloorIds = new Set(floors.map((floor) => floor.id));
  const fallbackFloorId = floors[0].id;

  const rooms = migratedRooms
    .map((room) => ({
      ...room,
      floorId: validFloorIds.has(room.floorId) ? room.floorId : fallbackFloorId,
    }))
    .filter((room) => room.floorId.length > 0);

  const normalizedRooms = rooms
    .sort(
      (a, b) =>
        a.floorId.localeCompare(b.floorId) ||
        a.order - b.order ||
        a.name.localeCompare(b.name, "ja"),
    )
    .reduce<Room[]>((acc, room) => {
      const sameFloorCount = acc.filter(
        (x) => x.floorId === room.floorId,
      ).length;
      acc.push({ ...room, order: sameFloorCount });
      return acc;
    }, []);

  const rebuiltState: AppState = {
    ...state,
    floors,
    rooms: normalizedRooms,
  };

  const beforeCounts = createNormalizedCountMatrix(
    rebuiltState,
    rebuiltState.beforeCounts,
  );
  const afterCounts = createNormalizedCountMatrix(
    rebuiltState,
    rebuiltState.afterCounts,
  );

  const validItemIds = new Set(rebuiltState.items.map((item) => item.id));
  const validRoomIds = new Set(rebuiltState.rooms.map((room) => room.id));

  const surplusRules = Object.fromEntries(
    Object.entries(rebuiltState.surplusRules).filter(
      ([itemId, roomId]) =>
        validItemIds.has(itemId) &&
        (validRoomIds.has(roomId) || roomId === SURPLUS_KEEP_ORIGIN),
    ),
  );

  return {
    ...rebuiltState,
    beforeCounts,
    afterCounts,
    surplusRules,
  };
};

const initialState = normalizeState({
  ...createEmptyState(),
  ...loadState(),
});

const reducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case "ADD_ITEM": {
      return normalizeState({
        ...state,
        items: [...state.items, action.payload],
      });
    }
    case "REMOVE_ITEM": {
      return normalizeState({
        ...state,
        items: state.items.filter((item) => item.id !== action.payload.itemId),
      });
    }
    case "MOVE_ITEM": {
      const index = state.items.findIndex(
        (item) => item.id === action.payload.itemId,
      );
      if (index < 0) {
        return state;
      }

      const swapIndex =
        action.payload.direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= state.items.length) {
        return state;
      }

      const items = [...state.items];
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];

      return normalizeState({
        ...state,
        items,
      });
    }
    case "ADD_FLOOR": {
      return normalizeState({
        ...state,
        floors: [...state.floors, action.payload],
      });
    }
    case "REMOVE_FLOOR": {
      return normalizeState({
        ...state,
        floors: state.floors.filter(
          (floor) => floor.id !== action.payload.floorId,
        ),
        rooms: state.rooms.filter(
          (room) => room.floorId !== action.payload.floorId,
        ),
      });
    }
    case "MOVE_FLOOR": {
      const orderedFloors = [...state.floors].sort((a, b) => a.order - b.order);
      const currentIndex = orderedFloors.findIndex(
        (floor) => floor.id === action.payload.floorId,
      );
      if (currentIndex < 0) {
        return state;
      }

      const swapIndex =
        action.payload.direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= orderedFloors.length) {
        return state;
      }

      [orderedFloors[currentIndex], orderedFloors[swapIndex]] = [
        orderedFloors[swapIndex],
        orderedFloors[currentIndex],
      ];

      const nextFloors = orderedFloors.map((floor, index) => ({
        ...floor,
        order: index,
      }));

      return normalizeState({
        ...state,
        floors: nextFloors,
      });
    }
    case "ADD_ROOM": {
      return normalizeState({
        ...state,
        rooms: [...state.rooms, action.payload],
      });
    }
    case "REMOVE_ROOM": {
      return normalizeState({
        ...state,
        rooms: state.rooms.filter((room) => room.id !== action.payload.roomId),
      });
    }
    case "MOVE_ROOM": {
      const current = state.rooms.find(
        (room) => room.id === action.payload.roomId,
      );
      if (!current) {
        return state;
      }

      const floorRooms = state.rooms
        .filter((room) => room.floorId === current.floorId)
        .sort(
          (a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"),
        );
      const index = floorRooms.findIndex((room) => room.id === current.id);
      if (index < 0) {
        return state;
      }

      const swapIndex =
        action.payload.direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= floorRooms.length) {
        return state;
      }

      const reordered = [...floorRooms];
      [reordered[index], reordered[swapIndex]] = [
        reordered[swapIndex],
        reordered[index],
      ];

      const nextRooms = state.rooms.map((room) => {
        const newIndex = reordered.findIndex((x) => x.id === room.id);
        if (newIndex >= 0) {
          return { ...room, order: newIndex };
        }
        return room;
      });

      return normalizeState({
        ...state,
        rooms: nextRooms,
      });
    }
    case "SET_COUNT": {
      const target =
        action.payload.phase === "before" ? "beforeCounts" : "afterCounts";
      return {
        ...state,
        [target]: {
          ...state[target],
          [action.payload.roomId]: {
            ...state[target][action.payload.roomId],
            [action.payload.itemId]: action.payload.count,
          },
        },
      } as AppState;
    }
    case "SET_SURPLUS_RULE": {
      return {
        ...state,
        surplusRules: {
          ...state.surplusRules,
          [action.payload.itemId]: action.payload.roomId,
        },
      };
    }
    case "SET_PLAN_RESULT": {
      return {
        ...state,
        moves: action.payload.moves,
        planningErrors: action.payload.planningErrors,
        lastPlannedAt: new Date().toISOString(),
      };
    }
    case "REPLACE_STATE": {
      return normalizeState(action.payload);
    }
    case "CLEAR_ALL": {
      return createEmptyState();
    }
    default: {
      return state;
    }
  }
};

export const AppProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
