"""
AsyncPostgresSaver 单例（连接池方式）
FastAPI 生命周期内保持连接池存活，不用每次创建新连接。
"""

import os
from psycopg_pool import AsyncConnectionPool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

_pool: AsyncConnectionPool | None = None
_checkpointer: AsyncPostgresSaver | None = None


async def get_checkpointer() -> AsyncPostgresSaver:
    global _pool, _checkpointer

    if _checkpointer is None:
        db_url = os.getenv("DATABASE_URL", "")
        if not db_url:
            raise RuntimeError("DATABASE_URL 环境变量未设置")

        _pool = AsyncConnectionPool(
            conninfo=db_url,
            max_size=5,
            open=False,          # 手动 open，避免构造时阻塞
        )
        await _pool.open()

        _checkpointer = AsyncPostgresSaver(_pool)
        await _checkpointer.setup()   # 幂等建表

    return _checkpointer


async def close_checkpointer():
    """FastAPI shutdown 时关闭连接池"""
    global _pool, _checkpointer
    if _pool:
        await _pool.close()
    _pool = None
    _checkpointer = None
