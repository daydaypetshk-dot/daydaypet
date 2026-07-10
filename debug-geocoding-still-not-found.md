[OPEN] Debug Session: geocoding-still-not-found

## Symptom
- 前後台輸入「屯門醫院 / 海港城」等香港地標，地址搜尋回傳空結果，UI 顯示「找不到該地址」。

## Hypotheses (Falsifiable)
- A: `/api/geocoding` 根本沒有被呼叫（仍在直連 Nominatim 或 fetch 路徑錯誤），因此永遠無結果。
- B: `/api/geocoding` 有被呼叫，但後端請求 Nominatim 被封鎖/403（User-Agent 或速率限制），導致空結果或錯誤。
- C: Nominatim 有回傳結果，但後端回傳格式與前端解析不一致（Array vs Object），導致前端誤判為空。
- D: Nominatim 在目前的 query 參數（尤其 viewbox/bounded）下回傳空；換成 countrycodes=hk 或移除 viewbox 後才有結果。
- E: 前端 debounce/abort 造成請求被取消或結果被後來的空回應覆蓋，最後看起來永遠空。

## Evidence Plan
1) 在 `/api/geocoding` 加入最小化 instrumentation，上報：收到的 q、組合出的 Nominatim URL、HTTP 狀態碼、回傳筆數、前 1 筆 display_name。
2) 在 `lib/pets/geocoding.ts` 加入 instrumentation，上報：前端拿到的 JSON 形狀與解析後筆數。
3) 重現一次搜尋「屯門醫院」「海港城」，收集 pre-fix logs。

## Fix Plan (After Evidence)
- 若驗證 D：改用 countrycodes=hk，移除 viewbox/bounded；並統一回傳格式或前端兼容。
- 若驗證 C：統一 API 回傳純陣列或前端解析兼容兩種格式。

