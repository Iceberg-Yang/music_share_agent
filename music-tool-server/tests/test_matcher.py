"""
模糊匹配算法单元测试
不依赖网络，可直接运行：pytest tests/
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.matcher import score_song_match, find_best_match


# 模拟网易云搜索结果
CANDIDATES = [
    {"name": "夜车", "artist": "李志", "id": 1, "url": "...", "album": "", "duration": 0, "cover": None},
    {"name": "午夜的夜车", "artist": "万能青年旅店", "id": 2, "url": "...", "album": "", "duration": 0, "cover": None},
    {"name": "夜车", "artist": "张宇", "id": 3, "url": "...", "album": "", "duration": 0, "cover": None},
    {"name": "深夜的车", "artist": "陈奕迅", "id": 4, "url": "...", "album": "", "duration": 0, "cover": None},
]


class TestScoreSongMatch:
    def test_exact_match(self):
        score = score_song_match("夜车", "李志", "夜车", "李志")
        assert score > 0.9, f"完全匹配应 > 0.9，实际: {score}"

    def test_artist_mismatch(self):
        score = score_song_match("夜车", "李志", "夜车", "张宇")
        assert 0.5 < score < 0.9, f"歌名相同歌手不同应在中间，实际: {score}"

    def test_partial_name(self):
        score = score_song_match("夜车", "万能青年旅店", "午夜的夜车", "万能青年旅店")
        # 名字是子串关系，部分匹配
        assert score > 0.5, f"子串匹配应 > 0.5，实际: {score}"

    def test_completely_different(self):
        score = score_song_match("夜车", "李志", "晴天", "周杰伦")
        assert score < 0.4, f"完全不同应 < 0.4，实际: {score}"


class TestFindBestMatch:
    def test_finds_correct_song(self):
        best, confidence = find_best_match("夜车", "李志", CANDIDATES)
        assert best is not None
        assert best["id"] == 1  # 应该匹配李志的"夜车"
        assert confidence > 0.8

    def test_returns_none_below_threshold(self):
        best, confidence = find_best_match("晴天", "周杰伦", CANDIDATES)
        assert best is None  # 没有周杰伦的晴天
        assert confidence < 0.6

    def test_empty_candidates(self):
        best, confidence = find_best_match("夜车", "李志", [])
        assert best is None
        assert confidence == 0.0

    def test_artist_with_multiple(self):
        """测试多歌手情况"""
        candidates = [
            {"name": "Rolling In The Deep", "artist": "Adele、某合唱团", "id": 99,
             "url": "...", "album": "", "duration": 0, "cover": None}
        ]
        best, confidence = find_best_match("Rolling In The Deep", "Adele", candidates)
        assert best is not None
        assert confidence > 0.6
