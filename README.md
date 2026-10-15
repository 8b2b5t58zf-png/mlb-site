# ⚾ 美國職棒大聯盟（MLB）賽事分析

用 MLB 官方免費 API（statsapi.mlb.com）即時抓資料的簡易網頁，全部中文顯示。

- 🔮 比賽勝負預測（簡易估算：勝率＋畢氏期望勝率＋主場優勢，非投注建議）
- 📝 賽後分析（依官方比分與數據自動整理）
- 聯盟戰績、各隊勝率圖、打擊／投手排行榜

使用方式：直接用瀏覽器開啟 `index.html` 即可。
`make_excel.py` 可產生 Excel 版分析表（需 Python 與 openpyxl）。

## 預測紀錄
GitHub Actions（`.github/workflows/daily-log.yml`）每天台灣時間 08:30、20:30 執行 `scripts/log_predictions.py`，
在比賽開打前記下預測、賽後補上結果，存於 `data/predictions.json`。
