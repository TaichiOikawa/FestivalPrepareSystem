import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../context/useAppContext";

const REASON_LABEL = {
  "same-floor-adjacent": "同フロア(隣接)",
  "same-floor": "同フロア",
  "cross-floor": "上下フロア",
  surplus: "余剰移動",
} as const;

export default function RoomPlanPage() {
  const { state } = useAppContext();

  const sortedFloors = useMemo(() => {
    return [...state.floors].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"),
    );
  }, [state.floors]);

  const floorNameMap = useMemo(() => {
    return new Map(sortedFloors.map((floor) => [floor.id, floor.name]));
  }, [sortedFloors]);

  const sortedRooms = useMemo(() => {
    return [...state.rooms].sort((a, b) => {
      const floorA = sortedFloors.find((x) => x.id === a.floorId)?.order ?? 0;
      const floorB = sortedFloors.find((x) => x.id === b.floorId)?.order ?? 0;
      if (floorA !== floorB) {
        return floorA - floorB;
      }
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.name.localeCompare(b.name, "ja");
    });
  }, [sortedFloors, state.rooms]);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            教室別移動計画
          </h1>
          <Link
            to="/"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            メインへ戻る
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {sortedRooms.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-300">
            教室が登録されていません。
          </p>
        ) : (
          <div className="space-y-4">
            {sortedRooms.map((room) => {
              const outboundMoves = state.moves.filter(
                (move) => move.fromRoomId === room.id,
              );
              const inboundMoves = state.moves.filter(
                (move) => move.toRoomId === room.id,
              );

              return (
                <article
                  key={room.id}
                  className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                >
                  <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {floorNameMap.get(room.floorId) ?? "未設定"} {room.name}
                  </h2>

                  <div className="mb-4 overflow-auto">
                    <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      物品個数（移動前 / 移動後）
                    </h3>
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border border-slate-300 bg-slate-100 p-2 text-left dark:border-slate-700 dark:bg-slate-800">
                            物品
                          </th>
                          <th className="border border-slate-300 bg-slate-100 p-2 text-right dark:border-slate-700 dark:bg-slate-800">
                            移動前
                          </th>
                          <th className="border border-slate-300 bg-slate-100 p-2 text-right dark:border-slate-700 dark:bg-slate-800">
                            移動後
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.items.map((item) => {
                          const beforeCount =
                            state.beforeCounts[room.id]?.[item.id] ?? 0;
                          const afterCount =
                            state.afterCounts[room.id]?.[item.id] ?? 0;

                          return (
                            <tr key={`${room.id}-${item.id}`}>
                              <td className="border border-slate-300 p-2 dark:border-slate-700">
                                {item.name}
                              </td>
                              <td className="border border-slate-300 p-2 text-right dark:border-slate-700">
                                {beforeCount}
                              </td>
                              <td className="border border-slate-300 p-2 text-right dark:border-slate-700">
                                {afterCount}
                              </td>
                            </tr>
                          );
                        })}
                        {state.items.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3}
                              className="border border-slate-300 p-2 text-center text-slate-500 dark:border-slate-700 dark:text-slate-300"
                            >
                              物品が登録されていません
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        搬出指示
                      </h3>
                      <ul className="space-y-1 text-sm">
                        {outboundMoves.length === 0 ? (
                          <li className="text-slate-500 dark:text-slate-300">
                            指示なし
                          </li>
                        ) : (
                          outboundMoves.map((move, index) => {
                            const item = state.items.find(
                              (x) => x.id === move.itemId,
                            );
                            const target = state.rooms.find(
                              (x) => x.id === move.toRoomId,
                            );
                            return (
                              <li
                                key={`out-${room.id}-${move.itemId}-${move.toRoomId}-${index}`}
                                className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800"
                              >
                                {item?.name ?? move.itemId} {move.quantity}個{" "}
                                {"->"}{" "}
                                {target
                                  ? `${floorNameMap.get(target.floorId) ?? "未設定"} ${target.name}`
                                  : move.toRoomId}
                                （{REASON_LABEL[move.reason]}）
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        搬入指示
                      </h3>
                      <ul className="space-y-1 text-sm">
                        {inboundMoves.length === 0 ? (
                          <li className="text-slate-500 dark:text-slate-300">
                            指示なし
                          </li>
                        ) : (
                          inboundMoves.map((move, index) => {
                            const item = state.items.find(
                              (x) => x.id === move.itemId,
                            );
                            const source = state.rooms.find(
                              (x) => x.id === move.fromRoomId,
                            );
                            return (
                              <li
                                key={`in-${room.id}-${move.itemId}-${move.fromRoomId}-${index}`}
                                className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800"
                              >
                                {item?.name ?? move.itemId} {move.quantity}個{" "}
                                {"<-"}{" "}
                                {source
                                  ? `${floorNameMap.get(source.floorId) ?? "未設定"} ${source.name}`
                                  : move.fromRoomId}
                                （{REASON_LABEL[move.reason]}）
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
