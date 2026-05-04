/**
 * PostgreSQL Checkpointer 单例
 *
 * 作用：让 LangGraph 把每个 thread（roomId）的状态持久化到数据库
 * 这使得 interrupt/resume 在无状态 Serverless 函数中成为可能
 *
 * 调用 getCheckpointer() 时如果 setup 还没运行过，会自动创建 checkpoint 表
 */

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let _checkpointer: PostgresSaver | null = null;
let _isSetup = false;

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointer) {
    const connString = process.env.DATABASE_URL;
    if (!connString) {
      throw new Error("DATABASE_URL 未配置，无法初始化 PostgreSQL Checkpointer");
    }
    _checkpointer = PostgresSaver.fromConnString(connString);
  }

  if (!_isSetup) {
    // 幂等操作：第一次调用时创建 LangGraph 所需的 checkpoint 表
    // 表名：checkpoints, checkpoint_blobs, checkpoint_migrations
    await _checkpointer.setup();
    _isSetup = true;
  }

  return _checkpointer;
}
