# Debug Session: sighting-no-logs
- **Status**: [OPEN]
- **Issue**: 提交最新目擊後，沒有收到 WhatsApp，且 /admin/notifications 無任何通知日誌（含 failed / skipped 都沒有）。
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-sighting-no-logs.ndjson

## Reproduction Steps
1. 開啟網站首頁，登入任一帳號。
2. 打開任一已上架（approved）的案件詳情彈窗。
3. 點「➕ 報告最新目擊」並提交。
4. 預期：收到 WhatsApp + 後台 /admin/notifications 出現 whatsapp_owner_sighting 日誌。
5. 實際：WhatsApp 未收到 + 後台完全無紀錄。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | API /api/pets/[id]/timeline 根本沒有被打到（前端走了別的路徑 / Service Worker / cache） | Med | Low | Pending |
| B | API 有跑到，但在進入 WhatsApp/Log 之前就提早 return（例如 status 非 approved / auth 失敗 / duplicate guard） | High | Low | Pending |
| C | WhatsApp 有呼叫但被 bridge 狀態阻擋（disabled/qr_ready/auth_failure），且錯誤被吞掉 | High | Low | Pending |
| D | notification_dispatch_logs 寫入因 schema/constraint/RLS 失敗，導致後台看不到任何紀錄 | High | Med | Pending |

## Log Evidence
- (待收集)

## Verification Conclusion
- (待確認 pre-fix vs post-fix)
