// Mock OpenAI 兼容服务器（仅本地测试用）：SSE 流式对话 + /models
const http = require('http')

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-reason' }] }))
    return
  }

  if (req.url === '/v1/chat/completions') {
    // 立即开始推流（不解析请求体；挂起 body 防止连接提前复用）
    req.resume()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const chunks = ['你好！', '这是来自 ', 'Mock 服务商的', '流式回复。', '\n\n共 6 个片段，', '用于验证五态状态机。']
    let i = 0
    const timer = setInterval(() => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`)
        i++
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 21, completion_tokens: 33 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        clearInterval(timer)
      }
    }, 150)
    // 注意：不要监听 req 'close'（请求流消费完即触发，会误杀推流定时器）
    res.on('close', () => clearInterval(timer))
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(5177, () => console.log('mock ai server on :5177'))
