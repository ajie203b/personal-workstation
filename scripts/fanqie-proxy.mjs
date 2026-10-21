/**
 * 本机 CORS 代理：只给「个人工作站」网页版访问番茄用。
 *
 *   node scripts/fanqie-proxy.mjs
 *
 * 然后在工具 → 番茄小说 → 搜索框里直接搜（网页版搜索需要它；安卓 App 不需要）。
 *
 * 安全约束：
 * - 只监听 127.0.0.1，不暴露到局域网；
 * - 只允许 GET，只放行番茄/图片域名；
 * - 不记录 Cookie、不转发请求头白名单以外的内容；
 * - 上游重定向后的域名同样要过白名单，避免被当成任意代理。
 */
import http from 'node:http'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT || 8787)
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED = /(^|\.)(fanqienovel\.com|fqnovel\.com|fqnovelpic\.com|fanqiesdkpic\.com|byteimg\.com|bing\.com)$/i
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Fq-Cookie, X-Fq-Referer',
  'Access-Control-Max-Age': '86400',
}

function fail(res, status, message) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(message)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (req.method !== 'GET') {
    fail(res, 405, '只支持 GET')
    return
  }

  let target
  try {
    const here = new URL(req.url || '/', `http://${req.headers.host || HOST}`)
    const raw = here.searchParams.get('url')
    if (!raw) {
      fail(res, 400, '缺少 ?url=')
      return
    }
    target = new URL(raw)
  } catch {
    fail(res, 400, 'url 不是合法地址')
    return
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    fail(res, 400, '只支持 http/https')
    return
  }
  if (!ALLOWED.test(target.hostname)) {
    fail(res, 403, `域名不在白名单：${target.hostname}`)
    return
  }

  const isBing = /(^|\.)bing\.com$/i.test(target.hostname)
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Accept: isBing
      ? 'application/rss+xml, application/xml, text/xml, */*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    Referer: isBing ? 'https://cn.bing.com/' : String(req.headers['x-fq-referer'] || 'https://fanqienovel.com/'),
  }
  // 只在请求带了这个头时才转发 Cookie（避免把代理变成登录态泄漏点）
  if (req.headers['x-fq-cookie']) headers.Cookie = String(req.headers['x-fq-cookie'])

  try {
    const upstream = await fetch(target, { headers, redirect: 'follow' })
    if (!ALLOWED.test(new URL(upstream.url).hostname)) {
      fail(res, 502, '上游重定向到了白名单以外的地址')
      return
    }
    const len = Number(upstream.headers.get('content-length') || 0)
    if (len > MAX_BYTES) {
      fail(res, 413, '响应体过大')
      return
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) {
      fail(res, 413, '响应体过大')
      return
    }
    res.writeHead(upstream.status, {
      ...CORS,
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(buf)
    console.log(`${upstream.status} ${target.hostname}${target.pathname} (${buf.byteLength}B)`)
  } catch (e) {
    fail(res, 502, `上游请求失败：${e instanceof Error ? e.message : 'unknown'}`)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`\n番茄代理已启动：http://${HOST}:${PORT}`)
  console.log('网页版在「工具 → 番茄小说」直接搜书名即可；安卓 App 不需要它。')
  console.log('只监听本机，Ctrl+C 退出。\n')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
  })
}
