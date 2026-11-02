import { toCsv } from "@/domain/residentsIO";

/** CSV を Blob でダウンロードする（UTF-8 BOM つき。Excel で開ける） */
export function downloadCsv(filename: string, rows: string[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // すぐに消すとファイル名が失われることがあるので、少し待ってから片付ける
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
