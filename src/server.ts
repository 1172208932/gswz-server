import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(tz);

const app = new Koa();
const router = new Router();

// ===== 内存钱包（进程重启会清空） =====
const wallet = new Map<string, number>(); // openId -> diamonds
const lastDailyClaim = new Map<string, string>(); // openId -> ISO string (last claim time)

// ====== 抖音配置（改用环境变量）======
const DOUYIN_APPID = process.env.DOUYIN_APPID || 'ttde2aa897411cfdb002';
const DOUYIN_SECRET = process.env.DOUYIN_SECRET || 'da8c3ea2ea1779c6c482713c982d42062b514aa1';

// ===== 工具函数 =====
const TZ = 'Asia/Shanghai';
function isClaimedToday(lastISO?: string) {
  if (!lastISO) return false;
  const last = dayjs(lastISO).tz(TZ);
  const now = dayjs().tz(TZ);
  return last.format('YYYY-MM-DD') === now.format('YYYY-MM-DD');
}
function nextMidnightISO() {
  return dayjs().tz(TZ).add(1, 'day').startOf('day').toISOString();
}

// ===== 首页 =====
router.get('/', (ctx) => {
  ctx.body = `Node.js Koa demo project (Douyin mini-game)`;
});

// ====== 登录：用 code 换 openid / unionid ======
router.post('/api/auth/code2session', async (ctx) => {
  const { code } = ctx.request.body as { code: string };
  if (!code) {
    ctx.body = { success: false, message: 'missing code' };
    return;
  }

  try {
    // 抖音官方登录接口
    const resp = await axios.get('https://developer.toutiao.com/api/apps/jscode2session', {
      params: {
        appid: DOUYIN_APPID,
        secret: DOUYIN_SECRET,
        code,
        grant_type: 'authorization_code',
      },
    });

    const { openid, unionid, errcode, errmsg } = resp.data || {};
    if (errcode) {
      ctx.body = { success: false, message: errmsg || 'code2session failed' };
      return;
    }

    ctx.body = { success: true, data: { openid, unionid } };
  } catch (err: any) {
    ctx.body = { success: false, message: 'request to douyin failed', detail: err.message };
  }
});

// ====== 获取 open_id（来自请求头）======
router.get('/api/get_open_id', async (ctx) => {
  const openId = ctx.request.header['x-tt-openid'] as string;
  if (openId) {
    ctx.body = { success: true, data: openId };
  } else {
    ctx.body = { success: false, message: 'x-tt-openid not exist' };
  }
});

// ====== 获取钻石余额（扩展返回是否今日已领 & 下一次可领时间） ======
router.get('/api/wallet', (ctx) => {
  const openId = ctx.request.header['x-tt-openid'] as string;
  if (!openId) {
    ctx.body = { success: false, message: 'x-tt-openid not exist' };
    return;
  }

  const diamonds = wallet.get(openId) ?? 0;
  const last = lastDailyClaim.get(openId);
  const claimedToday = isClaimedToday(last);
  ctx.body = {
    success: true,
    data: {
      diamonds,
      claimedToday,
      nextClaimAt: nextMidnightISO(),
      lastClaimAt: last || null,
    },
  };
});

// ====== 增加钻石（支持每日签到限频：reason = 'daily_reward'） ======
router.post('/api/wallet/add', (ctx) => {
  const openId = ctx.request.header['x-tt-openid'] as string;
  if (!openId) {
    ctx.body = { success: false, message: 'x-tt-openid not exist' };
    return;
  }

  const body: any = ctx.request.body || {};
  // 前端可传 { amount, reason, source }
  const clientAmount = Number(body.amount);
  const reason = String(body.reason || '').trim(); // 'daily_reward' | 'gm' | 'task' ...
  // 可选：source 仅用于埋点分析
  const source = String(body.source || '').trim();

  // —— 服务器裁决金额，避免被前端篡改 ——
  let amount = clientAmount;
  if (!Number.isFinite(amount) || amount <= 0) {
    amount = 0;
  }

  // 每日签到（限每日一次），金额由服务端配置
  if (reason === 'daily_reward') {
    const dailyReward = 50; // 服务器配置
    const last = lastDailyClaim.get(openId);

    if (isClaimedToday(last)) {
      const diamonds = wallet.get(openId) ?? 0;
      ctx.body = {
        success: false,
        code: 'ALREADY_CLAIMED',
        message: '今日已领取',
        data: {
          diamonds,
          claimedToday: true,
          nextClaimAt: nextMidnightISO(),
          lastClaimAt: last || null,
        },
      };
      return;
    }

    amount = dailyReward; // 以服务器为准
    // 发放
    const cur = wallet.get(openId) ?? 0;
    const next = cur + amount;
    wallet.set(openId, next);
    // 记录今日领取时间
    const nowISO = dayjs().tz(TZ).toISOString();
    lastDailyClaim.set(openId, nowISO);

    ctx.body = {
      success: true,
      data: {
        coinsDelta: amount,
        diamonds: next,
        claimedToday: true,
        nextClaimAt: nextMidnightISO(),
        lastClaimAt: nowISO,
        reason,
        source,
      },
    };
    return;
  }

  // 其他原因：不做限频（例如任务/内购/活动）
  if (!Number.isFinite(amount) || amount <= 0) {
    ctx.body = { success: false, message: 'amount must be a positive number' };
    return;
  }
  const cur = wallet.get(openId) ?? 0;
  const next = cur + amount;
  wallet.set(openId, next);

  ctx.body = {
    success: true,
    data: {
      coinsDelta: amount,
      diamonds: next,
      claimedToday: isClaimedToday(lastDailyClaim.get(openId)),
      nextClaimAt: nextMidnightISO(),
      reason,
      source,
    },
  };
});

app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

// ====== 启动服务 ======
const PORT = Number(process.env.PORT || 8000);
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
