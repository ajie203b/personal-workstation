/**
 * 番茄网页正文用私有区码位（U+E3E8–U+E55B）做字体混淆：
 * 页面给的是乱码，浏览器加载自定义 woff 后才显示成汉字。
 *
 * 下表按当前字体文件（awesome-font/c/dc027189e0ba4cd）的码位顺序排列，
 * 与 372 个私有区码位一一对应；官网换字体后这里需要同步更新。
 * '?' 表示该码位在字体里没有可还原的字形，解码时保留原字符。
 */
const START = 0xe3e8
const END = 0xe55b
const CHARS =
  'D在主特家军然表场4要只v和?6别还g现儿岁??此象月3出战工相o男直失世F都平文什VO将真T那当?会立些u是十张学气大爱两命全后东性通被1它乐接而感车山公了常以何可话先pi叫轻M士w着变尔快l个说少色里安花远7难师放t报认面道S?克地度I好机U民写把万同水新没书电吃像斯5为y白几日教看但第加候作上拉住有法r事应位利你声身国问马女他Y比父xAHNsX边美对所金活回意到z从j知又内因点Q三定8Rb正或夫向德听更?得告并本q过记L让打f人就者去原满体做经K走如孩cG给使物?最笑部?员等受k行一条果动光门头见往自解成处天能于名其发总母的死手入路进心来h时力多开已许d至由很界n小与Z想代么分生口再妈望次西风种带J?实情才这?E我神格长觉间年眼无不亲关结0友信下却重己老2音字m呢明之前高PB目太e9起稜她也W用方子英每理便四数期中C外样a海们任'

/** 当前已知字体文件的指纹（取自页面 @font-face 的 awesome-font/c/<指纹>） */
export const FANQIE_FONT_KEY = 'dc027189e0ba4cd'

export function isKnownFanqieFont(fontKey: string | undefined): boolean {
  return !fontKey || fontKey === FANQIE_FONT_KEY
}

/** 把正文里的私有区码位替换回汉字；未知码位原样保留，避免把正文弄坏 */
export function decodeFanqieText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= START && code <= END) {
      const mapped = CHARS[code - START]
      out += mapped && mapped !== '?' ? mapped : ch
    } else {
      out += ch
    }
  }
  return out
}

/** 正文里还有没有没还原的私有区码位（用来提示字体表过期） */
export function hasUnknownFanqieGlyphs(text: string): boolean {
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= START && code <= END) {
      const mapped = CHARS[code - START]
      if (!mapped || mapped === '?') return true
    }
  }
  return false
}
