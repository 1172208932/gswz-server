import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import axios from 'axios';

const app = new Koa();
const router = new Router();

// ===== 内存钱包（进程重启会清空） =====
const wallet = new Map<string, number>(); // openId -> diamonds

// ====== 抖音配置（从开发者后台复制 AppID / AppSecret）======
const DOUYIN_APPID = 'ttde2aa897411cfdb002'; // client_key
const DOUYIN_SECRET = 'da8c3ea2ea1779c6c482713c982d42062b514aa1'; // app_secret

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

    // 登录成功
    ctx.body = {
      success: true,
      data: {
        openid,
        unionid,
      },
    };
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

// ====== 获取钻石余额 ======
router.get('/api/wallet', (ctx) => {
  const openId = ctx.request.header['x-tt-openid'] as string;
  if (!openId) {
    ctx.body = { success: false, message: 'x-tt-openid not exist' };
    return;
  }

  const diamonds = wallet.get(openId) ?? 0;
  ctx.body = { success: true, openId, diamonds };
});

// ====== 增加钻石 ======
router.post('/api/wallet/add', (ctx) => {
  const openId = ctx.request.header['x-tt-openid'] as string;
  if (!openId) {
    ctx.body = { success: false, message: 'x-tt-openid not exist' };
    return;
  }

  const body: any = ctx.request.body || {};
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    ctx.body = { success: false, message: 'amount must be a positive number' };
    return;
  }

  const cur = wallet.get(openId) ?? 0;
  const next = cur + amount;
  wallet.set(openId, next);

  ctx.body = { success: true, openId, add: amount, diamonds: next };
});

app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

// ====== 启动服务 ======
const PORT = 8000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
