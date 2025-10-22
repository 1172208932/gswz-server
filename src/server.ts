import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import axios from 'axios';

const app = new Koa();
const router = new Router();

// —— 简单内存存储（进程重启会清空）——
const wallet = new Map<string, number>(); // openId -> diamonds

router
  .get('/', (ctx) => {
    ctx.body = `Nodejs koa demo project`;
  })

  // 获取 open_id（来自请求头）
  .get('/api/get_open_id', async (ctx) => {
    const openId = ctx.request.header['x-tt-openid'] as string;
    if (openId) {
      ctx.body = { success: true, data: openId };
    } else {
      ctx.body = { success: false, message: 'dyc-open-id not exist' };
    }
  })

  // 文本鉴黄（保留你原有示例）
  .post('/api/text/antidirt', async (ctx) => {
    const body: any = ctx.request.body || {};
    const content = body.content || '';
    const res = await axios.post('http://developer.toutiao.com/api/v2/tags/text/antidirt', {
      tasks: [{ content }],
    });
    ctx.body = { result: res.data, success: true };
  })

  // ===== 获取钻石余额 =====
  .get('/api/wallet', (ctx) => {
    const openId = ctx.request.header['x-tt-openid'] as string;
    if (!openId) {
      ctx.body = { success: false, message: 'dyc-open-id not exist' };
      return;
    }
    const diamonds = wallet.get(openId) ?? 0;
    ctx.body = { success: true, openId, diamonds };
  })

  // ===== 增加钻石 =====
  .post('/api/wallet/add', (ctx) => {
    const openId = ctx.request.header['x-tt-openid'] as string;
    if (!openId) {
      ctx.body = { success: false, message: 'dyc-open-id not exist' };
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

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
