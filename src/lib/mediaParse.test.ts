import { describe, expect, it } from 'vitest'
import {
  biliMediaFromData,
  detectPlatform,
  douyinMediaFromItem,
  extractBiliRef,
  extractDouyinId,
  extractUrl,
} from './mediaParse'

describe('extractUrl', () => {
  it('从分享文案里取链接，尾巴上的中文标点不算链接', () => {
    expect(extractUrl('7.12 复制打开抖音 https://v.douyin.com/iRxyzAb/ 看看【TA的作品】。')).toBe(
      'https://v.douyin.com/iRxyzAb/',
    )
    expect(extractUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=2，速看')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD?p=2',
    )
  })
  it('没有链接返回 null', () => {
    expect(extractUrl('就是一段普通文字')).toBeNull()
    expect(extractUrl('')).toBeNull()
  })
})

describe('detectPlatform', () => {
  it('认抖音系域名', () => {
    expect(detectPlatform('https://v.douyin.com/iRxyzAb/')).toBe('douyin')
    expect(detectPlatform('https://www.iesdouyin.com/share/video/7054761673470594318/')).toBe('douyin')
    expect(detectPlatform('https://www.douyin.com/video/7054761673470594318')).toBe('douyin')
  })
  it('认 B站系域名', () => {
    expect(detectPlatform('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili')
    expect(detectPlatform('https://b23.tv/abcdef')).toBe('bilibili')
  })
  it('别的平台不认', () => {
    expect(detectPlatform('https://v.kuaishou.com/xxxx')).toBeNull()
    expect(detectPlatform('https://example.com/a')).toBeNull()
  })
})

describe('extractDouyinId', () => {
  it('各种形态都能取到作品 ID', () => {
    expect(extractDouyinId('https://www.iesdouyin.com/share/video/7054761673470594318/?region=CN')).toBe('7054761673470594318')
    expect(extractDouyinId('https://www.douyin.com/video/7688751380592381222')).toBe('7688751380592381222')
    expect(extractDouyinId('https://www.douyin.com/jingxuan?modal_id=7690939726009847103')).toBe('7690939726009847103')
    expect(extractDouyinId('https://www.douyin.com/note/7300000000000000001')).toBe('7300000000000000001')
    expect(extractDouyinId('7054761673470594318')).toBe('7054761673470594318')
  })
  it('短链本身取不到（需要先重定向）', () => {
    expect(extractDouyinId('https://v.douyin.com/iRxyzAb/')).toBeNull()
  })
})

describe('extractBiliRef', () => {
  it('取 BV 号与分 P', () => {
    expect(extractBiliRef('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({ bvid: 'BV1xx411c7mD', page: 1 })
    expect(extractBiliRef('https://www.bilibili.com/video/BV1xx411c7mD?p=3&spm=x')).toEqual({ bvid: 'BV1xx411c7mD', page: 3 })
    expect(extractBiliRef('BV1xx411c7mD')).toEqual({ bvid: 'BV1xx411c7mD', page: 1 })
  })
  it('非 BV 返回 null', () => {
    expect(extractBiliRef('https://www.bilibili.com/')).toBeNull()
  })
})

describe('douyinMediaFromItem（feed 命中的 item → 素材）', () => {
  it('视频：bit_rate 里挑档位最高的 play 地址', () => {
    const media = douyinMediaFromItem(
      {
        aweme_id: '7054761673470594318',
        desc: '测试视频',
        author: { nickname: '作者甲' },
        video: {
          play_addr: { url_list: ['https://api-play.amemv.com/aweme/v1/play/?video_id=v0200xxx'] },
          bit_rate: [
            { gear_name: 'adapt_lowest_540_1', play_addr: { width: 960, url_list: ['https://cdn/540.mp4'] } },
            { gear_name: 'adapt_lowest_720_1', play_addr: { width: 1280, url_list: ['https://cdn/720.mp4'] } },
          ],
        },
      },
      '7054761673470594318',
    )
    expect(media.title).toBe('测试视频')
    expect(media.author).toBe('作者甲')
    expect(media.assets).toHaveLength(1)
    expect(media.assets[0]).toMatchObject({ kind: 'video', url: 'https://cdn/720.mp4', label: '720P' })
  })

  it('图集：逐张出图，不碰带水印的两张', () => {
    const media = douyinMediaFromItem(
      {
        aweme_id: '1',
        desc: '测试图集',
        image_post_info: {
          images: [
            {
              origin: { url_list: ['https://img/origin1.jpg'] },
              owner_watermark_image: { url_list: ['https://img/wm1.jpg'] },
              display_images: [{ url_list: ['https://img/d1.jpg'] }],
            },
            {
              display_images: [{ url_list: ['https://img/d2.jpg'] }],
            },
          ],
        },
      },
      '1',
    )
    expect(media.assets.map((a) => a.url)).toEqual(['https://img/origin1.jpg', 'https://img/d2.jpg'])
    expect(media.assets.every((a) => a.kind === 'image')).toBe(true)
  })

  it('没有媒体时给出空素材列表（由上层报错）', () => {
    const media = douyinMediaFromItem({ aweme_id: '2', desc: '空' }, '2')
    expect(media.assets).toHaveLength(0)
  })
})

describe('biliMediaFromData（view + playurl → 素材）', () => {
  const view = {
    title: '测试视频标题',
    pic: 'https://i0.hdslb.com/cover.jpg',
    owner: { name: 'UP主' },
    videos: 2,
    pages: [{ cid: 111 }, { cid: 222 }],
  }

  it('durl 单文件出一个视频素材', () => {
    const media = biliMediaFromData(view, { durl: [{ url: 'https://cdn/bili.mp4' }] }, { bvid: 'BV1xx411c7mD', page: 1 })
    expect(media).toMatchObject({ platform: 'bilibili', title: '测试视频标题', author: 'UP主' })
    expect(media.assets).toEqual([
      expect.objectContaining({ kind: 'video', url: 'https://cdn/bili.mp4' }),
    ])
    expect(media.note).toContain('2 P')
  })

  it('多分段 durl 逐段出素材', () => {
    const media = biliMediaFromData(
      view,
      { durl: [{ url: 'https://cdn/p1.mp4' }, { url: 'https://cdn/p2.mp4' }] },
      { bvid: 'BV1xx411c7mD', page: 2 },
    )
    expect(media.assets).toHaveLength(2)
    expect(media.assets[1].label).toContain('2/2')
    expect(media.note).toContain('第 2 P')
  })

  it('返回 DASH 分离流时明确报错，不静默给半成品', () => {
    expect(() =>
      biliMediaFromData(view, { dash: { video: [{ id: 32 }] } }, { bvid: 'BV1xx411c7mD', page: 1 }),
    ).toThrow('音视频分离流')
  })
})
