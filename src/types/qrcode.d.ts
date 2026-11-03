/** qrcode（型定義が同梱されていないので、使う分だけ） */
declare module "qrcode" {
  export function toDataURL(text: string, options?: { width?: number; margin?: number; errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): Promise<string>;
}
