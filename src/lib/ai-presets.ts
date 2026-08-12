export interface AiProviderPreset {
  id: string
  name: string
  profileLabel: string
  description: string
  baseUrl: string
  baseUrlPlaceholder?: string
  models: string[]
  modelPlaceholder?: string
}

export const aiProviderPresets: AiProviderPreset[] = [
  {
    id: 'custom',
    name: '自定义兼容接口',
    profileLabel: '自定义 API',
    description: '适用于任何提供 OpenAI Chat Completions 兼容协议的服务。',
    baseUrl: '',
    baseUrlPlaceholder: 'https://你的服务地址/v1',
    models: [],
    modelPlaceholder: '填写服务支持的模型 ID',
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    profileLabel: 'OpenAI',
    description: 'OpenAI 官方 API，使用平台 API Key。',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.2', 'gpt-4.1-mini'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    profileLabel: 'DeepSeek',
    description: 'DeepSeek 官方 OpenAI 兼容接口，可选择快速或高能力模型。',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'sub2api',
    name: 'Sub2API / CPA',
    profileLabel: 'Sub2API / CPA',
    description: '适用于自部署 Sub2API、CPA 或订阅中转。域名和模型 ID 以你的服务面板为准。',
    baseUrl: '',
    baseUrlPlaceholder: 'https://你的-sub2api-地址/v1',
    models: [],
    modelPlaceholder: '填写分组支持的模型 ID',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    profileLabel: 'OpenRouter',
    description: '通过统一接口使用多个模型提供商，模型名称使用 OpenRouter slug。',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['~openai/gpt-latest', '~anthropic/claude-sonnet-latest'],
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    profileLabel: '阿里云百炼',
    description: '阿里云百炼华北 2 区的 OpenAI 兼容接口；其他地域可手动修改地址。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max'],
  },
  {
    id: 'groq',
    name: 'Groq',
    profileLabel: 'Groq',
    description: 'Groq 的 OpenAI 兼容接口。模型上下线较快，请以控制台中的模型 ID 为准。',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [],
    modelPlaceholder: '从 Groq 控制台复制模型 ID',
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    profileLabel: 'Ollama 本地',
    description: '连接本机 Ollama OpenAI 兼容接口；模型必须先在 Ollama 中下载。',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3:8b', 'llama3.2'],
  },
  {
    id: 'lm-studio',
    name: 'LM Studio 本地',
    profileLabel: 'LM Studio 本地',
    description: '连接 LM Studio 本地服务器，模型 ID 取决于当前加载的模型。',
    baseUrl: 'http://localhost:1234/v1',
    models: [],
    modelPlaceholder: '填写 LM Studio 显示的模型 ID',
  },
]

export function findAiProviderPreset(id: string) {
  return aiProviderPresets.find((preset) => preset.id === id) ?? aiProviderPresets[0]
}
