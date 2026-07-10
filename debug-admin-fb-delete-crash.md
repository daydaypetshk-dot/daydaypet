# [OPEN] Debug Session: admin-fb-delete-crash

## Symptom
- `http://localhost:3000` 顯示 `An unexpected Turbopack error occurred`
- 需確認是否由 Facebook AI 待審批刪除功能引發

## Hypotheses
1. `dashboard/page.tsx` 新增的刪除流程在 client runtime 觸發例外
2. `app/api/admin/fb-posts/route.ts` 的 `DELETE` route 在 dev module evaluation 失敗
3. 待審批列表 JSX 使用了未初始化或無效的狀態/函式
4. 問題來自 HMR / Turbopack cache，而非 delete 邏輯本身

## Evidence Log
- `next dev`（Turbopack）runtime panic：
  - `Failed to write app endpoint /page`
  - `src/app/globals.css [app-client] (css)`
  - `PostCssTransformedAsset::process`
  - `os error 10054`
- `npm run build` 可成功，代表非 TypeScript / JSX syntax 問題
- 問題指向 dev tooling：Turbopack + PostCSS/CSS worker，而非 `DELETE` route 或刪除按鈕業務邏輯

## Root Cause
- Next 16 預設 Turbopack 在此 Windows 環境處理 `globals.css` 時崩潰，導致整站 dev runtime 500。

## Minimal Fix
- 將 `package.json` 的 `dev` script 改為 `next dev --webpack`

## Status
- fix-applied-awaiting-verification
