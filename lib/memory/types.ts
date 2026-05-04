export interface SongRecord {
  songName: string;
  artist: string;
  topic: string;
  date: string;
}

export interface MusicDNA {
  styles: string[];     // 音乐风格标签，如 ["独立民谣", "后摇"]
  keywords: string[];   // 高频情绪/意象词
  songs: SongRecord[];  // 最近 10 首历史选歌
}

export interface UserMemoryData {
  userId: string;
  gamesPlayed: number;
  nickname?: string;
  musicDNA?: MusicDNA;
  usedTopics?: string[];
  // 快捷访问：最近一首歌
  lastSong?: string;
  lastArtist?: string;
}

export interface GameSnapshot {
  gameId: string;
  date: string;
  topicA: string;
  topicB: string;
  songA: { name: string; artist: string };
  songB: { name: string; artist: string };
  summaryExcerpt: string;
}

export interface PairMemoryData {
  pairId: string;
  gamesPlayed: number;
  gameHistory: GameSnapshot[];
  relationTags: string[];
  cumulativeMood: string[];
  // 快捷访问
  lastGame?: GameSnapshot;
}
