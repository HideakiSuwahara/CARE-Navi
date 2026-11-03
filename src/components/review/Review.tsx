"use client";

import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { hoursLabel, rangeLabel, weekLabel, weekReview, type HourBucket } from "@/domain/review";
import { fmtMin } from "@/domain/time";
import { useAppState } from "@/store/react";
import { SAMPLE_DATE } from "@/store/sample";

/**
 * 業務の見直し（PC、今週）。docs/screens.md §2、決定記録 0004 §8・0008
 * - 前提を常時表示（予定時間ベース・職員の評価には使いません）
 * - 左: 区分 × 時間帯の図（コア＝塗り、ノンコア＝斜線。休憩は含めない）と同じ数値の表。背後に介護助手等の勤務帯
 * - 右: ノンコアの枠（番別・枠別。個人別なし）。判断の言葉は書かない。「見直す ▾」の操作は作らない（0004 §8）
 */
export function Review({ date = SAMPLE_DATE }: { date?: string }) {
  const { state, ready } = useAppState();
  const w = useMemo(() => weekReview(state, date), [state, date]);
  const kinds = state.facility?.settings.categories ?? [];
  const coreName = kinds.find((c) => c.kind === "core")?.name ?? "コア業務";
  const noncoreName = kinds.find((c) => c.kind === "noncore")?.name ?? "ノンコア業務";
  const otherName = kinds.find((c) => c.kind === "other")?.name ?? "その他";
  const hasOther = w.totals.other > 0;

  if (!ready) return <p className="p-6 text-[15px] text-[var(--cn-muted)]">読み込んでいます…</p>;

  const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="review" />
      <main className="flex flex-col gap-4 p-5 text-[15px]">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[20px] font-bold">業務の見直し</h2>
          <span className="text-[16px]">今週 {weekLabel(w.dates)}</span>
        </div>
        <p role="note" className="rounded-xl border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] px-4 py-2.5 text-[15px]">
          <span className="font-bold">予定時間ベース</span>（業務表と当日の予定から計算。実施時間ではありません）。
          <span className="font-bold">配置を見直すための数字です。職員の評価には使いません。</span>
        </p>
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          予定時間 = 業務の長さ × 必要人数（施設が決めた予定値）。時間割ができている日（{w.fromDay.map(dayLabel).join("・") || "なし"}）はその日の予定、ほかの日は曜日の業務表から出しています。休憩と中止は含めません。
        </p>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,6fr)]">
          <section aria-labelledby="chart-title" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
            <h3 id="chart-title" className="text-[16px] font-bold">
              区分 × 時間帯（今週の合計・時間）
            </h3>
            <Legend coreName={coreName} noncoreName={noncoreName} otherName={hasOther ? otherName : undefined} bands={w.bands.map((b) => `${b.name}の勤務帯 ${fmtMin(b.startMin)}–${fmtMin(b.endMin)}`)} />
            <Chart buckets={w.buckets} bands={w.bands} coreName={coreName} noncoreName={noncoreName} otherName={otherName} hasOther={hasOther} />
            {w.bands.map((b) => (
              <p key={b.slotId} className="mt-1 text-[14px] text-[var(--cn-ink-soft)]">
                {b.name}の勤務帯は番の時刻（{fmtMin(b.startMin)}–{fmtMin(b.endMin)}）で示しています。今週の出勤予定:{" "}
                {b.days.length > 0 ? b.days.map((d) => `${dayLabel(d.date)} ${fmtMin(d.startMin)}–${fmtMin(d.endMin)}`).join("、") : "勤務表がまだ入っていません"}
              </p>
            ))}
            <details className="mt-3" open>
              <summary className="flex h-[44px] cursor-pointer items-center font-bold">数値の表</summary>
              <table className="w-full border-collapse text-[14px]">
                <caption className="sr-only">区分 × 時間帯の予定時間（今週の合計、時間）</caption>
                <thead>
                  <tr className="border-b border-[var(--cn-control-line)] text-left">
                    <th scope="col" className="py-1 pr-2 font-bold">時間帯</th>
                    <th scope="col" className="py-1 pr-2 text-right font-bold">{coreName}</th>
                    <th scope="col" className="py-1 pr-2 text-right font-bold">{noncoreName}</th>
                    {hasOther && <th scope="col" className="py-1 pr-2 text-right font-bold">{otherName}</th>}
                    <th scope="col" className="py-1 text-right font-bold">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {w.buckets.map((b) => (
                    <tr key={b.startMin} className="border-b border-[var(--cn-grid)]">
                      <th scope="row" className="py-0.5 pr-2 text-left font-normal">
                        {fmtMin(b.startMin)}–{fmtMin((b.startMin + 60) % 1440)}
                      </th>
                      <td className="py-0.5 pr-2 text-right tabular-nums">{hoursLabel(b.core)}</td>
                      <td className="py-0.5 pr-2 text-right tabular-nums">{hoursLabel(b.noncore)}</td>
                      {hasOther && <td className="py-0.5 pr-2 text-right tabular-nums">{hoursLabel(b.other)}</td>}
                      <td className="py-0.5 text-right tabular-nums">{hoursLabel(b.core + b.noncore + b.other)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--cn-control-line)] font-bold">
                    <th scope="row" className="py-1 pr-2 text-left">今週の合計</th>
                    <td className="py-1 pr-2 text-right tabular-nums">{hoursLabel(w.totals.core)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{hoursLabel(w.totals.noncore)}</td>
                    {hasOther && <td className="py-1 pr-2 text-right tabular-nums">{hoursLabel(w.totals.other)}</td>}
                    <td className="py-1 text-right tabular-nums">{hoursLabel(w.totals.core + w.totals.noncore + w.totals.other)}</td>
                  </tr>
                </tfoot>
              </table>
            </details>
          </section>

          <section aria-labelledby="nc-title" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
            <h3 id="nc-title" className="text-[16px] font-bold">
              {noncoreName}の枠（今週 {w.noncore.length}件）
            </h3>
            <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">番ごと・枠ごとの予定です。勤務帯の［中｜外］は、枠の時刻がその番の勤務帯にすっぽり入るかどうかです。</p>
            {w.noncore.length === 0 ? (
              <p className="rounded-lg bg-[var(--cn-ground)] p-3">今週の業務表に{noncoreName}の枠はありません。</p>
            ) : (
              <table className="w-full border-collapse text-[14px]">
                <caption className="sr-only">{noncoreName}の枠の一覧</caption>
                <thead>
                  <tr className="border-b border-[var(--cn-control-line)] text-left">
                    <th scope="col" className="min-w-[7em] py-1 pr-2 font-bold">業務</th>
                    <th scope="col" className="py-1 pr-2 font-bold">時刻</th>
                    <th scope="col" className="py-1 pr-2 font-bold">曜日</th>
                    <th scope="col" className="py-1 pr-2 font-bold">番</th>
                    {w.bands.map((b) => (
                      <th key={b.slotId} scope="col" className="py-1 pr-2 font-bold">
                        {b.name}の勤務帯
                      </th>
                    ))}
                    <th scope="col" className="whitespace-nowrap py-1 text-right font-bold">予定時間（時間）</th>
                  </tr>
                </thead>
                <tbody>
                  {w.noncore.map((r) => (
                    <tr key={r.key} className="border-b border-[var(--cn-grid)] align-top">
                      <td className="py-1.5 pr-2">
                        <span className="font-bold">{r.name}</span>
                        {r.groupName && <span className="block text-[13px] text-[var(--cn-ink-soft)]">{r.groupName}</span>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{rangeLabel(r)}</td>
                      <td className="py-1.5 pr-2">{r.dayCount === 7 ? "毎日" : r.weekdays}</td>
                      <td className="py-1.5 pr-2">{r.slotNames.length > 0 ? r.slotNames.join("・") : "なし"}</td>
                      {r.inBand.map((b) => (
                        <td key={b.name} className="py-1.5 pr-2">
                          <span className={`inline-flex rounded border px-1.5 font-bold ${b.inside ? "border-[var(--cn-accent)] text-[var(--cn-accent)]" : "border-dashed border-[var(--cn-control-line)]"}`}>
                            {b.inside ? "中" : "外"}
                          </span>
                        </td>
                      ))}
                      <td className="py-1.5 text-right tabular-nums">{hoursLabel(r.plannedMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 図（積み上げ棒、1本 = 時計の1時間。単位は時間）
// ---------------------------------------------------------------------------

const CORE = "var(--cn-core)";
const NONCORE = "var(--cn-noncore)";
const OTHER = "var(--cn-muted)";

function Swatch({ kind }: { kind: "core" | "noncore" | "other" | "band" }) {
  return (
    <svg width="18" height="14" aria-hidden="true" className="shrink-0">
      {kind === "band" ? (
        <rect x="0.5" y="0.5" width="17" height="13" rx="2" fill="var(--cn-band-bg)" stroke="var(--cn-band-line)" strokeDasharray="3 2" />
      ) : kind === "noncore" ? (
        <rect x="0" y="0" width="18" height="14" rx="3" fill="url(#cn-hatch)" />
      ) : (
        <rect x="0" y="0" width="18" height="14" rx="3" fill={kind === "core" ? CORE : OTHER} />
      )}
    </svg>
  );
}

function Legend({ coreName, noncoreName, otherName, bands }: { coreName: string; noncoreName: string; otherName?: string; bands: string[] }) {
  return (
    <ul aria-label="凡例" className="mb-2 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
      <li className="flex items-center gap-1.5">
        <Swatch kind="core" />
        {coreName}（塗り）
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch kind="noncore" />
        {noncoreName}（斜線）
      </li>
      {otherName && (
        <li className="flex items-center gap-1.5">
          <Swatch kind="other" />
          {otherName}
        </li>
      )}
      {bands.map((b) => (
        <li key={b} className="flex items-center gap-1.5">
          <Swatch kind="band" />
          {b}
        </li>
      ))}
    </ul>
  );
}

function Chart({
  buckets,
  bands,
  coreName,
  noncoreName,
  otherName,
  hasOther,
}: {
  buckets: HourBucket[];
  bands: { slotId: string; name: string; startMin: number; endMin: number }[];
  coreName: string;
  noncoreName: string;
  otherName: string;
  hasOther: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = 280;
  const padL = 44;
  const padB = 28;
  const padT = 10;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const maxMin = Math.max(60, ...buckets.map((b) => b.core + b.noncore + b.other));
  // 目盛り: 5時間きざみ（大きければ10）
  const maxH = maxMin / 60;
  const step = maxH > 60 ? 20 : maxH > 30 ? 10 : 5;
  const top = Math.ceil(maxH / step) * step;
  const y = (h: number) => padT + plotH - (h / top) * plotH;
  const slot = plotW / buckets.length;
  const bw = Math.max(6, slot - 6);
  const idxOf = (clock: number) => buckets.findIndex((b) => b.startMin === clock % 1440);
  const tip = hover !== null ? buckets[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="区分 × 時間帯の積み上げ棒グラフ。数値は下の表にあります">
        <defs>
          <pattern id="cn-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={NONCORE} />
            <rect width="2.2" height="6" fill="#ffffff" opacity="0.55" />
          </pattern>
        </defs>
        {/* 介護助手等の勤務帯（背後） */}
        {bands.map((b) => {
          const i0 = idxOf(b.startMin);
          const i1 = idxOf(b.endMin);
          if (i0 < 0) return null;
          const x0 = padL + i0 * slot;
          const x1 = padL + (i1 < 0 ? buckets.length : i1) * slot;
          return (
            <g key={b.slotId}>
              <rect x={x0} y={padT} width={x1 - x0} height={plotH} fill="var(--cn-band-bg)" stroke="var(--cn-band-line)" strokeDasharray="4 3" />
              <text x={x0 + 4} y={padT + 14} fontSize="12" fill="var(--cn-ink-soft)">
                {b.name} {fmtMin(b.startMin)}–{fmtMin(b.endMin)}
              </text>
            </g>
          );
        })}
        {/* 目盛り線（控えめに） */}
        {Array.from({ length: top / step + 1 }, (_, k) => k * step).map((h) => (
          <g key={h}>
            <line x1={padL} x2={W - 8} y1={y(h)} y2={y(h)} stroke="var(--cn-grid)" strokeWidth={h === 0 ? 1.5 : 1} />
            <text x={padL - 6} y={y(h) + 4} fontSize="12" textAnchor="end" fill="var(--cn-ink-soft)">
              {h}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const parts = [
            { v: b.core / 60, fill: CORE },
            { v: b.noncore / 60, fill: "url(#cn-hatch)" },
            ...(hasOther ? [{ v: b.other / 60, fill: OTHER }] : []),
          ];
          let acc = 0;
          const segs = parts.map((p) => {
            const y1 = y(acc);
            acc += p.v;
            const y0 = y(acc);
            // 段の間に 2px のすき間
            return { ...p, y: y0, h: Math.max(0, y1 - y0 - (p.v > 0 ? 2 : 0)) };
          });
          const lastSeg = segs.map((z) => z.h > 0).lastIndexOf(true);
          return (
            <g key={b.startMin} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* 当たり判定は棒より広く */}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              {segs.map((sg, k) => (sg.h > 0 ? <rect key={k} x={x} y={sg.y} width={bw} height={sg.h} rx={k === lastSeg ? 3 : 0} fill={sg.fill} /> : null))}
              {i % 3 === 0 && (
                <text x={padL + i * slot + slot / 2} y={H - 8} fontSize="12" textAnchor="middle" fill="var(--cn-ink-soft)">
                  {fmtMin(b.startMin)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && hover !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute top-2 rounded-lg border border-[var(--cn-control-line)] bg-white px-3 py-2 text-[14px] shadow"
          style={{ left: `${Math.min(80, ((padL + hover * slot) / W) * 100)}%` }}
        >
          <p className="font-bold">
            {fmtMin(tip.startMin)}–{fmtMin((tip.startMin + 60) % 1440)}
          </p>
          <p>
            {coreName} {hoursLabel(tip.core)} 時間
          </p>
          <p>
            {noncoreName} {hoursLabel(tip.noncore)} 時間
          </p>
          {hasOther && (
            <p>
              {otherName} {hoursLabel(tip.other)} 時間
            </p>
          )}
        </div>
      )}
    </div>
  );
}
