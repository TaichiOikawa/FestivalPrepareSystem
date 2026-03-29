import {
  type AppState,
  type MoveInstruction,
  type MoveReason,
  type Room,
  SURPLUS_KEEP_ORIGIN,
} from "../types";

type PlanResult = {
  moves: MoveInstruction[];
  errors: string[];
};

type Balance = {
  roomId: string;
  qty: number;
};

const createFloorOrderMap = (state: AppState): Map<string, number> => {
  return new Map(
    [...state.floors]
      .sort((a, b) => a.order - b.order)
      .map((floor, index) => [floor.id, index]),
  );
};

const createAdjacentRoomPairs = (state: AppState): Set<string> => {
  const adjacentPairs = new Set<string>();
  const byFloor = new Map<string, Room[]>();

  for (const room of state.rooms) {
    const list = byFloor.get(room.floorId) ?? [];
    list.push(room);
    byFloor.set(room.floorId, list);
  }

  for (const rooms of byFloor.values()) {
    const ordered = [...rooms].sort((a, b) => a.order - b.order);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const left = ordered[i].id;
      const right = ordered[i + 1].id;
      adjacentPairs.add(`${left}::${right}`);
      adjacentPairs.add(`${right}::${left}`);
    }
  }

  return adjacentPairs;
};

const getPriority = (
  from: Room,
  to: Room,
  adjacentPairs: Set<string>,
  floorOrderMap: Map<string, number>,
): { score: number; reason: MoveReason } => {
  const sameFloor = from.floorId === to.floorId;
  if (sameFloor && adjacentPairs.has(`${from.id}::${to.id}`)) {
    return { score: 0, reason: "same-floor-adjacent" };
  }

  if (sameFloor) {
    return { score: 1, reason: "same-floor" };
  }

  const fromOrder = floorOrderMap.get(from.floorId) ?? 0;
  const toOrder = floorOrderMap.get(to.floorId) ?? 0;
  return {
    score: 2 + Math.abs(fromOrder - toOrder),
    reason: "cross-floor",
  };
};

const sortByRoomName = (a: Room, b: Room): number =>
  a.name.localeCompare(b.name, "ja");

export const generateMovePlan = (state: AppState): PlanResult => {
  const errors: string[] = [];
  const moves: MoveInstruction[] = [];

  const roomMap = new Map(state.rooms.map((room) => [room.id, room]));
  const adjacentPairs = createAdjacentRoomPairs(state);
  const floorOrderMap = createFloorOrderMap(state);

  for (const item of state.items) {
    let beforeTotal = 0;
    let afterTotal = 0;

    const supply: Balance[] = [];
    const demand: Balance[] = [];

    for (const room of state.rooms) {
      const before = state.beforeCounts[room.id]?.[item.id] ?? 0;
      const after = state.afterCounts[room.id]?.[item.id] ?? 0;

      beforeTotal += before;
      afterTotal += after;

      if (before > after) {
        supply.push({ roomId: room.id, qty: before - after });
      }

      if (after > before) {
        demand.push({ roomId: room.id, qty: after - before });
      }
    }

    if (beforeTotal < afterTotal) {
      errors.push(
        `${item.name}: 移動前個数が不足しています（${beforeTotal} < ${afterTotal}）。`,
      );
      continue;
    }

    const surplusRoomId = state.surplusRules[item.id];
    if (beforeTotal > afterTotal && !surplusRoomId) {
      errors.push(`${item.name}: 余剰が発生するため置き場所の指定が必要です。`);
      continue;
    }

    while (demand.some((entry) => entry.qty > 0)) {
      const demandEntry = demand.find((entry) => entry.qty > 0);
      if (!demandEntry) {
        break;
      }

      const demandRoom = roomMap.get(demandEntry.roomId);
      if (!demandRoom) {
        errors.push(`${item.name}: 需要側の教室が見つかりません。`);
        break;
      }

      const candidates = supply
        .filter((entry) => entry.qty > 0)
        .map((entry) => {
          const supplyRoom = roomMap.get(entry.roomId);
          if (!supplyRoom) {
            return null;
          }

          const { score, reason } = getPriority(
            supplyRoom,
            demandRoom,
            adjacentPairs,
            floorOrderMap,
          );
          return {
            entry,
            supplyRoom,
            score,
            reason,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => {
          if (a.score !== b.score) {
            return a.score - b.score;
          }
          return sortByRoomName(a.supplyRoom, b.supplyRoom);
        });

      const selected = candidates[0];
      if (!selected) {
        errors.push(`${item.name}: 必要数を満たす供給元がありません。`);
        break;
      }

      const quantity = Math.min(selected.entry.qty, demandEntry.qty);
      selected.entry.qty -= quantity;
      demandEntry.qty -= quantity;

      moves.push({
        itemId: item.id,
        fromRoomId: selected.entry.roomId,
        toRoomId: demandEntry.roomId,
        quantity,
        reason: selected.reason,
      });
    }

    const remainingSupply = supply.filter((entry) => entry.qty > 0);
    if (remainingSupply.length > 0) {
      if (surplusRoomId === SURPLUS_KEEP_ORIGIN) {
        continue;
      }

      if (!surplusRoomId || !roomMap.has(surplusRoomId)) {
        errors.push(`${item.name}: 余剰物品の置き場所が不正です。`);
      } else {
        for (const entry of remainingSupply) {
          if (entry.roomId === surplusRoomId) {
            continue;
          }

          moves.push({
            itemId: item.id,
            fromRoomId: entry.roomId,
            toRoomId: surplusRoomId,
            quantity: entry.qty,
            reason: "surplus",
          });
        }
      }
    }
  }

  return { moves, errors };
};
