import { nanoid } from "@/lib/utils";

const KEY = "music_uid";

/**
 * 获取当前设备的 userId（localStorage 持久化，首次访问时自动生成）
 * 仅在客户端调用
 */
export function getUserId(): string {
  if (typeof window === "undefined") return "";
  let uid = localStorage.getItem(KEY);
  if (!uid) {
    uid = `u_${nanoid(12)}`;
    localStorage.setItem(KEY, uid);
  }
  return uid;
}

/**
 * 生成双人 pairId：对两个 userId 排序后拼接，确保 A+B == B+A
 */
export function makePairId(userIdA: string, userIdB: string): string {
  const sorted = [userIdA, userIdB].filter(Boolean).sort();
  if (sorted.length < 2) return "";
  // 简单 hash：排序拼接（不上 crypto，减少复杂度）
  return `pair_${sorted[0]}_${sorted[1]}`;
}
