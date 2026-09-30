# Music ID Grabber (console edition) v1.2

A paste-into-your-browser tool that pulls numeric music/asset IDs out of a web
page (or out of the site's own background API traffic), dedupes them, and
exports a CSV that Excel/WPS can open directly.

It exists to solve one problem: you should never have to copy thousands of IDs
by hand, and you should never have to open every single post.

**Every file in this folder is pure ASCII (zero Chinese bytes).**

---

## 1. Quick start (3 steps)

1. Open the target page in Chrome / Edge / 360 / QQ Browser.
2. Press **F12** and click the **Console** tab.
3. Open `musicid-grabber.js`, select all, copy, paste into the Console, press **Enter**.

> **The one trap everyone hits:** Chrome and Edge block the first paste with
> `Warning: Don't paste code you don't understand...`
> Fix: type **`allow pasting`** in the Console and press Enter, then paste again.
> You only do this once per browser. Firefox has no such block.

A dark panel titled **Music ID Grabber v1.2** appears in the bottom-right, and
the network sniffer starts working immediately.

---

## 2. The eight buttons

| Button | What it does | Use it when |
|---|---|---|
| `1) Grab this page` | Extracts IDs from what is rendered right now | One long page holds everything |
| `2) Auto pages (list pages)` | Walks `?page=` / `pn=` URLs by itself | Classic list pages (forums, BBS) |
| `3) Follow mode (scroll pages)` | Re-scans the DOM every 2.5s while you browse | Infinite-scroll feeds, Bilibili |
| `4) Auto-scroll to load all` | Scrolls the page for you so lazy content loads | Long feeds: let it run, do nothing |
| `5) Sniffer: ON / OFF` | Scans every JSON/text response the site fetches behind the scenes | **App-like sites** (communities, channels, SPAs) |
| `6) Show captured APIs` | Prints the endpoints that returned IDs; also copies them | When you want to know which API holds the data |
| `7) Export CSV` | Downloads a CSV (UTF-8 + BOM, no mojibake in Excel) | When you are done |
| `8) Clear all data` | Wipes stored records | Before switching to another list |

Bottom checkbox **Filter noise (recommended)**: checked = strict mode, drops
like counts / phone numbers / dates / floor numbers.

### Why the sniffer matters

Normal DOM scraping only sees what is painted on screen. App-like sites load
their content as JSON in the background, and each post may only be fetched when
you open it. The sniffer hooks `fetch` and `XMLHttpRequest`, reads those
responses as they fly by, and harvests IDs from them. **You browse; it records.**

---

## 3. Working through a whole community channel

Opening every post by hand is the worst possible plan. Do it in this order.

**Step 0 - look for a compiled source first (30 seconds).**
Check the channel's pinned post, highlights, announcements and any attached
document. Community channels almost always have one summary post with the full
list. If it exists, you are already done.

**Step 1 - let the feed load itself.**
Open the channel's post list on the web, paste the script, then click
`4) Auto-scroll to load all` and leave the tab in front. The sniffer records
every post body that arrives with the feed.

**Step 2 - export and look at the count.**
Click `7) Export CSV`. In the CSV, the `Source` column tells you where each ID
came from:
- `api-key` - found next to an explicit key such as `audioId` (highest trust)
- `api` - found inside some JSON response (good trust)
- `page` - found in the rendered page text

**Step 3 - only if posts still need opening.**
If the feed only returns titles, then open posts one by one - but you still do
**not** copy anything: keep `3) Follow mode` or the sniffer on, click through the
posts, and every one gets recorded as it loads.

**Step 4 - get the endpoint (this is the real unlock).**
Click `6) Show captured APIs`. The list is printed in the Console and copied to
your clipboard. Send that list over: with the real endpoint and its paging
parameter, a one-click "walk the entire channel" becomes possible, instead of
scrolling at all.

---

## 4. It still reads Chinese pages fine

The UI is English and the sources are ASCII-only, but that does not limit what
it can read. Chinese noise words (likes / views / floor) are written as
`\uXXXX` escapes inside a regex, so the file stays ASCII while the filter still
works on Chinese text. Chinese titles are paired with their IDs as usual.

The same trick protects the timestamp filter: JSON keys like `createTime`,
`ts`, `updateTime` are matched through escapes, so a Unix timestamp is not
mistaken for an asset ID.

---

## 5. Where the result goes

Clicking `7) Export CSV` downloads a file named like:

```
music-ids-pd.qq.com-1735689000000.csv
```

It lands in your browser's **Downloads** folder. Columns:

| ID | Name/Context | Source | SourceURL | Page | CapturedAt |
|---|---|---|---|---|---|

`Name/Context` is the raw text around the ID. It is a hint for manual checking,
not a guaranteed song title.

---

## 6. Safety notes

- **Nothing is uploaded.** Records live in your own browser `localStorage`.
- The sniffer **only reads** responses. It never modifies, blocks or delays a
  request, and response bodies are scanned in memory then discarded - only the
  extracted IDs and the endpoint URL are kept.
- No password or cookie access, no page modification, no third-party library.
- Nothing is installed. It is pasted code; closing the tab removes it.
- The panel has `8) Clear all data` and `Close panel (keep data)`.

---

## 7. Tests (all automated, nothing to click)

**a) Pure logic**

```bash
node self-test.js
```

Pager detection, next-page URL building, ID extraction, noise filtering, dedupe,
JSON blob scanning, timestamp-key filtering. Currently **26 checks, all pass**.

**b) Rendered page, end to end**

```bash
msedge --headless=new --disable-gpu --dump-dom --virtual-time-budget=6000 smoke-test.html
```

```json
{"panel":true,"added":5,"nameOk":true,"ids":[1836547290,1836547291,1837007494,1838999999,1841234567],"error":null}
```

**c) Network sniffer, end to end**

```bash
msedge --headless=new --disable-gpu --dump-dom --virtual-time-budget=9000 sniffer-test.html
```

Simulates an app-like site serving 4 pages of JSON, containing real asset ids, a
13-digit post id and Unix timestamps. Expected:

```json
{"jsonCalls":4,"apiKeyHits":12,"looseApiHits":0,"pageHits":0,"timestampLeaked":false,
 "postIdLeaked":false,"endpointCount":1,"topEndpointHits":12,"total":12,
 "ids":[1830000100,...,1830000402]}
```

All 12 asset ids captured, zero timestamps leaked, zero post ids leaked.

> These browser tests already caught two real bugs that unit tests could not:
> `document.cloneNode(true)` returns an **empty** document (no page text was
> ever scanned), and the endpoint grouping collapsed because a `data:` URL has
> no origin.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "wants verification -> stopped" | Site anti-bot | Switch to `3) Follow mode` and page manually |
| "No paging parameter found" | Page does not page via URL | Use `3)` or `4)` instead |
| Sniffer finds nothing | Content is rendered from HTML, not JSON | Click `1) Grab this page` instead |
| Too many `api` rows, few `api-key` rows | JSON full of unrelated numbers | Sort the CSV by `Source` and keep `api-key` first |
| Panel never appears | Paste blocked, or page CSP | Confirm `allow pasting`; try another browser |

---

## 9. Caveats

- An ID in hand does not mean it is usable. Many Roblox audio assets are
  private; verify availability after collecting.
- Keep the pace civil. The script sleeps between requests and autoscroll runs at
  1.6s per round; do not turn it into a fast concurrent crawler.
- This tool only converts content **you can already see** into a table. It does
  not bypass logins, captchas or paywalls.
