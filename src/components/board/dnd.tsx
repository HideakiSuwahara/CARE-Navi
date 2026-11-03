"use client";

/**
 * 職員チップのドラッグ＆ドロップ（CLAUDE.md §2-8: D&D は職員チップの割当だけ）。
 * - パレットの人 → カード: 担当にする
 * - カードのチップ → 別のカード: 担当を移す
 * - カードのチップ → パレット: 担当を外す
 * 判定は domain の checkAssignment。二重登録だけ止め、他は注意を添えて許可する。
 */

import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, type CollisionDetection, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useState, type CSSProperties, type ReactNode } from "react";
import { checkAssignment } from "@/domain/checks";
import { assignEvents, moveAssignmentEvents, unassignEvents } from "@/domain/commands";
import type { ID } from "@/domain/types";
import type { Engine } from "@/store/engine";

export type DragData = { kind: "staff"; staffId: ID } | { kind: "chip"; staffId: ID; fromTaskId: ID };
export type DropData = { kind: "task"; taskId: ID } | { kind: "palette" };

/**
 * 指（マウス）の下のカードにだけ落とす。何もない所で離したら何もしない（違うカードに吸われないように）。
 * キーボードで動かすときは指の位置がないので、重なりで決める。
 */
const collision: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args));

export function BoardDnd({ engine, children, onNotice }: { engine: Engine | null; children: ReactNode; onNotice: (text: string) => void }) {
  const sensors = useSensors(
    // 少し動かしてから掴む（押すだけの操作は今までどおり）
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Enter は「詳細を開く」に空けておき、スペースで持ち上げる
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  // 読み上げ用（英語の既定文と内部 ID を出さない）
  const who = (d: DragData | undefined) => (d && engine ? (engine.state.staff[d.staffId]?.surname ?? "") : "");
  const where = (d: DropData | undefined) => (!d || !engine ? "" : d.kind === "palette" ? "出勤者一覧" : (engine.state.tasks[d.taskId]?.name ?? "カード"));
  // 持ち上げている人の名前（パレットのスクロールに切られないよう、上に重ねて出す）
  const [lifted, setLifted] = useState<string | null>(null);
  const onDragStart = (e: DragStartEvent) => {
    const drag = e.active.data.current as DragData | undefined;
    setLifted(drag && engine ? (engine.state.staff[drag.staffId]?.surname ?? null) : null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setLifted(null);
    if (!engine || !e.over) return;
    const drag = e.active.data.current as DragData | undefined;
    const drop = e.over.data.current as DropData | undefined;
    if (!drag || !drop) return;
    const state = engine.state;
    const surname = state.staff[drag.staffId]?.surname ?? "";

    if (drop.kind === "palette") {
      if (drag.kind !== "chip") return;
      const task = state.tasks[drag.fromTaskId];
      await engine.dispatch(unassignEvents(state, drag.fromTaskId, drag.staffId, engine.context()), `${surname}さんを「${task?.name ?? ""}」の担当から外しました`);
      return;
    }

    const task = state.tasks[drop.taskId];
    if (!task) return;
    if (drag.kind === "chip" && drag.fromTaskId === drop.taskId) return;
    const issues = checkAssignment(state, drop.taskId, drag.staffId);
    const blocked = issues.find((i) => i.severity === "block");
    if (blocked) {
      onNotice(`${surname}さん: ${blocked.message}`);
      return;
    }
    const note = issues[0] ? `（注意: ${issues[0].message}）` : "";
    if (drag.kind === "chip") {
      const from = state.tasks[drag.fromTaskId];
      await engine.dispatch(
        moveAssignmentEvents(state, drag.fromTaskId, drop.taskId, drag.staffId, engine.context()),
        `${surname}さんを「${from?.name ?? ""}」から「${task.name}」へ移しました${note}`,
      );
    } else {
      await engine.dispatch(assignEvents(drop.taskId, drag.staffId, engine.context()), `${surname}さんを「${task.name}」の担当にしました${note}`);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      // 端のごく近くでだけ自動で送る（既定の20%だと、パレットの上の人を運ぶ途中で時間割が勝手に動く）
      autoScroll={{ threshold: { x: 0.04, y: 0.06 } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setLifted(null)}
      accessibility={{
        screenReaderInstructions: { draggable: "Enter で業務の詳細（外すボタン）を開きます。スペースキーで持ち上げ、矢印キーで動かし、もう一度スペースキーで置きます。Esc でやめます。" },
        announcements: {
          onDragStart: ({ active }) => `${who(active.data.current as DragData | undefined)}さんを持ち上げました`,
          onDragOver: ({ over }) => (over ? `${where(over.data.current as DropData | undefined)}の上です` : "カードの外です"),
          onDragEnd: ({ active, over }) => (over ? `${who(active.data.current as DragData | undefined)}さんを${where(over.data.current as DropData | undefined)}に置きました` : "やめました"),
          onDragCancel: () => "やめました",
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {lifted && (
          <span className="inline-flex h-[36px] cursor-grabbing items-center rounded-full border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] px-3 text-[15px] font-bold text-[var(--cn-accent)] shadow-lg">
            {lifted}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** ドラッグできる職員（パレットの人・カードのチップ） */
export function useStaffDrag(id: string, data: DragData) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data });
  // 元の場所は薄くするだけ（動く絵は DragOverlay）
  const style = isDragging ? { opacity: 0.4 } : undefined;
  return { dragProps: { ...attributes, ...listeners }, setNodeRef, style, isDragging };
}

/** 落とせる場所（カード・パレット） */
export function DropZone({ id, data, children, className, style }: { id: string; data: DropData; children: ReactNode; className?: string; style?: CSSProperties }) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div ref={setNodeRef} style={style} className={`${className ?? ""} ${isOver ? "rounded-[12px] outline outline-[3px] outline-[var(--cn-accent)]" : ""}`}>
      {children}
    </div>
  );
}
