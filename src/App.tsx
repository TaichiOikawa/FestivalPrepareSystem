import { useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "./context/useAppContext";
import { SURPLUS_KEEP_ORIGIN, type Room } from "./types";
import {
  exportStateAsJson,
  parseImportedJson,
  triggerJsonDownload,
} from "./utils/dataTransfer";
import { generateMovePlan } from "./utils/planner";
import { clearState } from "./utils/storage";

const REASON_LABEL = {
  "same-floor-adjacent": "同フロア(隣接)",
  "same-floor": "同フロア",
  "cross-floor": "上下フロア",
  surplus: "余剰移動",
} as const;

const createId = (): string => {
  return crypto.randomUUID();
};

function App() {
  const { state, dispatch } = useAppContext();

  const [itemName, setItemName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const sortedFloors = useMemo(() => {
    return [...state.floors].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"),
    );
  }, [state.floors]);

  const floorNameMap = useMemo(() => {
    return new Map(sortedFloors.map((floor) => [floor.id, floor.name]));
  }, [sortedFloors]);

  const roomsByFloor = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const floor of sortedFloors) {
      map.set(floor.id, []);
    }
    for (const room of state.rooms) {
      const list = map.get(room.floorId) ?? [];
      list.push(room);
      map.set(room.floorId, list);
    }
    for (const [floorId, list] of map.entries()) {
      map.set(
        floorId,
        [...list].sort(
          (a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"),
        ),
      );
    }
    return map;
  }, [sortedFloors, state.rooms]);

  const sortedRooms = useMemo(() => {
    const result: Room[] = [];
    for (const floor of sortedFloors) {
      const rooms = roomsByFloor.get(floor.id) ?? [];
      result.push(...rooms);
    }
    return result;
  }, [roomsByFloor, sortedFloors]);

  const handleAddItem = () => {
    const trimmed = itemName.trim();
    if (!trimmed) {
      setMessage("物品名を入力してください。");
      return;
    }

    const duplicated = state.items.some((item) => item.name === trimmed);
    if (duplicated) {
      setMessage("同名の物品は登録できません。");
      return;
    }

    dispatch({ type: "ADD_ITEM", payload: { id: createId(), name: trimmed } });
    setItemName("");
    setMessage(null);
  };

  const handleAddFloor = () => {
    const trimmed = floorName.trim();
    if (!trimmed) {
      setMessage("フロア名を入力してください。");
      return;
    }

    if (state.floors.some((floor) => floor.name === trimmed)) {
      setMessage("同名のフロアは作成できません。");
      return;
    }

    const nextOrder =
      state.floors.length === 0
        ? 0
        : Math.max(...state.floors.map((floor) => floor.order)) + 1;

    const newFloorId = createId();
    dispatch({
      type: "ADD_FLOOR",
      payload: { id: newFloorId, name: trimmed, order: nextOrder },
    });
    setFloorName("");
    if (!selectedFloorId) {
      setSelectedFloorId(newFloorId);
    }
    setMessage(null);
  };

  const handleAddRoom = () => {
    const trimmed = roomName.trim();
    if (!trimmed) {
      setMessage("教室名を入力してください。");
      return;
    }

    if (!selectedFloorId) {
      setMessage("先にフロアを選択してください。");
      return;
    }

    const duplicated = state.rooms.some((room) => room.name === trimmed);
    if (duplicated) {
      setMessage("同名の教室は登録できません。");
      return;
    }

    const nextOrder = (roomsByFloor.get(selectedFloorId) ?? []).length;

    dispatch({
      type: "ADD_ROOM",
      payload: {
        id: createId(),
        name: trimmed,
        floorId: selectedFloorId,
        order: nextOrder,
      },
    });
    setRoomName("");
    setMessage(null);
  };

  const handleCountChange = (
    phase: "before" | "after",
    roomId: string,
    itemId: string,
    value: string,
  ) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    dispatch({
      type: "SET_COUNT",
      payload: { phase, roomId, itemId, count: Math.floor(parsed) },
    });
  };

  const handlePlan = () => {
    const validationErrors: string[] = [];

    if (state.items.length === 0) {
      validationErrors.push("物品が登録されていません。");
    }

    if (state.floors.length === 0) {
      validationErrors.push("フロアが登録されていません。");
    }

    if (state.rooms.length === 0) {
      validationErrors.push("教室が登録されていません。");
    }

    for (const room of sortedRooms) {
      for (const item of state.items) {
        const before = state.beforeCounts[room.id]?.[item.id] ?? 0;
        const after = state.afterCounts[room.id]?.[item.id] ?? 0;

        if (
          !Number.isFinite(before) ||
          before < 0 ||
          !Number.isInteger(before)
        ) {
          validationErrors.push(
            `${item.name}: ${floorNameMap.get(room.floorId) ?? "未設定"} ${room.name} の移動前個数が不正です。`,
          );
        }

        if (!Number.isFinite(after) || after < 0 || !Number.isInteger(after)) {
          validationErrors.push(
            `${item.name}: ${floorNameMap.get(room.floorId) ?? "未設定"} ${room.name} の移動後個数が不正です。`,
          );
        }
      }
    }

    const missingSurplusItems = state.items
      .filter((item) => {
        const beforeTotal = sortedRooms.reduce(
          (sum, room) => sum + (state.beforeCounts[room.id]?.[item.id] ?? 0),
          0,
        );
        const afterTotal = sortedRooms.reduce(
          (sum, room) => sum + (state.afterCounts[room.id]?.[item.id] ?? 0),
          0,
        );
        const hasSurplus = beforeTotal > afterTotal;
        const hasRule = Boolean(state.surplusRules[item.id]);
        return hasSurplus && !hasRule;
      })
      .map((item) => item.name);

    if (missingSurplusItems.length > 0) {
      validationErrors.push(
        `余剰物品置き場が未設定です: ${missingSurplusItems.join("、")}`,
      );
    }

    if (validationErrors.length > 0) {
      dispatch({
        type: "SET_PLAN_RESULT",
        payload: { moves: [], planningErrors: validationErrors },
      });
      setMessage(
        "不備があるため計画を作成できません。内容を確認してください。",
      );
      return;
    }

    const result = generateMovePlan(state);
    if (result.errors.length > 0) {
      dispatch({
        type: "SET_PLAN_RESULT",
        payload: { moves: [], planningErrors: result.errors },
      });
      setMessage(
        "不備があるため計画を作成できません。内容を確認してください。",
      );
      return;
    }

    dispatch({
      type: "SET_PLAN_RESULT",
      payload: { moves: result.moves, planningErrors: result.errors },
    });
    setMessage("移動計画を生成しました。");
  };

  const handleExport = () => {
    const json = exportStateAsJson(state);
    const stamp = new Date().toISOString().replaceAll(":", "-");
    triggerJsonDownload(`festival-data-${stamp}.json`, json);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const raw = await file.text();
    const parsed = parseImportedJson(raw);
    if (!parsed.ok) {
      setMessage(`インポート失敗: ${parsed.error}`);
      return;
    }

    const confirmReplace = window.confirm(
      "現在のデータをすべて置き換えます。よろしいですか？",
    );
    if (!confirmReplace) {
      return;
    }

    dispatch({ type: "REPLACE_STATE", payload: parsed.state });
    setMessage("インポートが完了しました。");
  };

  const handleReset = () => {
    const confirmed = window.confirm(
      "ローカルの全データを削除します。よろしいですか？",
    );
    if (!confirmed) {
      return;
    }

    clearState();
    dispatch({ type: "CLEAR_ALL" });
    setMessage("データを初期化しました。");
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            物品移動システム
          </h1>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePlan}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              移動計画を生成
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              JSONエクスポート
            </button>
            <label className="cursor-pointer rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              JSONインポート
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImport}
              />
            </label>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              データ初期化
            </button>
            <Link
              to="/room-plans"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              教室別計画ページ
            </Link>
          </div>
        </div>
        {message ? (
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            {message}
          </p>
        ) : null}
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
            1. 物品登録
          </h2>
          <div className="mb-3 flex gap-2">
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="例: 机"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={handleAddItem}
              className="rounded-lg bg-slate-900 px-4 py-2 whitespace-nowrap text-white dark:bg-slate-100 dark:text-slate-900"
            >
              追加
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {state.items.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800"
              >
                <span>{item.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() =>
                      dispatch({
                        type: "MOVE_ITEM",
                        payload: { itemId: item.id, direction: "up" },
                      })
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === state.items.length - 1}
                    onClick={() =>
                      dispatch({
                        type: "MOVE_ITEM",
                        payload: { itemId: item.id, direction: "down" },
                      })
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "REMOVE_ITEM",
                        payload: { itemId: item.id },
                      })
                    }
                    className="text-rose-600 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
            2. フロア作成・教室並び替え
          </h2>
          <div className="mb-4 grid gap-2 sm:grid-cols-[1fr,90px]">
            <input
              value={floorName}
              onChange={(e) => setFloorName(e.target.value)}
              placeholder="例: 1F"
              className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={handleAddFloor}
              className="rounded-lg bg-slate-900 px-3 py-2 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              作成
            </button>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr,1fr,80px]">
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="例: 1-1"
              className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
            <select
              value={selectedFloorId}
              onChange={(e) => setSelectedFloorId(e.target.value)}
              className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="">フロアを選択</option>
              {sortedFloors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddRoom}
              className="rounded-lg bg-slate-900 px-3 py-2 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              追加
            </button>
          </div>

          <ul className="space-y-2 text-sm">
            {sortedFloors.map((floor) => {
              const floorRooms = roomsByFloor.get(floor.id) ?? [];
              return (
                <li
                  key={floor.id}
                  className="space-y-2 rounded-lg bg-slate-100 p-3 dark:bg-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{floor.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedFloorId === floor.id) {
                          setSelectedFloorId("");
                        }
                        dispatch({
                          type: "REMOVE_FLOOR",
                          payload: { floorId: floor.id },
                        });
                      }}
                      className="text-rose-600 hover:underline"
                    >
                      フロア削除
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={floor.order === 0}
                      onClick={() =>
                        dispatch({
                          type: "MOVE_FLOOR",
                          payload: { floorId: floor.id, direction: "up" },
                        })
                      }
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                    >
                      フロア↑
                    </button>
                    <button
                      type="button"
                      disabled={floor.order === sortedFloors.length - 1}
                      onClick={() =>
                        dispatch({
                          type: "MOVE_FLOOR",
                          payload: { floorId: floor.id, direction: "down" },
                        })
                      }
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                    >
                      フロア↓
                    </button>
                  </div>
                  {floorRooms.length === 0 ? (
                    <p className="text-xs text-slate-500">教室は未登録です</p>
                  ) : (
                    <ul className="space-y-1">
                      {floorRooms.map((room, index) => (
                        <li
                          key={room.id}
                          className="flex items-center justify-between rounded bg-white/60 px-2 py-1 dark:bg-slate-900/60"
                        >
                          <span>
                            {index + 1}. {room.name}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() =>
                                dispatch({
                                  type: "MOVE_ROOM",
                                  payload: { roomId: room.id, direction: "up" },
                                })
                              }
                              className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={index === floorRooms.length - 1}
                              onClick={() =>
                                dispatch({
                                  type: "MOVE_ROOM",
                                  payload: {
                                    roomId: room.id,
                                    direction: "down",
                                  },
                                })
                              }
                              className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                dispatch({
                                  type: "REMOVE_ROOM",
                                  payload: { roomId: room.id },
                                })
                              }
                              className="text-rose-600 hover:underline"
                            >
                              削除
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-300">
            隣り合わせ教室は同じフロア内の並び順で、隣り合わせフロアはフロア並び順で自動判定されます。
          </p>
        </article>
      </section>

      {(["before", "after"] as const).map((phase) => (
        <section
          key={phase}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 overflow-x-auto"
        >
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {phase === "before" ? "3. 移動前個数" : "4. 移動後個数"}
          </h2>
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left dark:border-slate-700 dark:bg-slate-800">
                  教室
                </th>
                {state.items.map((item) => (
                  <th
                    key={item.id}
                    className="border border-slate-300 bg-slate-100 p-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {item.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRooms.map((room) => (
                <tr key={room.id}>
                  <td className="whitespace-nowrap border border-slate-300 p-2 dark:border-slate-700">
                    {floorNameMap.get(room.floorId) ?? "未設定"} {room.name}
                  </td>
                  {state.items.map((item) => (
                    <td
                      key={item.id}
                      className="border border-slate-300 p-1 dark:border-slate-700"
                    >
                      <input
                        type="number"
                        min={0}
                        value={
                          (phase === "before"
                            ? state.beforeCounts
                            : state.afterCounts)[room.id]?.[item.id] ?? 0
                        }
                        onChange={(event) =>
                          handleCountChange(
                            phase,
                            room.id,
                            item.id,
                            event.target.value,
                          )
                        }
                        className="w-20 rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
          5. 余剰物品置き場設定
        </h2>
        <div className="grid gap-2 md:grid-cols-2">
          {state.items.map((item) => (
            <label
              key={item.id}
              className="grid gap-1 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800"
            >
              <span>{item.name}</span>
              <select
                value={state.surplusRules[item.id] ?? ""}
                onChange={(event) =>
                  dispatch({
                    type: "SET_SURPLUS_RULE",
                    payload: { itemId: item.id, roomId: event.target.value },
                  })
                }
                className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">選択してください</option>
                <option value={SURPLUS_KEEP_ORIGIN}>●元の教室に残す</option>
                {sortedRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {floorNameMap.get(room.floorId) ?? "未設定"} {room.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
          6. 計画結果
        </h2>
        {state.planningErrors.length > 0 ? (
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-rose-700 dark:text-rose-300">
            {state.planningErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left dark:border-slate-700 dark:bg-slate-800">
                  物品
                </th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left dark:border-slate-700 dark:bg-slate-800">
                  移動元
                </th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left dark:border-slate-700 dark:bg-slate-800">
                  移動先
                </th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-right dark:border-slate-700 dark:bg-slate-800">
                  個数
                </th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left dark:border-slate-700 dark:bg-slate-800">
                  理由
                </th>
              </tr>
            </thead>
            <tbody>
              {state.moves.map((move, index) => {
                const item = state.items.find((x) => x.id === move.itemId);
                const from = state.rooms.find((x) => x.id === move.fromRoomId);
                const to = state.rooms.find((x) => x.id === move.toRoomId);

                return (
                  <tr
                    key={`${move.itemId}-${move.fromRoomId}-${move.toRoomId}-${index}`}
                  >
                    <td className="border border-slate-300 p-2 dark:border-slate-700">
                      {item?.name ?? move.itemId}
                    </td>
                    <td className="border border-slate-300 p-2 dark:border-slate-700">
                      {from
                        ? `${floorNameMap.get(from.floorId) ?? "未設定"} ${from.name}`
                        : move.fromRoomId}
                    </td>
                    <td className="border border-slate-300 p-2 dark:border-slate-700">
                      {to
                        ? `${floorNameMap.get(to.floorId) ?? "未設定"} ${to.name}`
                        : move.toRoomId}
                    </td>
                    <td className="border border-slate-300 p-2 text-right dark:border-slate-700">
                      {move.quantity}
                    </td>
                    <td className="border border-slate-300 p-2 dark:border-slate-700">
                      {REASON_LABEL[move.reason]}
                    </td>
                  </tr>
                );
              })}
              {state.moves.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="border border-slate-300 p-3 text-center text-slate-500 dark:border-slate-700"
                  >
                    計画未生成です
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
