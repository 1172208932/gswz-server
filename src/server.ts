import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import Redis from 'ioredis';
import mongoose, { Schema, Document } from 'mongoose';
import assert from 'assert';

/** ========== 1) 初始化各服务：仅使用 REDIS_ADDRESS / MONGO_ADDRESS ========== */
async function initService() {
  const { REDIS_ADDRESS, MONGO_ADDRESS } = process.env as Record<string, string | undefined>;

  // --- Redis（仅 host:port）---
  assert(REDIS_ADDRESS && REDIS_ADDRESS.includes(':'), 'REDIS_ADDRESS 必须形如 host:port');
  const [REDIS_HOST, REDIS_PORT_STR] = REDIS_ADDRESS.split(':');
  const REDIS_PORT = parseInt(REDIS_PORT_STR!, 10);
  assert(Number.isFinite(REDIS_PORT), 'REDIS_ADDRESS 的端口必须是数字');

  const redis = new Redis({
    host: REDIS_HOST!,
    port: REDIS_PORT,
    db: 0,
    // 防止启动期卡死
    connectTimeout: 5000,
  });

  assert((await redis.echo('echo')) === 'echo', 'redis echo error');

  // --- Mongo（仅 mongodb://host:port/dbname）---
  assert(MONGO_ADDRESS && MONGO_ADDRESS.length > 0, 'MONGO_ADDRESS 不能为空');
  const mongoUrl = `mongodb://${MONGO_ADDRESS}`;
  await mongoose.connect(mongoUrl, {
    serverSelectionTimeoutMS: 5000, // 5s 选主超时
  } as any);

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

/** ========== 4) 启动应用并注册路由（端口写死 8000；健康检查文案一致） ========== */
initService()
  .then(({ redis }) => {
    const app = new Koa();
    const router = new Router();

    // 健康检查：与 demo 一致
    router.get('/', (ctx) => {
      ctx.body = `Nodejs koa demo project`;
    });

    // 根据 openId 获取钻石
    router.get('/api/wallet', async (ctx) => {
      const openId = String(ctx.query.openId || '');
      assert(openId?.trim(), 'openId is required');
      const user = await ensureUser(openId);
      ctx.body = { success: true, openId, diamonds: user.diamonds };
    });

    // 增加钻石
    router.post('/api/wallet/add', async (ctx) => {
      const openId = String(ctx.query.openId || '');
      assert(openId?.trim(), 'openId is required');

      const body: any = ctx.request.body || {};
      const n = Number(body.amount);
      assert(Number.isFinite(n) && n > 0, 'amount must be a positive number');

      const { nickname, avatarUrl } = body || {};
      if (nickname || avatarUrl) {
        await ensureUser(openId, { nickname, avatarUrl });
      }

      const DAILY_LIMIT = 10000; // 固定阈值，不依赖环境变量
      const dayKey = `wallet:add:${openId}:${new Date().toISOString().slice(0, 10)}`;
      const cur = await redis.get(dayKey);
      const used = cur ? Number(cur) : 0;
      assert(used + n <= DAILY_LIMIT, 'exceed daily add limit');

      const ttlSec = 24 * 60 * 60 - Math.floor((Date.now() % (24 * 60 * 60 * 1000)) / 1000);
      await redis.set(dayKey, String(used + n), 'EX', ttlSec);

      const updated = await User.findOneAndUpdate(
        { openId },
        { $inc: { diamonds: n }, $set: { updatedAt: Date.now() }, $setOnInsert: { openId, diamonds: 0 } },
        { new: true, upsert: true }
      );

      ctx.body = { success: true, openId, add: n, diamonds: updated?.diamonds ?? 0 };
    });

    app.use(bodyParser());
    app.use(router.routes()).use(router.allowedMethods());

    // 端口固定 8000
    const PORT = 8000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error: any) => console.log('Init service error: ', error));
