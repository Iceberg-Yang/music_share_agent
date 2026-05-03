import { v4 as uuidv4 } from "uuid";

export function nanoid(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const arr = uuidv4().replace(/-/g, "");
  for (let i = 0; i < length; i++) {
    result += chars[parseInt(arr[i * 2], 16) % chars.length];
  }
  return result;
}

export function saveSession(roomId: string, participantId: string, sessionToken: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`room_${roomId}_session`, JSON.stringify({ participantId, sessionToken }));
}

export function getSession(roomId: string): { participantId: string; sessionToken: string } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(`room_${roomId}_session`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession(roomId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`room_${roomId}_session`);
}
