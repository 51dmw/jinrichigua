// LLM call helpers shared by the scripts/* pipelines.
// Business code picks a backend and passes the resulting `call(prompt)` function to llmJSON;
// nothing here knows which pipeline or which model is in use.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 成文只需要文本进文本出：在空目录里跑、禁掉全部工具，避免模型把素材里的指令当成动作执行
// （曾出现过把代码分析当正文输出的情况，当时它带着完整工具权限）。
const CLAUDE_NO_TOOLS = ['--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit'];

export function callClaude(prompt, { model = 'sonnet', cwd = join(tmpdir(), 'hot-sync-gen'), timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    try { mkdirSync(cwd, { recursive: true }); } catch { /* 已存在即可 */ }
    const child = spawn('claude', ['-p', '--model', model, ...CLAUDE_NO_TOOLS], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ANTHROPIC_API_KEY: '' }, // 强制走订阅登录态而非 API key
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude -p 超时(${Math.round(timeoutMs / 1000)}s)`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// OpenAI 兼容接口。UA 统一伪装 openai-python：部分厂商的 WAF 会拦含 "OpenAI/J" 的 UA。
export async function callOpenAICompat({ url, key, model, name, keyEnv }, prompt, { maxTokens = 8192, timeoutMs = 240000 } = {}) {
  if (!key) throw new Error(`.env 缺 ${keyEnv || `${String(name).toUpperCase()}_API_KEY`}`);
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'openai-python/1.0.0' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs), // 厂商服务端响应可能波动，给长超时
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.choices[0].message.content;
}

// 从模型输出里取出第一个 JSON 数组或对象（容忍前后废话和 ``` 围栏）
export function parseJSON(text, label) {
  const cleaned = text.replace(/```(?:json)?/g, '');
  const s = cleaned.indexOf('['), s2 = cleaned.indexOf('{');
  const start = s >= 0 && (s2 < 0 || s < s2) ? s : s2;
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (start < 0 || end <= start) throw new Error(`${label} 输出不含 JSON: ${text.slice(0, 120)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

// 调 LLM 并解析 JSON；调用失败或解析失败都整体重试（最多 3 次）。
// 解析失败先走一次「修复」：把坏输出发回模型修成合法 JSON（引号/换行转义是高频病灶，重写不如修）。
// 命中限流立即中止：重试只会把剩余额度烧光，交给下一轮定时任务。
export async function llmJSON(call, prompt, label) {
  for (let i = 1; i <= 3; i++) {
    try {
      const raw = await call(prompt);
      try { return parseJSON(raw, label); } catch (pe) {
        console.warn(`[warn] ${label} 第${i}次输出非法 JSON（${pe.message.slice(0, 80)}），尝试修复`);
        const fixed = await call(`以下文本是一段不合法的 JSON（字符串内可能有未转义的引号或换行）。修复转义使其成为合法 JSON，内容原样保留，只输出修复后的 JSON，不要任何其他文字：\n\n${raw}`);
        return parseJSON(fixed, `${label}(修复)`);
      }
    } catch (e) {
      if (/rate.?limit|usage limit|too many requests|429|quota/i.test(e.message)) {
        throw new Error(`RATE_LIMIT: ${e.message.slice(0, 120)}（已中止本轮，等下一轮 cron 重试）`);
      }
      console.warn(`[warn] ${label} 第${i}次失败: ${e.message.slice(0, 200)}`);
      if (i === 3) throw e;
    }
  }
}
