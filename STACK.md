# Stack

- Cloudflare Workers
- Hono + JSX
- Vite+
- TypeScript
- Cloudflare D1（内容を含まない匿名イベントのみ）
- IndexedDB / localStorage（読書棚と匿名セッション）
- 国立国会図書館サーチ OpenSearch API
- fast-xml-parser
- Vitest + Miniflare

Better Authは不要です。本、頁、評価、メモをサーバーへ保存せず、一人・一端末で登録なしに使う境界だからです。外部フォント、表紙画像、広告SDK、解析SDKも追加しません。

ブラウザーは書誌検索語を同一オリジンのPOSTへ送り、Workerが国立国会図書館サーチへ逐次転送します。検索語をD1へ保存せず、手入力を常に代替経路として残します。

現在は`yhay81`の非収益個人パイロットです。収益化または`haya-inc`移管前に、APIとデータ提供元の利用条件を再確認します。
