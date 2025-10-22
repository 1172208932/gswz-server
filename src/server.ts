import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import Redis from 'ioredis';
import mongoose, { Schema, Document } from 'mongoose';
import assert from 'assert';

/** ========== 1) 初始化各服务：Redis & Mongo ========== */
async function initService() {
  const {
    REDIS_ADDRESS,
    REDIS_USERNAME,
    REDIS_PASSWORD,
    MONGO_ADDRESS,
    MONGO_USERNAME,
    MONGO_PASSWORD,
  } = process.env;

  const [REDIS_HOST, REDIS_PORT] = (REDIS_ADDRESS || '').split(':');
  const redis = new Redis({
    port: parseInt(REDIS_PORT || '6379', 10),
    host: REDIS_HOST || '127.0.0.1',
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    db: 0,
  });

  assert((await redis.echo('echo')) === 'echo', `redis echo error`);

  const mongoUrl = `mongodb://${MONGO_USERNAME}:${encodeURIComponent(
    MONGO_PASSWORD || ''
  )}@${MONGO_ADDRESS}`;
  await mongoose.connect(mongoUrl);

  return { redis, mongoose };
}

/** ========== 2) 定义 Mongo 模型：User（openId + diamonds） ========== */
interface IUser extends Document {
  openId: string;
  nickname?: string;
  avatarUrl?: string;
  diamonds: number;
  updatedAt: number;
}

const UserSchema = new Schema<IUser>({
  openId: { type: String, required: true, unique: true, index: true },
  nickname: String,
  avatarUrl: String,
  diamonds: { type: Number, default: 0 },
  updatedAt: { type: Number, default: () => Date.now() },
});

const User = mongoose.model<IUser>('User', UserSchema);

/** ========== 3) 工具函数：确保用户存在（无则初始化） ========== */
async function ensureUser(openId: string, profile?: Partial<IUser>) {
  assert(openId?.trim(), 'openId is required');
  const now = Date.now();
  const doc = await User.findOneAndUpdate(
    { openId },
    {
      $setOnInsert: {
        openId,
        diamonds: 0,
        updatedAt: now,
        ...(profile || {}),
      },
    },
    { new: true, upsert: true }
  );
  return doc!;
}

/** ========== 4) 启动应用并注册路由 ========== */
initService()
  .then(({ redis }) => {
    const app = new Koa();
    const router = new Router();

    /** 健康检查 */
    router.get('/', (ctx) => {
      ctx.body = `Nodejs koa demo project (wallet ready)`;
    });

    /**
     * GET /api/wallet?openId=xxx
     * 根据登录用户 openId 获取钻石数量
     */
    router.get('/api/wallet', async (ctx) => {
      const openId = String(ctx.query.openId || '');
      assert(openId?.trim(), 'openId is required');

      const user = await ensureUser(openId);
      ctx.body = {
        success: true,
        openId,
        diamonds: user.diamonds,
      };
    });

    /**
     * POST /api/wallet/add?openId=xxx
     * body: { amount: number, nickname?, avatarUrl? }
     * 原子自增 diamonds 并返回最新值
     * （示例包含一个简单的每日限流：同一 openId 每天最多加 10000）
     */
    router.post('/api/wallet/add', async (ctx) => {
      const openId = String(ctx.query.openId || '');
      assert(openId?.trim(), 'openId is required');

      const body: any = ctx.request.body || {};
      const n = Number(body.amount);
      assert(Number.isFinite(n) && n > 0, 'amount must be a positive number');

      // 可选：更新昵称头像（第一次写入或之后补全）
      const { nickname, avatarUrl } = body || {};
      if (nickname || avatarUrl) {
        await ensureUser(openId, { nickname, avatarUrl });
      }

      // —— 简单防刷：每日额度控制（可按需调整/删除）——
      const DAILY_LIMIT = Number(process.env.WALLET_DAILY_LIMIT || 10000);
      const dayKey = `wallet:add:${openId}:${new Date()
        .toISOString()
        .slice(0, 10)}`; // 2025-10-22
      const cur = await redis.get(dayKey);
      const used = cur ? Number(cur) : 0;
      assert(used + n <= DAILY_LIMIT, 'exceed daily add limit');

      // 写入今日累计
      const ttlSec =
        24 * 60 * 60 -
        Math.floor((Date.now() % (24 * 60 * 60 * 1000)) / 1000); // 当天剩余秒数
      await redis.set(dayKey, String(used + n), 'EX', ttlSec);

      // —— Mongo 原子自增 diamonds 并返回最新文档 —— //
      const updated = await User.findOneAndUpdate(
        { openId },
        {
          $inc: { diamonds: n },
          $set: { updatedAt: Date.now() },
          $setOnInsert: { openId, diamonds: 0 },
        },
        { new: true, upsert: true }
      );

      ctx.body = {
        success: true,
        openId,
        add: n,
        diamonds: updated?.diamonds ?? 0,
      };
    });

    app.use(bodyParser());
    app.use(router.routes()).use(router.allowedMethods());

    const PORT = Number(process.env.PORT || 8000);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error: any) => console.log('Init service error: ', error));
