// app.ts（或 router 文件）
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import axios from 'axios';

const app = new Koa();
const router = new Router();

// 环境配置（从环境变量读取）
const DOYIN_APP_ID = process.env.DOUYIN_APP_ID!;        // 抖音小游戏 AppID（client_key）
const DOYIN_APP_SECRET = process.env.DOUYIN_APP_SECRET!; // 抖音小游戏 AppSecret

// 简单内存钱包（示例）
const wallet = new Map<string, number>(); // openid -> diamonds

// 1) 登录换 session（openid/unionid）
router.post('/api/auth/code2session', async (ctx) => {
  const { code } = ctx.request.body as { code: string };
  if (!code) {
    ctx.body = { success: false, message: 'missing code' };
    return;
  }

  // 抖音 “code2session” 接口（示例 URL，按官方最新文档为准）
  // 典型为：
  // https://developer.toutiao.com/api/apps/jscode2session
  // 或 https://open.douyin.com/api/apps/v2/jscode2session
  const url = 'https://developer.toutiao.com/api/apps/jscode2session';
  const params = {
    appid: DOYIN_APP_ID,         // 有的文档用 appid，有的用 appid/client_key
    secret: DOYIN_APP_SECRET,    // 有的文档用 secret，有的用 app_secret
    code,
    grant_type: 'authorization_code',
  };

  const resp = await axios.get(url, { params });
  // 返回示例：{ openid, anonymous_openid, session_key, unionid? }
  const { openid, unionid, session_key, error, errcode, errmsg } = resp.data || {};
  if (!openid || errcode) {
    ctx.body = { success: false, message: errmsg || 'code2session failed', data: resp.data };
    return;
  }

  // 这里你可以签发你自己的 token（可选）
  // const token = signJWT({ openid }, '7d');

  ctx.body = {
    success: true,
    data: {
      openid,
      unionid,         // 如果你已在抖音后台开通 unionid 能力并满足条件，就能拿到
      // token,
    },
  };
});

// 2) 你的钱包接口（从 Header 取 openid/unionid）
router.get('/api/wallet', async (ctx) => {
  const openId = (ctx.request.header['x-tt-openid'] || '') as string;
  const unionId = (ctx.request.header['x-tt-unionid'] || '') as string;

  if (!openId) {
    ctx.body = { success: false, message: 'missing x-tt-openid' };
    return;
  }

  const diamonds = wallet.get(openId) ?? 0;
  ctx.body = { success: true, data: { openId, unionId, diamonds } };
});

// 3) 简单加钻（示例）
router.post('/api/wallet/add', async (ctx) => {
  const openId = (ctx.request.header['x-tt-openid'] || '') as string;
  const { amount = 10 } = ctx.request.body as { amount: number };
  const curr = wallet.get(openId) ?? 0;
  wallet.set(openId, curr + amount);
  ctx.body = { success: true, data: { diamonds: wallet.get(openId) } };
});

app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());
app.listen(3000);
