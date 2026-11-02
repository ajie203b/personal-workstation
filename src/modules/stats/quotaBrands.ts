/** 本地品牌目录：名称用于预设，别名也用于识别已有自定义厂商。 */
type ProviderPreset = { name: string; logo: string; match: RegExp }
type ProviderGroup = { label: string; providers: ProviderPreset[] }

export const PROVIDER_GROUPS: ProviderGroup[] = [
  { label: '模型厂商', providers: [
    { name: 'Google Gemini', logo: 'lobe-gemini-color', match: /gemini|双子座/i },
    { name: '通义千问', logo: 'lobe-qwen-color', match: /qwen|通义千问|千问/i },
    { name: 'OpenAI', logo: 'lobe-openai', match: /openai|chatgpt/i },
    { name: 'Anthropic', logo: 'lobe-anthropic', match: /anthropic|claude/i },
    { name: 'Google', logo: 'lobe-google-color', match: /google|谷歌/i },
    { name: 'DeepSeek', logo: 'lobe-deepseek-color', match: /deepseek|深度求索/i },
    { name: '月之暗面', logo: 'lobe-moonshot', match: /moonshot|月之暗面|kimi/i },
    { name: '智谱 AI', logo: 'lobe-zhipu-color', match: /zhipu|智谱|\bglm(?=\d|\b)/i },
    { name: 'MiniMax', logo: 'lobe-minimax-color', match: /minimax|海螺/i },
    { name: '小米 MiMo', logo: 'lobe-xiaomimimo', match: /mimo|米模|小米/i },
    { name: '讯飞星火', logo: 'lobe-spark-color', match: /\bspark(?=\d|\b)|星火|讯飞|iflytek/i },
    { name: '美团 LongCat', logo: 'lobe-longcat-color', match: /longcat|龙猫|美团/i },
    { name: '豆包', logo: 'lobe-doubao-color', match: /doubao|豆包/i },
    { name: '腾讯混元', logo: 'lobe-hunyuan-color', match: /hunyuan|混元/i },
    { name: '阶跃星辰', logo: 'lobe-stepfun-color', match: /stepfun|阶跃星辰/i },
    { name: '百川智能', logo: 'lobe-baichuan-color', match: /baichuan|百川智能/i },
    { name: '蚂蚁百灵', logo: 'lobe-ling-color', match: /bailing|蚂蚁百灵/i },
    { name: '零一万物', logo: 'lobe-yi-color', match: /零一万物|\b01\.ai\b/i },
    { name: 'xAI', logo: 'lobe-grok', match: /\bxai\b|\bx\.ai\b|grok/i },
    { name: 'Mistral', logo: 'lobe-mistral-color', match: /mistral/i },
    { name: 'Perplexity', logo: 'lobe-perplexity-color', match: /perplexity/i },
    { name: 'Cohere', logo: 'lobe-cohere-color', match: /cohere/i },
  ] },
  { label: '模型平台与第三方服务', providers: [
    { name: '阿里云百炼', logo: 'lobe-alibabacloud-color', match: /alibabacloud|阿里云|百炼/i },
    { name: '火山引擎', logo: 'lobe-volcengine-color', match: /volcengine|火山引擎|byteplus/i },
    { name: '百度千帆', logo: 'lobe-baiducloud-color', match: /baidu|百度|千帆|文心/i },
    { name: '腾讯云', logo: 'lobe-tencentcloud-color', match: /tencent|腾讯云/i },
    { name: 'PackyCode', logo: 'cc-packycode', match: /packy(?:code|api)/i },
    { name: 'OpenRouter', logo: 'lobe-openrouter-color', match: /openrouter/i },
    { name: 'AiHubMix', logo: 'lobe-aihubmix-color', match: /aihubmix/i },
    { name: '硅基流动', logo: 'lobe-siliconcloud-color', match: /siliconflow|siliconcloud|硅基流动/i },
    { name: '魔搭 ModelScope', logo: 'lobe-modelscope-color', match: /modelscope|魔搭/i },
    { name: 'PPIO', logo: 'lobe-ppio-color', match: /\bppio\b|派欧云/i },
    { name: '英伟达 NVIDIA', logo: 'lobe-nvidia-color', match: /nvidia|英伟达/i },
    { name: 'Novita AI', logo: 'lobe-novita-color', match: /novita/i },
    { name: 'AICodeMirror', logo: 'cc-aicodemirror', match: /aicodemirror/i },
    { name: 'AICoding', logo: 'cc-aicoding', match: /aicoding/i },
    { name: 'CrazyRouter', logo: 'cc-crazyrouter', match: /crazyrouter/i },
    { name: 'Cubence', logo: 'cc-cubence', match: /cubence/i },
    { name: 'Micu', logo: 'cc-micu', match: /\bmicu(?:api)?\b/i },
    { name: 'SSSAiCode', logo: 'cc-sssaicode', match: /sssaicode/i },
    { name: 'SubRouter', logo: 'cc-subrouter', match: /subrouter/i },
    { name: 'GitHub Copilot', logo: 'lobe-githubcopilot', match: /github\s*copilot/i },
    { name: 'AWS Bedrock', logo: 'lobe-bedrock-color', match: /bedrock|\baws\b/i },
    { name: 'Microsoft Azure', logo: 'lobe-azure-color', match: /azure|微软云/i },
    { name: 'Google Cloud', logo: 'lobe-googlecloud-color', match: /google\s*cloud|谷歌云/i },
    { name: 'Groq', logo: 'lobe-groq', match: /\bgroq\b/i },
    { name: 'Hugging Face', logo: 'lobe-huggingface-color', match: /hugging\s*face/i },
    { name: 'Ollama', logo: 'lobe-ollama', match: /ollama/i },
    { name: 'New API', logo: 'lobe-newapi-color', match: /\bnew[ -]?api\b/i },
    { name: 'Cloudflare', logo: 'lobe-cloudflare-color', match: /cloudflare/i },
    { name: 'Fireworks AI', logo: 'lobe-fireworks-color', match: /fireworks/i },
    { name: 'Together AI', logo: 'lobe-together-color', match: /together\s*ai/i },
    { name: 'DeepInfra', logo: 'lobe-deepinfra-color', match: /deepinfra/i },
    { name: 'Gitee AI', logo: 'lobe-giteeai', match: /gitee/i },
  ] },
]

export const PROVIDERS = [...PROVIDER_GROUPS.flatMap(group => group.providers.map(provider => provider.name)), '其他']

/** 明确的平台优先显示平台标识；厂商记录优先识别名称中更具体的模型品牌。 */
export function quotaBrand(name: string, provider: string): string | null {
  const [models, platforms] = PROVIDER_GROUPS.map(group => group.providers)
  const find = (presets: ProviderPreset[], value: string) => presets.find(preset => preset.match.test(value))
  const platform = find(platforms, provider)
  // 云厂商下的具体模型仍可显示模型标识；聚合或第三方平台则显示平台自己的标识。
  const cloudNames = ['阿里云百炼', '火山引擎', '百度千帆', '腾讯云']
  if (platform && !cloudNames.includes(platform.name)) return platform.logo
  return find(models, name)?.logo ?? platform?.logo ?? find(models, provider)?.logo ?? find(platforms, name)?.logo ?? null
}
