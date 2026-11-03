/**
 * 单测用的内存版 Cache Storage（node 里没有 caches）。只实现 modelCache 用到的那几个方法。
 * 不进生产包：只有 *.test.ts 引用它。
 */
export class FakeCache {
  readonly store = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>()

  async match(req: Request | string): Promise<Response | undefined> {
    const hit = this.store.get(typeof req === 'string' ? req : req.url)
    return hit ? new Response(hit.body.slice(0), { headers: hit.headers }) : undefined
  }

  async put(req: Request | string, res: Response): Promise<void> {
    const body = await res.arrayBuffer()
    this.store.set(typeof req === 'string' ? req : req.url, { body, headers: [...res.headers.entries()] })
  }

  async delete(req: Request | string): Promise<boolean> {
    return this.store.delete(typeof req === 'string' ? req : req.url)
  }

  async keys(): Promise<Request[]> {
    return [...this.store.keys()].map((u) => new Request(u))
  }
}

export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name)
    if (!c) {
      c = new FakeCache()
      this.caches.set(name, c)
    }
    return c
  }

  async has(name: string): Promise<boolean> {
    return this.caches.has(name)
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }
}
